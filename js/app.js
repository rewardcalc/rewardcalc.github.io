import { ITEMS, ETC } from './items.js';
import { loadTemplates, processBlob } from './recognize.js';
import { initCursor } from './cursor.js';

/* ---------- 도우미 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null || isNaN(n) ? '-' : Math.round(n).toLocaleString('ko-KR');
const sfmt = n => n == null || isNaN(n) ? '-' : (n > 0 ? '+' : '') + fmt(n);
const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const parseNum = s => { const d = String(s).replace(/[^0-9]/g, ''); return d === '' ? null : parseInt(d, 10); };
const SIDES = ['before', 'after'];
const SIDE_KO = { before: '사냥 전', after: '사냥 후' };
const KIND_KO = { use: '소비 창', etc: '기타 창', quick: '퀵슬롯' };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  raw(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} }
};
// 지금 올려 둔 사진은 sessionStorage: 새로고침하면 남고, 브라우저(탭)를 완전히 닫았다 열면 지워진다
const sess = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};
const K = { cur: 'pmt2.current', hist: 'pmt2.history', prices: 'pmt2.prices', eprices: 'pmt2.etcPrices', theme: 'pmt2.theme', guide: 'pmt2.guideSeen' };

/* ---------- 아이템 데이터 ---------- */
const USE = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const ETCI = Object.fromEntries(ETC.map(i => [i.id, i]));
const ORDER = Object.fromEntries(ITEMS.map((i, n) => [i.id, n]));
const EORDER = Object.fromEntries(ETC.map((i, n) => [i.id, n]));
// 인식용 아이콘: 'u:<아이콘>' = 소비 아이템, 'e:<아이콘>' = 기타 아이템
const ICON = {};
for (const it of ITEMS) {
  const k = 'u:' + it.icon, c = ICON[k];
  // 같은 아이콘을 쓰는 아이템이 여럿이면 NPC가 파는 기본 버전
  if (!c || (c.buy == null && it.buy != null) || (/\(Alt\)/.test(c.en) && !/\(Alt\)/.test(it.en))) ICON[k] = it;
}
for (const it of ETC) if (!ICON['e:' + it.icon]) ICON['e:' + it.icon] = it;
const TEMPLATE_LIST = Object.keys(ICON).map(key => ({ key, url: key.startsWith('e:') ? `assets/etc/${key.slice(2)}.png` : `assets/items/${key.slice(2)}.png` }));
const useImg = it => `assets/items/${it.icon}.png`;
const etcImg = it => `assets/etc/${it.icon}.png`;

/* ---------- 상태 ---------- */
const empty = () => ({ before: { images: [] }, after: { images: [] }, edits: { before: {}, after: {} } });
store.raw(K.cur, null); // 예전 버전이 localStorage에 남긴 사진 정리
let cur = sess.get(K.cur, null) || empty();
cur.edits ||= { before: {}, after: {} };
let history = store.get(K.hist, []);
let prices = store.get(K.prices, {});
let eprices = store.get(K.eprices, {});
const results = new Map();          // 이미지 id → 인식 결과
const pending = new Set();          // 인식 중인 이미지 id
let activeSide = cur.before.images.length ? 'after' : 'before';

// 저장할 때는 화면에서만 쓰는 값(_로 시작: 썸네일 주소, 사진 원본)은 뺀다
const persistable = () => JSON.parse(JSON.stringify(cur, (k, v) => k.startsWith('_') ? undefined : v));
function saveCur() {
  const data = persistable();
  if (!sess.set(K.cur, data)) {
    // 그래도 너무 크면 사진은 빼고 저장 (새로고침하면 다시 올려야 함)
    sess.set(K.cur, { ...data, before: { images: [] }, after: { images: [] } });
  }
}

/* ---------- 사진 분석 (백그라운드 작업) ---------- */
const ICON_URLS = TEMPLATE_LIST.map(t => ({ key: t.key, url: new URL(t.url, location.href).href }));
let worker = null;
const jobs = new Map(); let jobSeq = 0;
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id); e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data); };
  worker.onerror = e => { console.warn('worker failed, falling back', e); worker = null; for (const j of jobs.values()) j.reject(new Error('worker')); jobs.clear(); };
  worker.postMessage({ type: 'warm', icons: ICON_URLS, base: location.href }); // 아이콘 미리 받기
} catch (e) { worker = null; }
// 백그라운드 작업을 못 쓰는 브라우저에서는 화면 쪽에서 직접 분석
let localTpl = null;
async function analyzeHere(blob) {
  localTpl ||= loadTemplates(ICON_URLS, location.href);
  return processBlob(blob, await localTpl);
}
function analyzeBlob(blob) {
  if (!worker) return analyzeHere(blob);
  return new Promise((resolve, reject) => {
    const id = ++jobSeq; jobs.set(id, { resolve, reject });
    worker.postMessage({ id, blob, icons: ICON_URLS, base: location.href });
  }).catch(() => analyzeHere(blob));
}

