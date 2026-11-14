import { ITEMS, ETC } from './items.js';
import { loadTemplates, processBlob, VERSION } from './recognize.js';
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
  set(k, v, replacer) { try { sessionStorage.setItem(k, JSON.stringify(v, replacer)); return true; } catch { return false; } }
};
const K = { cur: 'pmt2.current', hist: 'pmt2.history', prices: 'pmt2.prices', eprices: 'pmt2.etcPrices', theme: 'pmt2.theme' };

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
const skipLocal = (k, v) => k.startsWith('_') ? undefined : v;
function saveCur() {
  if (!sess.set(K.cur, cur, skipLocal)) {
    // 너무 크면 사진은 빼고 저장 (새로고침하면 다시 올려야 함)
    sess.set(K.cur, { ...cur, before: { images: [] }, after: { images: [] } });
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
  localTpl ||= loadTemplates(ICON_URLS, location.href).catch(err => { localTpl = null; throw err; });
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
function toast(msg, opts = {}) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show'); t.classList.toggle('warn', !!opts.warn);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), opts.ms || 2800);
}

// 사진에서 가려진 곳이 있으면 다시 찍어 달라는 문구
function warnMessage(r) {
  const w = r && r.warn; if (!w) return '';
  const parts = [];
  if (w.covered) parts.push(`인벤토리 칸 ${w.covered}개`);
  if (w.items) parts.push(`아이템 ${w.items}개`);
  if (w.counts) parts.push(`아이템 개수 숫자 ${w.counts}곳`);
  if (w.meso) parts.push('메소 칸');
  if (!parts.length && !w.cursor) return '';
  const who = w.cursor ? '마우스 커서가 인벤토리를 가리고 있어요' : '무언가에 가려서 읽지 못한 곳이 있어요';
  const what = parts.length ? ` (${parts.join(', ')})` : '';
  const fix = w.cursor ? '커서를 인벤토리 밖으로 옮기고' : '마우스 커서나 다른 창을 치우고';
  return `${who}${what}. ${fix} 다시 캡처해 주세요.`;
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

// 같은 쪽에 같은 종류(소비/기타/퀵슬롯) 사진이 여럿이면 가장 나중에 넣은 것(seq가 큰 것)만 남긴다.
// 인식이 끝나는 순서와 상관없이 늘 나중에 넣은 사진이 이긴다.
// 돌려주는 값: 빠진 사진이 있으면 true
let seqNo = 0;
const nextSeq = () => Date.now() * 1000 + (seqNo++ % 1000);
const seqOf = (side, im) => im.seq ?? cur[side].images.indexOf(im); // 예전에 저장된 사진은 순서대로
function replaceSameKind(side, im) {
  const k = kindOf(im);
  if (k === 'unknown' || !cur[side].images.includes(im)) return false;
  const same = cur[side].images.filter(x => kindOf(x) === k && !pending.has(x.id));
  if (same.length < 2) return false;
  const newest = same.reduce((a, b) => seqOf(side, b) > seqOf(side, a) ? b : a);
  const drop = same.filter(x => x !== newest);
  cur[side].images = cur[side].images.filter(x => !drop.includes(x));
  drop.forEach(dropImage);
  return true;
}
function dropImage(im) { results.delete(im.id); if (im._url) { URL.revokeObjectURL(im._url); im._url = null; } }
const thumbURL = im => im._url || (im._url = im._blob ? URL.createObjectURL(im._blob) : im.dataURL || '');

// 사진이 바뀌면 그 쪽에서 그 사진으로 읽은 값을 직접 고쳐 둔 것은 지운다 (새 사진 값을 쓰도록)
//  소비 창·퀵슬롯 → 물약 개수, 기타 창 → 기타 아이템 개수, 소비·기타 창 → 메소
function clearEdits(side, kind) {
  const ed = cur.edits[side]; let n = 0;
  for (const key of Object.keys(ed)) {
    const hit = key === 'meso' ? (kind === 'use' || kind === 'etc')
      : key.startsWith('i:') ? (kind === 'use' || kind === 'quick')
      : key.startsWith('e:') ? kind === 'etc' : false;
    if (hit) { delete ed[key]; n++; }
  }
  return n;
}

let generation = 0; // [새로 시작]을 누르면 바뀐다 → 그 전에 넣던 사진은 버린다
async function addFiles(side, files) {
  const list = [...files].filter(f => f.type && f.type.startsWith('image/'));
  if (!list.length) { toast('이미지 파일만 올릴 수 있어요.'); return; }
  setActive(side);
  const gen = generation, msgs = [], added = [];
  let cleared = 0;
  for (const f of list) {
    if (gen !== generation) return;
    const entry = { id: uid(), seq: nextSeq(), name: f.name || '붙여넣은 이미지', dataURL: null, kind: null, _blob: f };
    cur[side].images.push(entry); added.push(entry);
    await runAnalysis(entry);
    // 인식하는 동안 사진을 빼거나 [새로 시작]을 눌렀으면 아무것도 하지 않는다
    if (gen !== generation || !cur[side].images.includes(entry)) { dropImage(entry); continue; }
    const kind = kindOf(entry);
    if (kind !== 'unknown') cleared += clearEdits(side, kind);
    if (replaceSameKind(side, entry)) msgs.push(cur[side].images.includes(entry)
      ? `${SIDE_KO[side]} ${KIND_KO[kind]} 사진을 새 사진으로 바꿨어요.`
      : `${SIDE_KO[side]} ${KIND_KO[kind]} 사진은 더 나중에 넣은 사진을 쓸게요.`);
  }
  saveCur();
  render();
  const kept = added.filter(im => cur[side].images.includes(im));
  if (!kept.length) return;
  // 가려진 곳이 있으면 아래에 잠시 빨간 알림
  const warned = kept.map(im => warnMessage(results.get(im.id))).find(Boolean);
  const unknown = kept.filter(im => kindOf(im) === 'unknown');
  if (warned) toast(warned, { warn: true, ms: 6000 });
  else if (unknown.length) toast(results.get(unknown[0].id)?.error ? '이미지를 읽지 못했어요. 다른 파일로 다시 넣어 주세요.'
    : results.get(unknown[0].id)?.inventory ? '인벤토리 창은 찾았는데 아는 아이템이 없어요. 사진 옆 목록에서 소비 창/기타 창을 골라 주세요.'
    : '사진에서 인벤토리나 퀵슬롯을 찾지 못했어요. 게임 화면을 확대·축소 없이 원본 크기로 캡처해 주세요.', { warn: true, ms: 6000 });
  else if (msgs.length) toast(msgs[msgs.length - 1] + (cleared ? ' 직접 고친 숫자는 새 사진 기준으로 되돌렸어요.' : ''));
  else if (cleared) toast('새 사진을 넣어서, 직접 고친 숫자는 새 사진 기준으로 되돌렸어요.');
  else if (side === 'before' && !cur.after.images.length) toast('사냥 전 사진을 넣었어요. 사냥이 끝나면 "사냥 후" 칸에 넣어 주세요.');
}

const MAX_KEEP = 1.5 * 1024 * 1024; // 잘라내지 못한 큰 사진은 새로고침용으로 저장하지 않는다
async function runAnalysis(entry) {
  pending.add(entry.id); render();
  try {
    const blob = entry._blob || await (await fetch(entry.dataURL)).blob();
    const { result, crop } = await analyzeBlob(blob);
    results.set(entry.id, result);
    const { timings, ...keep } = result;
    entry.res = { v: VERSION, ...keep }; // 새로고침해도 다시 인식하지 않도록 결과도 저장
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
// 같은 종류 사진이 여럿이면(종류를 손으로 바꾼 경우 등) 가장 나중에 넣은 것만 계산에 쓴다
function usedImages(side) {
  const best = {}, rest = [];
  for (const im of cur[side].images) {
    if (pending.has(im.id) || !results.get(im.id)) continue;
    const k = kindOf(im);
    if (k === 'unknown') { rest.push(im); continue; }
    if (!best[k] || seqOf(side, im) > seqOf(side, best[k])) best[k] = im;
  }
  return [...Object.values(best), ...rest];
}
function aggregate(side) {
  let meso = null, mesoFromUse = false;
  const inv = new Map(), quick = new Map(), etc = new Map();
  let hasInv = false, hasEtc = false;
  for (const im of usedImages(side)) {
    const r = results.get(im.id);
    const kind = kindOf(im);
    if (r.meso != null && (meso == null || (kind === 'use' && !mesoFromUse))) { meso = r.meso; mesoFromUse = kind === 'use'; }
    if (kind === 'use') hasInv = true;
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
  // hasUse: 물약 개수를 알 수 있는 사진(소비 창 또는 퀵슬롯)이 있음
  return { meso, inv, quick, items, etc, hasInv, hasUse: hasInv || quick.size > 0, hasEtc };
}

// 한 아이템의 사냥 전·후 개수는 같은 기준으로 비교한다
//  - 양쪽 모두 퀵슬롯에 있으면 퀵슬롯 숫자
//  - 소비 창 사진이 있는 쪽: 인벤토리 칸 합계 (없으면 퀵슬롯 숫자, 둘 다 없으면 0개)
//  - 퀵슬롯 사진만 있는 쪽: 퀵슬롯에 없는 아이템은 개수를 모름(null) → 계산에서 뺀다
function pickCounts(A, id) {
  const bothQuick = A.before.quick.has(id) && A.after.quick.has(id);
  const one = s => bothQuick ? A[s].quick.get(id)
    : A[s].inv.has(id) ? A[s].inv.get(id)
    : A[s].quick.has(id) ? A[s].quick.get(id)
    : A[s].hasInv ? 0 : null;
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

  // 물약은 사냥 전·후 모두 소비 창(또는 퀵슬롯) 사진이 있을 때만 비교한다
  const useReady = A.before.hasUse && A.after.hasUse;
  const ids = useReady ? new Set([...A.before.items.keys(), ...A.after.items.keys(), ...editedIds('i:')]) : new Set();
  const items = [...ids].filter(id => USE[id]).sort((a, b) => ORDER[a] - ORDER[b]).map(id => {
    const it = USE[id], key = 'i:' + id;
    const pc = pickCounts(A, id), rb = pc.b, ra = pc.a;
    const b = val('before', key, rb), a = val('after', key, ra);
    const price = prices[id] != null ? prices[id] : (it.buy != null ? it.buy : 0);
    // 한쪽 개수를 모르면(그쪽에 소비 창 사진이 없고 퀵슬롯에도 없음) 변화를 계산하지 않는다
    const delta = a != null && b != null ? a - b : null;
    return { id, it, key, rb, ra, b, a, delta, price, value: delta == null ? 0 : delta * price, src: pc.src, unknown: delta == null };
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
  // 소비 창이 없어도 사냥 후 기타 창이 있으면 메소·기타 아이템만으로 결과를 보여 준다
  const etcReady = etcState === 'both' || etcState === 'afterOnly';
  return { A, meso, items, etc, etcState, itemValue, etcValue, net, useReady, ready: useReady || etcReady };
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
  const d = shotDescBase(im), r = results.get(im.id);
  const side = SIDES.find(s => cur[s].images.includes(im));
  if (side && r && !pending.has(im.id) && kindOf(im) !== 'unknown' && !usedImages(side).includes(im))
    return { text: '같은 종류의 더 나중 사진을 쓰고 있어서 계산에 쓰지 않아요', warn: true };
  if (!pending.has(im.id) && r && r.warn && Object.keys(r.warn).length && !d.warn) return { text: d.text + ' · 일부가 가려졌어요, 다시 캡처해 주세요', warn: true };
  return d;
}
function shotDescBase(im) {
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

// name: 화면 읽기 프로그램용 이름 (어느 아이템의 칸인지)
function numInput(side, key, value, rec, name) {
  const edited = cur.edits[side][key] != null;
  const label = key === 'meso' ? `${SIDE_KO[side]} 메소` : `${name} ${SIDE_KO[side]} 개수`;
  return `<input class="num ${edited ? 'edited' : ''}" type="text" inputmode="numeric" maxlength="13" data-side="${side}" data-key="${key}"
    value="${value == null ? '' : fmt(value)}" placeholder="${rec == null ? '?' : fmt(rec)}" title="${edited ? `직접 고친 값 (인식: ${rec == null ? '-' : fmt(rec)})` : rec == null ? '사진으로 알 수 없어요. 눌러서 직접 넣기' : '눌러서 고치기'}" aria-label="${esc(label)}">`;
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
    <td>${numInput('before', r.key, r.b, r.rb, r.it.ko)}</td>
    <td>${numInput('after', r.key, r.a, r.ra, r.it.ko)}</td>
    <td class="${cls(r.delta)}"><b>${r.delta == null ? '?' : sfmt(r.delta)}</b></td>
    <td><input class="num" type="text" inputmode="numeric" maxlength="13" ${priceAttr}="${r.id}" value="${fmt(r.price)}" title="${esc(priceTitle)}" aria-label="${esc(r.it.ko)} 개당 가격"></td>
    <td class="${cls(r.value)}">${sfmt(r.value)}</td></tr>`;
}

function renderResult(c) {
  const box = $('#result');
  box.hidden = !c.ready;
  if (!c.ready) return;

  $('#totals').innerHTML = `
    <div class="total"><div class="k">메소 변화</div><div class="v ${cls(c.meso.delta)}">${sfmt(c.meso.delta)}</div></div>
    ${c.useReady ? `<div class="total"><div class="k">물약 금액 변화</div><div class="v ${cls(c.itemValue)}">${sfmt(c.itemValue)}</div></div>` : ''}
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
  if (!c.useReady) rows.push('<tr><td colspan="6" class="empty">사냥 전·후 소비 창 사진을 모두 넣으면 물약 사용량도 계산해요.</td></tr>');
  else if (!c.items.length) rows.push('<tr><td colspan="6" class="empty">사진에서 물약을 찾지 못했어요.</td></tr>');
  const unknownN = c.items.filter(r => r.unknown).length;
  if (unknownN) {
    const miss = SIDES.filter(s => !c.A[s].hasInv).map(s => SIDE_KO[s]).join('·');
    rows.push(`<tr><td colspan="6" class="empty">${miss} 소비 창 사진이 없어서, 퀵슬롯에 없던 물약 ${unknownN}종은 개수를 몰라 계산에서 뺐어요. 소비 창 사진을 넣거나 "?" 칸에 개수를 넣어 주세요.</td></tr>`);
  }
  $('#itemTable tbody').innerHTML = rows.join('');
  $('#useTitle').textContent = c.useReady ? '물약' : '메소';

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
  // "변화 없는 아이템 보기"를 펼쳐 둔 채 숫자를 고쳐도 접히지 않도록
  const wasOpen = !!$('#etcBox details.more[open]');
  $('#etcBox').innerHTML = etcHTML;
  if (wasOpen && $('#etcBox details.more')) $('#etcBox details.more').open = true;
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
    const etc = (h.etc || []).filter(r => r.delta !== 0);
    // 요약 줄 아이콘: 물약 변화가 없으면(기타 창만 넣은 기록 등) 기타 아이템 변화를 보여 준다
    const potions = h.items.filter(r => r.delta).map(r => ({ ...r, src: `assets/items/${r.icon}.png` }));
    const used = potions.length ? potions : etc.map(r => ({ ...r, src: `assets/etc/${r.icon}.png` }));
    return `<details class="rec" data-id="${h.id}">
      <summary>
        <span class="when">${when}</span>
        <span class="used px">${used.slice(0, 8).map(r => `<span title="${esc(r.name)}"><img src="${r.src}" alt="">${sfmt(r.delta)}</span>`).join('') || '<span class="when">아이템 변화 없음</span>'}</span>
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

// 표를 다시 그려도 키보드 위치(포커스)를 잃지 않도록:
// 칸을 고치고 Tab을 누르면 change가 먼저 오고 포커스는 그 다음 칸으로 옮겨 가므로, 옮겨 간 뒤에 다시 그리고 같은 칸을 찾아 포커스를 돌려준다
const focusKey = el => {
  if (!el || !el.dataset) return null;
  if (el.dataset.key) return `[data-side="${el.dataset.side}"][data-key="${el.dataset.key}"]`;
  if (el.dataset.price) return `[data-price="${el.dataset.price}"]`;
  if (el.dataset.eprice) return `[data-eprice="${el.dataset.eprice}"]`;
  const li = el.closest && el.closest('.shot');
  if (li && el.tagName === 'SELECT') return `.shot[data-id="${li.dataset.id}"] select`;
  return null;
};
function renderKeepFocus() {
  setTimeout(() => {
    const sel = focusKey(document.activeElement);
    render();
    const el = sel && $(sel);
    if (el && el !== document.activeElement) { el.focus(); if (el.select && el.tagName === 'INPUT') el.select(); }
  }, 0);
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
      const kind = kindOf(im);
      cur[side].images = cur[side].images.filter(x => x !== im); dropImage(im);
      if (kind !== 'unknown') clearEdits(side, kind);
      saveCur(); render();
      $('.drop', card).focus(); // 지운 사진 자리 대신 올리기 칸으로
    } else if (e.target.closest('.thumb')) openViewer(im, e.target.closest('.thumb'));
  });
  $('.shots', card).addEventListener('change', e => {
    const li = e.target.closest('.shot'); if (!li || e.target.tagName !== 'SELECT') return;
    const im = cur[side].images.find(x => x.id === li.dataset.id); if (!im) return;
    const before = kindOf(im);
    im.kind = e.target.value || null;
    const after = kindOf(im);
    if (before !== 'unknown') clearEdits(side, before);
    if (after !== 'unknown') clearEdits(side, after);
    // 종류를 손으로 고쳐도 다른 사진은 지우지 않는다 (같은 종류가 둘이면 나중에 넣은 사진이 쓰인다)
    const dup = after !== 'unknown' && cur[side].images.some(x => x !== im && kindOf(x) === after);
    if (dup) toast(`${SIDE_KO[side]}에 ${KIND_KO[after]} 사진이 두 장이에요. 필요 없는 사진은 ✕로 빼 주세요.`, { warn: true, ms: 5000 });
    saveCur(); renderKeepFocus();
  });
  card.addEventListener('focusin', () => setActive(side)); // 키보드로 옮겨 와도 Ctrl+V가 이쪽으로
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
const MAX_NUM = 9999999999; // 메소·개수·가격 모두 이보다 클 수 없다
$('#result').addEventListener('change', e => {
  const t = e.target;
  if (!t.dataset.key && !t.dataset.price && !t.dataset.eprice) return;
  // 음수나 너무 큰 수는 받지 않고 원래 값으로 되돌린다
  if (/-/.test(t.value)) { toast('0 이상의 숫자만 넣을 수 있어요.', { warn: true }); renderKeepFocus(); return; }
  const v = parseNum(t.value);
  if (v != null && v > MAX_NUM) { toast('숫자가 너무 커요. 다시 확인해 주세요.', { warn: true }); renderKeepFocus(); return; }
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
  }
  renderKeepFocus();
});
$('#result').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input.num')) e.target.blur(); });

$('#btnSave').addEventListener('click', () => {
  const c = last; if (!c || !c.ready) return;
  const row = r => ({ id: r.id, icon: r.it.icon, name: r.it.ko, before: r.b, after: r.a, delta: r.delta, price: r.price, value: r.value });
  const body = {
    meso: { before: c.meso.before, after: c.meso.after, delta: c.meso.delta },
    items: c.items.filter(r => !r.unknown).map(row), // 개수를 모르는 물약은 기록하지 않는다
    etc: c.etc.filter(r => r.delta !== 0).map(row),
    itemValue: c.itemValue, etcValue: c.etcValue, net: c.net
  };
  // 같은 결과를 두 번 저장하지 않는다
  const sig = JSON.stringify(body);
  if (history[0] && JSON.stringify({ meso: history[0].meso, items: history[0].items, etc: history[0].etc, itemValue: history[0].itemValue, etcValue: history[0].etcValue, net: history[0].net }) === sig) {
    toast('방금 저장한 결과와 같아요. 이미 기록에 있어요.'); return;
  }
  const rec = { id: uid(), date: Date.now(), ...body };
  history.unshift(rec);
  if (!store.set(K.hist, history)) { history.shift(); toast('저장 공간이 가득 찼어요. 오래된 기록을 지워 주세요.'); return; }
  renderHistory();
  toast('기록을 저장했어요.');
  $('#historyCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#btnReset').addEventListener('click', () => {
  if (!confirm('올린 사진과 고친 숫자를 모두 지우고 새로 시작할까요? (저장한 기록은 남아요)')) return;
  generation++; // 아직 인식 중인 사진은 버린다
  for (const s of SIDES) cur[s].images.forEach(dropImage);
  cur = empty(); results.clear(); pending.clear(); saveCur(); setActive('before'); render();
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
let viewerOpener = null; // 닫으면 이 버튼으로 포커스를 돌려준다
async function openViewer(im, opener) {
  viewerOpener = opener || null;
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
const closeViewer = () => {
  $('#viewer').hidden = true;
  if (viewerOpener && viewerOpener.isConnected) viewerOpener.focus();
  viewerOpener = null;
};
$('#viewerClose').addEventListener('click', closeViewer);
$('#viewer').addEventListener('click', e => { if (e.target.id === 'viewer') closeViewer(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#viewer').hidden) closeViewer(); });

/* ---------- 시작 ---------- */
applyTheme();
initCursor();
setActive(activeSide);
render();
renderHistory();
(async () => {
  // 새로고침 전에 넣어 둔 사진: 저장해 둔 인식 결과를 그대로 쓰고, 인식 방식이 바뀌었으면 다시 인식
  // (저장하지 못한 큰 사진은 뺀다)
  for (const s of SIDES) cur[s].images = cur[s].images.filter(im => im.dataURL);
  let redone = false;
  for (const s of SIDES) for (const im of cur[s].images) {
    // 썸네일은 큰 data: 주소 대신 가벼운 blob: 주소로
    if (!im._blob) try {
      im._blob = await (await fetch(im.dataURL)).blob();
      if (im._url && im._url.startsWith('data:')) im._url = null; // 처음 그릴 때 쓴 data: 주소는 버린다
    } catch {}
    if (im.res && im.res.v === VERSION) results.set(im.id, im.res);
    else { await runAnalysis(im); redone = true; }
  }
  if (redone) saveCur(); // 다시 인식한 결과를 저장해 두어 다음 새로고침에는 바로 보이게
  render();
})();