/* ---------- 알림 ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------- 다크 모드 ---------- */
const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : media.matches;
  document.documentElement.classList.toggle('is-dark', dark);
  $('#btnTheme .t-label').textContent = dark ? '밝은 모드' : '다크 모드';
  $('#btnTheme').setAttribute('aria-label', dark ? '밝은 모드로 바꾸기' : '다크 모드로 바꾸기');
}
$('#btnTheme').addEventListener('click', () => {
  const dark = document.documentElement.classList.contains('is-dark');
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  store.raw(K.theme, document.documentElement.dataset.theme);
  applyTheme();
});
media.addEventListener('change', applyTheme);

/* ---------- 캡처 방법 안내 (팝업) ---------- */
function openGuide() { $('#guide').hidden = false; $('#guideClose').focus(); }
function closeGuide() { $('#guide').hidden = true; $('#btnGuide').focus(); }
$('#btnGuide').addEventListener('click', openGuide);
$('#guideClose').addEventListener('click', closeGuide);
$('#guide').addEventListener('click', e => { if (e.target.id === 'guide') closeGuide(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#guide').hidden) closeGuide(); });

/* ---------- 사진 추가 / 인식 ---------- */
const readAsDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const kindOf = im => im.kind || (results.get(im.id) || {}).kind || 'unknown';

// 같은 쪽에 같은 종류(소비/기타/퀵슬롯) 사진이 이미 있으면 새 사진으로 바꾼다
function replaceSameKind(side, im) {
  const k = kindOf(im);
  if (k === 'unknown') return false;
  const old = cur[side].images.filter(x => x !== im && kindOf(x) === k);
  if (!old.length) return false;
  cur[side].images = cur[side].images.filter(x => !old.includes(x));
  old.forEach(dropImage);
  return true;
}
function dropImage(im) { results.delete(im.id); if (im._url) URL.revokeObjectURL(im._url); }
const thumbURL = im => im._url || (im._url = im._blob ? URL.createObjectURL(im._blob) : im.dataURL || '');

async function addFiles(side, files) {
  const list = [...files].filter(f => f.type && f.type.startsWith('image/'));
  if (!list.length) { toast('이미지 파일만 올릴 수 있어요.'); return; }
  setActive(side);
  const msgs = [];
  for (const f of list) {
    const entry = { id: uid(), name: f.name || '붙여넣은 이미지', dataURL: null, kind: null, _blob: f };
    cur[side].images.push(entry);
    await runAnalysis(entry);
    if (replaceSameKind(side, entry)) msgs.push(`${SIDE_KO[side]} ${KIND_KO[kindOf(entry)]} 사진을 새 사진으로 바꿨어요.`);
  }
  saveCur();
  render();
  if (msgs.length) toast(msgs[msgs.length - 1]);
  else if (side === 'before' && !cur.after.images.length) toast('사냥 전 사진을 넣었어요. 사냥이 끝나면 "사냥 후" 칸에 넣어 주세요.');
}

const MAX_KEEP = 1.5 * 1024 * 1024; // 잘라내지 못한 큰 사진은 새로고침용으로 저장하지 않는다
async function runAnalysis(entry) {
  pending.add(entry.id); render();
  try {
    const blob = entry._blob || await (await fetch(entry.dataURL)).blob();
    const { result, crop } = await analyzeBlob(blob);
    results.set(entry.id, result);
    // 화면 전체 캡처였다면 인벤토리·퀵슬롯 부분만 남긴다 (썸네일·저장·크게 보기 모두 가벼워짐)
    if (crop) {
      if (entry._url) { URL.revokeObjectURL(entry._url); entry._url = null; }
      entry._blob = crop;
      entry.dataURL = await readAsDataURL(crop);
    } else if (!entry.dataURL) {
      entry.dataURL = blob.size <= MAX_KEEP ? await readAsDataURL(blob) : null;
    }
  } catch (e) {
    console.error(e);
    results.set(entry.id, { kind: 'unknown', meso: null, known: [], error: true });
  }
  pending.delete(entry.id);
}

/* ---------- 한쪽(전/후) 합산 ---------- */
function aggregate(side) {
  let meso = null, mesoFromUse = false;
  const inv = new Map(), quick = new Map(), etc = new Map();
  let hasUse = false, hasEtc = false;
  for (const im of cur[side].images) {
    const r = results.get(im.id);
    if (!r) continue;
    const kind = kindOf(im);
    if (r.meso != null && (meso == null || (kind === 'use' && !mesoFromUse))) { meso = r.meso; mesoFromUse = kind === 'use'; }
    if (kind === 'use' || kind === 'quick') hasUse = true;
    if (kind === 'etc') hasEtc = true;
    for (const k of r.known) {
      const it = ICON[k.icon]; if (!it) continue;
      const isEtc = k.icon.startsWith('e:');
      if (kind === 'use' && !isEtc) inv.set(it.id, (inv.get(it.id) || 0) + k.count);
      else if (kind === 'quick' && !isEtc) quick.set(it.id, Math.max(quick.get(it.id) || 0, k.count));
      else if (kind === 'etc' && isEtc) etc.set(it.id, (etc.get(it.id) || 0) + k.count);
    }
    // 화면 전체 캡처에 함께 찍힌 퀵슬롯
    if (kind !== 'quick') for (const k of r.quick || []) {
      const it = ICON[k.icon]; if (it) quick.set(it.id, Math.max(quick.get(it.id) || 0, k.count));
    }
  }
  // 같은 아이템은 한 번만: 퀵슬롯 숫자(그 아이템 전체 개수)가 있으면 그것, 없으면 인벤토리 칸 합계
  const items = new Map(inv);
  for (const [id, n] of quick) items.set(id, n);
  return { meso, inv, quick, items, etc, hasUse, hasEtc };
}

// 한 아이템의 사냥 전·후 개수는 같은 기준으로 비교한다
// 양쪽 모두 퀵슬롯에 있으면 퀵슬롯 숫자, 아니면 인벤토리 칸 합계 (인벤토리에 없으면 퀵슬롯 숫자)
function pickCounts(A, id) {
  const bothQuick = A.before.quick.has(id) && A.after.quick.has(id);
  const one = s => bothQuick ? A[s].quick.get(id)
    : A[s].inv.has(id) ? A[s].inv.get(id)
    : A[s].quick.has(id) ? A[s].quick.get(id) : 0;
  return { b: one('before'), a: one('after'), src: bothQuick ? 'quick' : 'inv' };
}

/* ---------- 계산 ---------- */
function compute() {
  const A = { before: aggregate('before'), after: aggregate('after') };
  const ed = cur.edits;
  const val = (side, key, rec) => ed[side][key] != null ? ed[side][key] : rec;
  const editedIds = prefix => [...new Set([...Object.keys(ed.before), ...Object.keys(ed.after)].filter(k => k.startsWith(prefix)).map(k => +k.slice(2)))];

  const mb = val('before', 'meso', A.before.meso), ma = val('after', 'meso', A.after.meso);
  const meso = { before: mb, after: ma, delta: mb != null && ma != null ? ma - mb : null, recBefore: A.before.meso, recAfter: A.after.meso };

  const ids = new Set([...A.before.items.keys(), ...A.after.items.keys(), ...editedIds('i:')]);
  const items = [...ids].filter(id => USE[id]).sort((a, b) => ORDER[a] - ORDER[b]).map(id => {
    const it = USE[id], key = 'i:' + id;
    const pc = pickCounts(A, id), rb = pc.b, ra = pc.a;
    const b = val('before', key, rb), a = val('after', key, ra);
    const price = prices[id] != null ? prices[id] : (it.buy != null ? it.buy : 0);
    const delta = a - b;
    return { id, it, key, rb, ra, b, a, delta, price, value: delta * price, src: pc.src };
  });

  // 기타 아이템: 사냥 후 기타 창만 있어도 계산한다
  //  both      : 사냥 전·후 모두 있음 → 개수 차이
  //  afterOnly : 사냥 후만 있음 → 사냥 전 개수를 0으로 보고 사냥 후 개수 전체를 이번 사냥 수익으로 (사냥 전 칸은 직접 고칠 수 있음)
  //  beforeOnly: 사냥 전만 있음 → 사냥 후 사진을 기다림
  const etcState = A.after.hasEtc ? (A.before.hasEtc ? 'both' : 'afterOnly') : A.before.hasEtc ? 'beforeOnly' : 'none';
  let etc = [];
  if (etcState === 'both' || etcState === 'afterOnly') {
    const eids = new Set([...A.before.etc.keys(), ...A.after.etc.keys(), ...editedIds('e:')]);
    etc = [...eids].filter(id => ETCI[id]).map(id => {
      const it = ETCI[id], key = 'e:' + id;
      const rb = A.before.etc.get(id) || 0, ra = A.after.etc.get(id) || 0;
      const b = val('before', key, rb), a = val('after', key, ra);
      const price = eprices[id] != null ? eprices[id] : (it.sell || 0);
      const delta = a - b;
      return { id, it, key, rb, ra, b, a, delta, price, value: delta * price };
    }).sort((x, y) => (Math.abs(y.value) - Math.abs(x.value)) || (EORDER[x.id] - EORDER[y.id]));
  }

  const itemValue = items.reduce((s, r) => s + r.value, 0);
  const etcValue = etc.reduce((s, r) => s + r.value, 0);
  const net = meso.delta != null ? meso.delta + itemValue + etcValue : null;
  return { A, meso, items, etc, etcState, itemValue, etcValue, net, ready: A.before.hasUse && A.after.hasUse };
}

/* ---------- 그리기 ---------- */
const scaled = (src, scale) => `<img src="${src}" alt="" data-scale="${scale}">`;
const digitsHTML = n => `<span class="cnt">${String(Math.max(0, n)).split('').map(d => `<img src="assets/digit/${d}.png" alt="">`).join('')}</span>`;
function scaleIcons(root) {
  $$('img[data-scale]', root).forEach(img => {
    const f = () => { img.style.width = img.naturalWidth * img.dataset.scale + 'px'; };
    img.complete && img.naturalWidth ? f() : img.addEventListener('load', f, { once: true });
  });
}

function setActive(side) {
  activeSide = side;
  $$('.side').forEach(el => el.classList.toggle('active', el.dataset.side === side));
}

function shotDesc(im) {
  if (pending.has(im.id)) return { text: '인식하는 중…' };
  const r = results.get(im.id);
  if (!r) return { text: '' };
  if (r.error) return { text: '이미지를 읽지 못했어요.', warn: true };
  const kind = kindOf(im);
  const meso = r.meso != null ? ` · 메소 ${fmt(r.meso)}` : '';
  const nUse = new Set(r.known.filter(k => k.icon.startsWith('u:')).map(k => ICON[k.icon].id)).size;
  const nEtc = new Set(r.known.filter(k => k.icon.startsWith('e:')).map(k => ICON[k.icon].id)).size;
  if (kind === 'unknown') return { text: '아는 아이템을 찾지 못했어요. 원본 크기로 캡처했는지 확인해 주세요.', warn: true };
  if (kind === 'etc') return { text: `몬스터 드랍 아이템 ${nEtc}종${meso}` };
  if (kind === 'quick') return { text: `물약 ${nUse}종` };
  const nQuick = new Set((r.quick || []).map(k => ICON[k.icon] && ICON[k.icon].id).filter(Boolean)).size;
  return { text: `물약 ${nUse}종${nQuick ? ` · 퀵슬롯 ${nQuick}종` : ''}${meso}` };
}

function renderSide(side, agg) {
  const card = $(`.side[data-side="${side}"]`);
  const imgs = cur[side].images;
  card.classList.toggle('has-shots', imgs.length > 0);
  const shotsHTML = imgs.map(im => {
    const d = shotDesc(im), kind = kindOf(im);
    return `<li class="shot" data-id="${im.id}">
      <button class="thumb" style="background-image:url('${thumbURL(im)}')" title="인식 결과 크게 보기" aria-label="인식 결과 크게 보기"></button>
      <div class="meta">
        <select aria-label="사진 종류">
          ${['use', 'etc', 'quick'].map(k => `<option value="${k}" ${kind === k ? 'selected' : ''}>${KIND_KO[k]}</option>`).join('')}
          ${kind === 'unknown' ? '<option value="" selected>종류 모름</option>' : ''}
        </select>
        <span class="desc ${d.warn ? 'warn' : ''}" title="${esc(d.text)}">${esc(d.text)}</span>
      </div>
      <button class="icon-btn" title="사진 빼기" aria-label="사진 빼기">✕</button>
    </li>`;
  }).join('');
  // 바뀐 게 있을 때만 다시 그린다 (숫자를 고칠 때마다 썸네일을 다시 만들지 않도록)
  const shotsEl = $('.shots', card);
  if (shotsEl._html !== shotsHTML) { shotsEl.innerHTML = shotsHTML; shotsEl._html = shotsHTML; }

  const list = [...agg.items.entries()].filter(([id]) => USE[id]).sort((a, b) => ORDER[a[0]] - ORDER[b[0]]);
  const elist = [...agg.etc.entries()].filter(([id]) => ETCI[id]).sort((a, b) => EORDER[a[0]] - EORDER[b[0]]);
  $('.found', card).innerHTML = (agg.meso != null || list.length || elist.length) ? `
    ${agg.meso != null ? `<div class="meso"><img class="px" src="assets/coin.png" alt="">${fmt(agg.meso)} <small>메소</small></div>` : ''}
    ${list.length ? `<div class="slots">${list.map(([id, n]) => `<div class="slot" title="${esc(USE[id].ko)} ${fmt(n)}개">${scaled(useImg(USE[id]), 2)}${digitsHTML(n)}</div>`).join('')}</div>` : ''}
    ${elist.length ? `<div class="label">기타 아이템 ${elist.length}종</div><div class="slots small">${elist.map(([id, n]) => `<div class="slot" title="${esc(ETCI[id].ko)} ${fmt(n)}개">${scaled(etcImg(ETCI[id]), 1)}${digitsHTML(n)}</div>`).join('')}</div>` : ''}` : '';
  scaleIcons(card);
}

function numInput(side, key, value, rec) {
  const edited = cur.edits[side][key] != null;
  return `<input class="num ${edited ? 'edited' : ''}" type="text" inputmode="numeric" data-side="${side}" data-key="${key}"
    value="${value == null ? '' : fmt(value)}" placeholder="${rec == null ? '' : fmt(rec)}" title="${edited ? `직접 고친 값 (인식: ${rec == null ? '-' : fmt(rec)})` : '눌러서 고치기'}" aria-label="${SIDE_KO[side]} ${key === 'meso' ? '메소' : '개수'}">`;
}
const trTag = it => it.tr ? '<span class="tag" title="한국 메이플에 없는 아이템이라 직접 번역한 이름">번역</span>' : '';

function effect(it) {
  if (it.kind === 'buff') return it.buff || '';
  const a = v => typeof v === 'string' ? v : '+' + v.toLocaleString('ko-KR');
  return [it.hp ? `HP ${a(it.hp)}` : '', it.mp ? `MP ${a(it.mp)}` : ''].filter(Boolean).join(' · ');
}

function rowHTML(r, img, sub, priceAttr, priceTitle) {
  return `<tr>
    <td><div class="item-name"><span class="ic px"><img src="${img}" alt=""></span><span>${esc(r.it.ko)}${trTag(r.it)}<small>${esc(sub)}</small></span></div></td>
    <td>${numInput('before', r.key, r.b, r.rb)}</td>
    <td>${numInput('after', r.key, r.a, r.ra)}</td>
    <td class="${cls(r.delta)}"><b>${sfmt(r.delta)}</b></td>
    <td><input class="num" type="text" inputmode="numeric" ${priceAttr}="${r.id}" value="${fmt(r.price)}" title="${esc(priceTitle)}" aria-label="${esc(r.it.ko)} 개당 가격"></td>
    <td class="${cls(r.value)}">${sfmt(r.value)}</td></tr>`;
}

function renderResult(c) {
  const box = $('#result');
  box.hidden = !c.ready;
  if (!c.ready) return;

  $('#totals').innerHTML = `
    <div class="total"><div class="k">메소 변화</div><div class="v ${cls(c.meso.delta)}">${sfmt(c.meso.delta)}</div></div>
    <div class="total"><div class="k">물약 금액 변화</div><div class="v ${cls(c.itemValue)}">${sfmt(c.itemValue)}</div></div>
    ${c.etcState === 'both' || c.etcState === 'afterOnly' ? `<div class="total"><div class="k">기타 아이템 판매가 변화</div><div class="v ${cls(c.etcValue)}">${sfmt(c.etcValue)}</div></div>` : ''}
    <div class="total main"><div class="k">순수익</div><div class="v ${cls(c.net)}">${c.net == null ? '메소를 못 읽었어요' : sfmt(c.net)}</div></div>`;

  const m = c.meso;
  const rows = [`<tr class="meso-row">
      <td><div class="item-name"><span class="ic"><img class="px" src="assets/coin.png" alt=""></span>메소</div></td>
      <td>${numInput('before', 'meso', m.before, m.recBefore)}</td>
      <td>${numInput('after', 'meso', m.after, m.recAfter)}</td>
      <td class="${cls(m.delta)}">${sfmt(m.delta)}</td><td></td>
      <td class="${cls(m.delta)}">${sfmt(m.delta)}</td></tr>`];
  for (const r of c.items) rows.push(rowHTML(r, useImg(r.it), effect(r.it) + (r.src === 'quick' ? ' · 퀵슬롯 숫자 기준' : ''), 'data-price', r.it.buy != null ? `NPC 상점가 ${fmt(r.it.buy)}메소` : 'NPC가 팔지 않는 아이템'));
  if (!c.items.length) rows.push('<tr><td colspan="6" class="empty">사진에서 물약을 찾지 못했어요.</td></tr>');
  $('#itemTable tbody').innerHTML = rows.join('');

  // 기타 아이템 (몬스터 드랍)
  let etcHTML = '';
  if (c.etcState === 'beforeOnly') {
    etcHTML = '<p class="hint">사냥 후 기타 창 사진을 넣으면 몬스터가 드랍한 기타 아이템의 판매 수익도 계산해요.</p>';
  } else if (c.etcState === 'both' || c.etcState === 'afterOnly') {
    const changed = c.etc.filter(r => r.delta !== 0), same = c.etc.filter(r => r.delta === 0);
    const table = rs => `<div class="table-wrap"><table class="items">
        <thead><tr><th>아이템</th><th>사냥 전</th><th>사냥 후</th><th>변화</th><th>개당 판매가</th><th>금액</th></tr></thead>
        <tbody>${rs.map(r => rowHTML(r, etcImg(r.it), r.it.en, 'data-eprice', `NPC에게 팔면 개당 ${fmt(r.it.sell)}메소`)).join('')}</tbody></table></div>`;
    etcHTML = `<div class="etc">
      <h3 class="sub">기타 아이템 <small>몬스터 드랍 · NPC 판매가 기준</small></h3>
      ${c.etcState === 'afterOnly' ? '<p class="hint" style="margin:0 0 8px">사냥 전 기타 창 사진이 없어서, 사냥 후 개수 전체를 이번 사냥에서 얻은 것으로 계산했어요. 원래 갖고 있던 아이템이 있으면 "사냥 전" 칸에 그 개수를 넣어 주세요.</p>' : ''}
      ${changed.length ? table(changed) : '<p class="hint">개수가 바뀐 기타 아이템이 없어요.</p>'}
      ${same.length ? `<details class="more"><summary>변화 없는 아이템 ${same.length}개 보기</summary>${table(same)}</details>` : ''}
    </div>`;
  }
  $('#etcBox').innerHTML = etcHTML;
  scaleIcons(box);
}

function renderHistory() {
  $('#btnClearHistory').hidden = !history.length;
  if (!history.length) { $('#history').innerHTML = '<p class="empty">저장한 기록이 없어요. 결과가 나오면 [기록 저장]을 눌러 주세요.</p>'; return; }
  const tbl = (rows, priceHead) => `<div class="table-wrap"><table class="items">
      <thead><tr><th>아이템</th><th>사냥 전</th><th>사냥 후</th><th>변화</th><th>${priceHead}</th><th>금액</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  const rowOf = (r, src) => `<tr><td><div class="item-name"><span class="ic px"><img src="${src}" alt=""></span>${esc(r.name)}</div></td><td>${fmt(r.before)}</td><td>${fmt(r.after)}</td><td class="${cls(r.delta)}">${sfmt(r.delta)}</td><td>${fmt(r.price)}</td><td class="${cls(r.value)}">${sfmt(r.value)}</td></tr>`;
  $('#history').innerHTML = history.map(h => {
    const d = new Date(h.date), p = n => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    const used = h.items.filter(r => r.delta !== 0);
    const etc = (h.etc || []).filter(r => r.delta !== 0);
    return `<details class="rec" data-id="${h.id}">
      <summary>
        <span class="when">${when}</span>
        <span class="used px">${used.slice(0, 8).map(r => `<span title="${esc(r.name)}"><img src="assets/items/${r.icon}.png" alt="">${sfmt(r.delta)}</span>`).join('') || '<span class="when">물약 변화 없음</span>'}</span>
        <span class="net ${cls(h.net)}">${h.net == null ? '-' : sfmt(h.net)}<small>메소 ${sfmt(h.meso.delta)}${h.etcValue ? ` · 기타 ${sfmt(h.etcValue)}` : ''}</small></span>
        <button class="icon-btn del" title="이 기록 삭제" aria-label="이 기록 삭제">✕</button>
      </summary>
      <div class="body">
        ${tbl(`<tr class="meso-row"><td><div class="item-name"><span class="ic"><img class="px" src="assets/coin.png" alt=""></span>메소</div></td><td>${fmt(h.meso.before)}</td><td>${fmt(h.meso.after)}</td><td class="${cls(h.meso.delta)}">${sfmt(h.meso.delta)}</td><td></td><td class="${cls(h.meso.delta)}">${sfmt(h.meso.delta)}</td></tr>` +
          h.items.map(r => rowOf(r, `assets/items/${r.icon}.png`)).join(''), '개당 가격')}
        ${etc.length ? `<div class="etc"><h3 class="sub">기타 아이템</h3>${tbl(etc.map(r => rowOf(r, `assets/etc/${r.icon}.png`)).join(''), '개당 판매가')}</div>` : ''}
      </div>
    </details>`;
  }).join('');
}

let last = null;
function render() {
  const c = compute();
  last = c;
  for (const s of SIDES) renderSide(s, c.A[s]);
  renderResult(c);
}

/* ---------- 이벤트 ---------- */
for (const side of SIDES) {
  const card = $(`.side[data-side="${side}"]`), drop = $('.drop', card), input = $('input[type=file]', drop);
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files.length) addFiles(side, input.files); input.value = ''; });
  $('.paste', card).addEventListener('click', () => pasteFromClipboard(side));
  card.addEventListener('pointerdown', () => setActive(side));
  card.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) drop.classList.remove('over'); });
  card.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) addFiles(side, e.dataTransfer.files); });

  $('.shots', card).addEventListener('click', e => {
    const li = e.target.closest('.shot'); if (!li) return;
    const im = cur[side].images.find(x => x.id === li.dataset.id); if (!im) return;
    if (e.target.closest('.icon-btn')) {
      cur[side].images = cur[side].images.filter(x => x !== im); dropImage(im);
      saveCur(); render();
    } else if (e.target.closest('.thumb')) openViewer(im);
  });
  $('.shots', card).addEventListener('change', e => {
    const li = e.target.closest('.shot'); if (!li || e.target.tagName !== 'SELECT') return;
    const im = cur[side].images.find(x => x.id === li.dataset.id);
    im.kind = e.target.value || null;
    if (replaceSameKind(side, im)) toast(`예전 ${KIND_KO[kindOf(im)]} 사진을 빼고 이 사진으로 바꿨어요.`);
    saveCur(); render();
  });
}
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => e.preventDefault());

// [클립보드에 있는 이미지 넣기] 버튼: PrtSc / Win+Shift+S 로 캡처한 이미지를 바로 가져온다
async function pasteFromClipboard(side) {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    toast('이 브라우저는 버튼으로 클립보드를 읽을 수 없어요. 이 페이지에서 Ctrl+V를 눌러 주세요.');
    return;
  }
  let items;
  try { items = await navigator.clipboard.read(); }
  catch (e) { toast('클립보드를 읽지 못했어요. 브라우저가 권한을 물으면 "허용"을 눌러 주세요. (Ctrl+V도 돼요)'); return; }
  const files = [];
  for (const it of items) {
    const type = it.types.find(t => t.startsWith('image/'));
    if (type) files.push(new File([await it.getType(type)], '클립보드 이미지.png', { type }));
  }
  if (!files.length) { toast('클립보드에 이미지가 없어요. 게임에서 PrtSc나 Win+Shift+S로 캡처한 뒤 다시 눌러 주세요.'); return; }
  await addFiles(side, files);
}

// Ctrl+V 붙여넣기 → 마지막으로 누른 쪽(처음엔 사냥 전)에 추가
document.addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('input')) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  addFiles(activeSide, files);
});

// 결과표에서 숫자 고치기
$('#result').addEventListener('change', e => {
  const t = e.target, v = parseNum(t.value);
  if (t.dataset.key) {
    const ed = cur.edits[t.dataset.side];
    if (v == null) delete ed[t.dataset.key]; else ed[t.dataset.key] = v;
    saveCur();
  } else if (t.dataset.price) {
    if (v == null) delete prices[t.dataset.price]; else prices[t.dataset.price] = v;
    store.set(K.prices, prices);
  } else if (t.dataset.eprice) {
    if (v == null) delete eprices[t.dataset.eprice]; else eprices[t.dataset.eprice] = v;
    store.set(K.eprices, eprices);
  } else return;
  render();
});
$('#result').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input.num')) e.target.blur(); });

$('#btnSave').addEventListener('click', () => {
  const c = last; if (!c || !c.ready) return;
  const row = r => ({ id: r.id, icon: r.it.icon, name: r.it.ko, before: r.b, after: r.a, delta: r.delta, price: r.price, value: r.value });
  const rec = {
    id: uid(), date: Date.now(),
    meso: { before: c.meso.before, after: c.meso.after, delta: c.meso.delta },
    items: c.items.map(row),
    etc: c.etc.filter(r => r.delta !== 0).map(row),
    itemValue: c.itemValue, etcValue: c.etcValue, net: c.net
  };
  history.unshift(rec);
  if (!store.set(K.hist, history)) { history.shift(); toast('저장 공간이 가득 찼어요. 오래된 기록을 지워 주세요.'); return; }
  renderHistory();
  toast('기록을 저장했어요.');
  $('#historyCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#btnReset').addEventListener('click', () => {
  if (!confirm('올린 사진과 고친 숫자를 모두 지우고 새로 시작할까요? (저장한 기록은 남아요)')) return;
  cur = empty(); results.clear(); saveCur(); setActive('before'); render();
  scrollTo({ top: 0, behavior: 'smooth' });
});

$('#history').addEventListener('click', e => {
  const del = e.target.closest('.del'); if (!del) return;
  e.preventDefault();
  const id = del.closest('.rec').dataset.id;
  if (!confirm('이 기록을 삭제할까요?')) return;
  history = history.filter(h => h.id !== id); store.set(K.hist, history); renderHistory();
});
$('#btnClearHistory').addEventListener('click', () => {
  if (!confirm(`저장한 기록 ${history.length}개를 모두 삭제할까요? 되돌릴 수 없어요.`)) return;
  history = []; store.set(K.hist, history); renderHistory();
});

/* ---------- 인식 결과 크게 보기 ---------- */
async function openViewer(im) {
  const r = results.get(im.id);
  const bmp = await createImageBitmap(im._blob || await (await fetch(im.dataURL)).blob());
  const s = bmp.width > 500 ? 1 : 2;
  const cv = $('#viewerCanvas'); cv.width = bmp.width * s; cv.height = bmp.height * s;
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  if (r) {
    g.lineWidth = 2;
    for (const k of r.known) {
      g.strokeStyle = k.icon.startsWith('e:') ? '#3b82f6' : '#f08a24';
      g.strokeRect(k.box.x * s + 1, k.box.y * s + 1, k.box.w * s - 2, k.box.h * s - 2);
    }
  }
  $('#viewerTitle').textContent = `${KIND_KO[kindOf(im)] || '사진'} · ${shotDesc(im).text}`;
  $('#viewer').hidden = false;
  $('#viewerClose').focus();
}
const closeViewer = () => { $('#viewer').hidden = true; };
$('#viewerClose').addEventListener('click', closeViewer);
$('#viewer').addEventListener('click', e => { if (e.target.id === 'viewer') closeViewer(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#viewer').hidden) closeViewer(); });

/* ---------- 시작 ---------- */
// 예전 버전에서 저장된 사진의 종류 정보 정리 (같은 종류가 여럿이면 마지막 것만)
applyTheme();
initCursor();
setActive(activeSide);
render();
renderHistory();
(async () => {
  // 새로고침 전에 넣어 둔 사진 다시 인식 (저장하지 못한 큰 사진은 뺀다)
  for (const s of SIDES) cur[s].images = cur[s].images.filter(im => im.dataURL);
  for (const s of SIDES) for (const im of cur[s].images) await runAnalysis(im);
  let changed = false;
  for (const s of SIDES) for (const im of [...cur[s].images].reverse()) if (cur[s].images.includes(im) && replaceSameKind(s, im)) changed = true;
  if (changed) saveCur();
  render();
})();
