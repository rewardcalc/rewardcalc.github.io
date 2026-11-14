/*
 * 인벤토리 / 퀵슬롯 스크린샷 인식
 *
 * 글자 인식(OCR) 대신 게임 원본 이미지와 픽셀을 직접 비교한다.
 *  - 아이템 아이콘 : 게임 클라이언트 Item.wz 원본 아이콘 (assets/items)
 *  - 개수 숫자     : UI.wz Basic.img/ItemNo 원본 숫자 (assets/digit)
 *  - 메소          : 굴림 11px (안티에일리어싱 없음) 글자 모양
 *  - 메소 위치     : 인벤토리 아래쪽 동전 아이콘 (assets/coin.png)
 * 스크린샷이 확대/축소되지 않은 원본(PNG)이어야 정확하다.
 */

const TOL = 10;                       // 색 허용 오차
const CELL_BORDER = [0xCE, 0xC9, 0xBE]; // 인벤토리 칸 왼쪽/위쪽 테두리
const CELL_BG = [0xE1, 0xDF, 0xD5];     // 인벤토리 칸 바탕
const CELL = 32;                        // 칸 크기
// 인식 방식이 바뀌면 올린다 → 저장해 둔 인식 결과를 버리고 다시 인식
export const VERSION = 5;

// 메소 칸 숫자(굴림 11px) 모양
const GULIM = {
  '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '1': ['..#', '###', '..#', '..#', '..#', '..#', '..#', '..#'],
  '2': ['.###.', '#...#', '#...#', '...#.', '..#..', '.#...', '#....', '#####'],
  '3': ['.###.', '#...#', '....#', '.###.', '....#', '....#', '#...#', '.###.'],
  '4': ['..##.', '..##.', '.#.#.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '...#.', '...#.', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  ',': ['.#', '.#', '#.']
};

/* ---------- 이미지 → 픽셀 ---------- */
// 화면(main)과 백그라운드 작업(worker) 어디서든 쓸 수 있는 캔버스
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function bitmapPixels(bmp) {
  const w = bmp.width, h = bmp.height, c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w, h, d: ctx.getImageData(0, 0, w, h).data };
}
async function pixelsFromSource(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${res.status} ${src}`);
  return bitmapPixels(await createImageBitmap(await res.blob()));
}

function makeTemplate(key, px) {
  const pts = [];
  for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
    const i = (y * px.w + x) * 4;
    if (px.d[i + 3] >= 250) pts.push(x, y, px.d[i], px.d[i + 1], px.d[i + 2]);
  }
  const n = pts.length / 5;
  // 빠른 후보 검사용 기준점: 오른쪽 절반(숫자·단축키 글자가 덜 덮는 곳)에서 고르게 8개
  const right = [];
  for (let k = 0; k < n; k++) if (pts[k * 5] >= px.w / 2) right.push(k);
  const pool = right.length >= 8 ? right : [...Array(n).keys()];
  const anchors = [];
  for (let j = 0; j < 8 && pool.length; j++) anchors.push(pool[Math.floor((j + 0.5) * pool.length / 8)]);
  // 퀵슬롯용: 칸에 잘리는 윗부분과 단축키 글자가 덮는 왼쪽을 뺀 오른쪽 아래 영역
  const q = [];
  for (let k = 0; k < n; k++) if (pts[k * 5] >= px.w * 0.4 && pts[k * 5 + 1] >= 8) q.push(...pts.slice(k * 5, k * 5 + 5));
  const qn = q.length / 5, qa = [];
  for (let j = 0; j < 8 && qn; j++) qa.push(Math.floor((j + 0.5) * qn / 8));
  const quick = { pts: q, n: qn, anchors: qa, primary: pickPrimary(q, qn, () => true) };
  // 오른쪽 위쪽(개수 숫자와 먼 곳)의 눈에 띄는 색
  const primary = pickPrimary(pts, n, (x, y) => x >= px.w * 0.45 && y <= px.h * 0.6);
  // 점들을 고르게 섞은 순서 (앞쪽 몇 개만 봐도 아이콘 전체를 대표하도록)
  const mix = new Int32Array(n);
  let s = n > 1 ? 7919 % n || 1 : 1;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  while (n > 1 && gcd(s, n) !== 1) s++;
  for (let j = 0; j < n; j++) mix[j] = (j * s) % n;
  // 실제로 그려지는 점들의 범위
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let k = 0; k < n; k++) { const x = pts[k * 5], y = pts[k * 5 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { key, w: px.w, h: px.h, pts, n, anchors, primary, quick, mix, x0, y0, x1, y1 };
}

// 큰 화면에서 빠르게 찾기 위한 "대표 픽셀" 3개: 채도가 높고 너무 어둡거나 밝지 않은 색, 서로 떨어진 곳
function pickPrimary(P, n, prefer) {
  const c = [];
  for (let k = 0; k < n; k++) {
    const x = P[k * 5], y = P[k * 5 + 1], r = P[k * 5 + 2], g = P[k * 5 + 3], b = P[k * 5 + 4];
    const lum = (r + g + b) / 3;
    if (lum < 35) continue; // 검은 테두리는 어디에나 있어서 후보가 너무 많아진다
    // 채도가 높을수록, 아주 밝은 색(흰색)은 낮게
    c.push({ k, x, y, s: Math.max(r, g, b) - Math.min(r, g, b) + (prefer(x, y) ? 100 : 0) - (lum > 235 ? 200 : 0) });
  }
  c.sort((a, b) => b.s - a.s);
  const out = [];
  for (const e of c) {
    if (out.some(o => Math.abs(P[o * 5] - e.x) + Math.abs(P[o * 5 + 1] - e.y) < 5)) continue;
    out.push(e.k);
    if (out.length === 3) break;
  }
  if (!out.length && n) out.push(0);
  return out;
}

// 대표 픽셀 색과 비슷한 색이 있는 위치만 모아 둔다 (색을 8단계씩 묶어 이웃 칸까지)
const qkey = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
function colorBuckets(img, colors) {
  const map = new Map();
  for (const [r, g, b] of colors) {
    const R = r >> 3, G = g >> 3, B = b >> 3;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const rr = R + dr, gg = G + dg, bb = B + db;
      if (rr < 0 || gg < 0 || bb < 0 || rr > 31 || gg > 31 || bb > 31) continue;
      const k = (rr << 10) | (gg << 5) | bb;
      if (!map.has(k)) map.set(k, []);
    }
  }
  const { w, h, d } = img, N = w * h;
  // 32단계로 묶은 색마다 바로 찾을 수 있게 표(32768칸)를 만들어 Map 조회를 피한다
  const want = new Uint8Array(32768);
  for (const k of map.keys()) want[k] = 1;
  for (let p = 0; p < N; p++) {
    const k = qkey(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
    if (want[k]) map.get(k).push(p);
  }
  return map;
}

// 템플릿 t(또는 그 일부 src)의 대표 픽셀이 맞는 자리만 후보로 돌려준다 (왼쪽 위 기준 위치 = y*w+x)
function candidates(img, buckets, t, src, tol = TOL) {
  const { w, h, d } = img, P = src.pts, cand = new Set();
  for (const a of src.primary) {
    const r = P[a * 5 + 2], g = P[a * 5 + 3], b = P[a * 5 + 4], R = r >> 3, G = g >> 3, B = b >> 3;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const list = buckets.get(((R + dr) << 10) | ((G + dg) << 5) | (B + db));
      if (!list) continue;
      for (const p of list) {
        if (!same(d, p * 4, r, g, b, tol)) continue;
        const ox = (p % w) - P[a * 5], oy = ((p / w) | 0) - P[a * 5 + 1];
        if (ox >= 0 && oy >= 0 && ox + t.w <= w && oy + t.h <= h) cand.add(oy * w + ox);
      }
    }
  }
  return cand;
}
// 분석 한 번에 필요한 모든 대표 색을 모아 한 번만 훑는다
function allPrimaryColors(tpl) {
  const cols = [];
  const add = s => s.primary.forEach(k => cols.push(s.pts.slice(k * 5 + 2, k * 5 + 5)));
  // 퀵슬롯 찾기는 소비 아이템만 하므로 기타 아이템의 퀵슬롯용 색은 필요 없다
  for (const t of tpl.icons) { add(t); if (!String(t.key).startsWith('e:')) add(t.quick); }
  for (const t of tpl.digits) add(t);
  add(tpl.coin);
  return cols;
}

/* ---------- 템플릿 준비 ---------- */
// icons: [{ key, url }] — key는 인식 결과에 그대로 돌려준다
// base: 숫자·동전 이미지 경로의 기준 주소 (백그라운드 작업에서도 같은 곳을 가리키도록)
export async function loadTemplates(icons, base = (typeof location !== 'undefined' ? location.href : '')) {
  const load = async url => { try { return await pixelsFromSource(url); } catch (e) { return await pixelsFromSource(url + '?r=1'); } };
  const abs = p => new URL(p, base).href;
  // 아이콘·숫자·동전·커서 140여 개를 48개씩 동시에 불러온다 (실패한 것은 load가 한 번 더 시도)
  const list = [
    ...icons.map(ic => ({ key: ic.key, url: ic.url, group: 'icons' })),
    ...[...'0123456789'].map(d => ({ key: d, url: abs(`assets/digit/${d}.png`), group: 'digits' })),
    { key: 'coin', url: abs('assets/coin.png'), group: 'coin' },
    ...['normal', 'hover0', 'hover1', 'hover2', 'hover3', 'press', 'grab0', 'grab1', 'grab2'].map(c => ({ key: c, url: abs(`assets/cursor/${c}.png`), group: 'cursors' }))
  ];
  const tpl = { icons: [], digits: [], coin: null, cursors: [], missing: 0 }; // missing: 못 받은 아이콘 수
  for (let i = 0; i < list.length; i += 48) {
    // 아이템 아이콘 하나를 못 받으면 그 아이템만 빼고 계속한다 (숫자·동전·커서는 꼭 있어야 한다)
    const batch = await Promise.all(list.slice(i, i + 48).map(async e => {
      try { return { e, t: makeTemplate(e.key, await load(e.url)) }; }
      catch (err) { if (e.group === 'icons') { console.warn('icon skipped', e.url); tpl.missing++; return null; } throw err; }
    }));
    for (const b of batch) if (b) b.e.group === 'coin' ? (tpl.coin = b.t) : tpl[b.e.group].push(b.t);
  }
  tpl.colors = allPrimaryColors(tpl);
  return tpl;
}

/* ---------- 픽셀 비교 ---------- */
function same(d, i, r, g, b, tol = TOL) {
  return Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - g) <= tol && Math.abs(d[i + 2] - b) <= tol;
}
// 퀵슬롯 단축키 글자처럼 반투명한 흰색이 덮인 픽셀도 같은 것으로 본다
function sameOrWhitened(d, i, r, g, b) {
  if (same(d, i, r, g, b)) return true;
  const R = d[i], G = d[i + 1], B = d[i + 2];
  if (R < r - TOL || G < g - TOL || B < b - TOL) return false;
  const a = [];
  if (r < 235) a.push((R - r) / (255 - r));
  if (g < 235) a.push((G - g) / (255 - g));
  if (b < 235) a.push((B - b) / (255 - b));
  if (!a.length) return true;
  const lo = Math.min(...a), hi = Math.max(...a);
  return hi - lo < 0.14 && hi < 0.85;
}

// 템플릿이 (ox, oy)에 그려져 있는지: 가려진(mask) 픽셀은 빼고 일치 비율을 계산
function score(img, mask, t, ox, oy, minScore, whiten) {
  const { w, d } = img;
  const src = whiten ? t.quick : t, pts = src.pts, n = src.n;
  let ok = 0, seen = 0, bad = 0;
  const maxBad = Math.ceil(n * (1 - minScore));
  for (let k = 0; k < n; k++) {
    const x = ox + pts[k * 5], y = oy + pts[k * 5 + 1], p = y * w + x;
    if (mask && mask[p]) continue;
    seen++;
    const m = whiten ? sameOrWhitened(d, p * 4, pts[k * 5 + 2], pts[k * 5 + 3], pts[k * 5 + 4])
                     : same(d, p * 4, pts[k * 5 + 2], pts[k * 5 + 3], pts[k * 5 + 4]);
    if (m) ok++; else if (++bad > maxBad) return 0;
  }
  return seen >= n * 0.4 ? ok / seen : 0;
}

/* ---------- 개수 숫자 ---------- */
function findDigits(img, digits, buckets) {
  const { w, h, d } = img, hits = [];
  for (const t of digits) {
    for (const o of candidates(img, buckets, t, t, 8)) {
      const x = o % w, y = (o / w) | 0;
      let k = 0;
      for (; k < t.n; k++) {
        const p = ((y + t.pts[k * 5 + 1]) * w + x + t.pts[k * 5]) * 4;
        if (!same(d, p, t.pts[k * 5 + 2], t.pts[k * 5 + 3], t.pts[k * 5 + 4], 8)) break;
      }
      if (k === t.n) hits.push({ ch: t.key, x, y, w: t.w, h: t.h, t });
    }
  }
  const mask = new Uint8Array(w * h);
  return { runs: digitRuns(hits, mask, w), mask };
}
// 찾은 숫자들을 줄(여러 자리 수)로 묶고, 숫자가 덮은 픽셀을 mask에 표시한다
function digitRuns(hits, mask, w) {
  // 겹치는 후보는 픽셀이 더 많은 숫자를 남긴다
  hits.sort((a, b) => b.t.n - a.t.n);
  const kept = [];
  for (const hcur of hits) if (!kept.some(k => k.y === hcur.y && hcur.x < k.x + k.w - 1 && k.x < hcur.x + hcur.w - 1)) kept.push(hcur);
  // 같은 줄에서 바로 붙어 있는 숫자끼리 묶기
  kept.sort((a, b) => a.y - b.y || a.x - b.x);
  const runs = [];
  for (const g of kept) {
    const r = runs.find(r => r.y === g.y && Math.abs(r.x2 - g.x) <= 1);
    if (r) { r.text += g.ch; r.x2 = g.x + g.w; r.parts.push(g); }
    else runs.push({ x: g.x, y: g.y, x2: g.x + g.w, h: g.h, text: g.ch, parts: [g] });
  }
  for (const g of kept) for (let k = 0; k < g.t.n; k++) mask[(g.y + g.t.pts[k * 5 + 1]) * w + g.x + g.t.pts[k * 5]] = 1;
  return runs.map(r => ({ x: r.x, y: r.y, w: r.x2 - r.x, h: r.h, value: parseInt(r.text, 10) }));
}

/* ---------- 주황색 틀 ---------- */
// 게임이 아이템 칸 둘레에 주황·노란색 틀을 그려 둘 때가 있다(둘레를 따라 빛이 돈다).
// 틀은 칸 테두리와 그 안쪽 2~3픽셀을 덮어서, 칸을 꽉 채우는 아이콘은 가장자리가 가려진다.
// → 틀이 있는 칸은 가장자리 띠를 "안 보이는 곳"(mask)으로 치고 나머지로만 비교한다.
const FRAME_IN = 2; // 칸 안쪽으로 늘 가려진다고 보는 두께 (그 안쪽 3픽셀은 틀 색일 때만)
const isFrameColor = (d, i) => d[i] >= 200 && d[i + 1] >= 130 && d[i + 2] <= 215 && d[i] - d[i + 2] >= 35 && d[i] >= d[i + 1] - 6;
function hasFrame(img, x, y) {
  const { w, h, d } = img, side = [0, 0, 0, 0];
  const hit = (px, py, s) => { if (px >= 0 && py >= 0 && px < w && py < h && isFrameColor(d, (py * w + px) * 4)) side[s]++; };
  for (let k = 0; k < CELL; k++) for (let o = -2; o <= 2; o++) {
    hit(x + k, y + o, 0); hit(x + k, y + CELL - 1 + o, 1); hit(x + o, y + k, 2); hit(x + CELL - 1 + o, y + k, 3);
  }
  // 네 변 가운데 세 변 이상에 틀 색이 이어져 있어야 한다 (노란 아이템이 칸 한쪽에 닿은 것과 구분)
  return side.filter(n => n >= 12).length >= 3;
}
function maskFrame(img, mask, c) {
  const { w, h, d } = img;
  for (let y = c.y - 3; y < c.y + CELL + 3; y++) for (let x = c.x - 3; x < c.x + CELL + 3; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const edge = Math.min(x - c.x, c.x + CELL - 1 - x, y - c.y, c.y + CELL - 1 - y); // 칸 가장자리에서 안쪽으로 몇 픽셀
    if (edge < FRAME_IN || (edge < FRAME_IN + 3 && isFrameColor(d, (y * w + x) * 4))) mask[y * w + x] = 1;
  }
}
// 틀이 있는 칸의 개수 숫자: 숫자는 칸 왼쪽 끝에서 시작해서 첫 자리가 틀에 덮일 수 있다 → 틀 자리(ring)는 빼고 다시 맞춰 본다
function framedDigits(img, ring, mask, c, digits) {
  const { w, h, d } = img;
  const x0 = c.x - 2, x1 = c.x + 26, y0 = c.y + 10, y1 = c.y + 24;
  const hits = [];
  for (const t of digits) for (let y = y0; y <= y1; y++) for (let x = Math.max(0, x0); x <= x1; x++) {
    if (y < 0 || x + t.w > w || y + t.h > h) continue;
    let seen = 0, k = 0;
    for (; k < t.n; k++) {
      const p = (y + t.pts[k * 5 + 1]) * w + x + t.pts[k * 5];
      if (ring[p]) continue;
      if (!same(d, p * 4, t.pts[k * 5 + 2], t.pts[k * 5 + 3], t.pts[k * 5 + 4], 8)) break;
      seen++;
    }
    if (k === t.n && seen >= t.n * 0.45) hits.push({ ch: t.key, x, y, w: t.w, h: t.h, t });
  }
  // 틀에 가려진 부분 때문에 두 숫자(3과 8 등)가 모두 맞으면 확실하지 않은 것으로 알린다
  const unsure = hits.some(a => hits.some(b => a !== b && a.x === b.x && a.y === b.y));
  return { runs: digitRuns(hits, mask, w), unsure };
}

/* ---------- 아이템 아이콘 ---------- */
function findIcons(img, mask, icons, whiten, buckets) {
  const { w, d } = img, found = [];
  const minScore = whiten ? 0.88 : 0.9, maxMiss = 2;
  for (const t of icons) {
    const src = whiten ? t.quick : t, P = src.pts;
    // 대표 픽셀이 맞는 자리만 후보로
    for (const o of candidates(img, buckets, t, src)) {
      const x = o % w, y = (o / w) | 0;
      let chk = 0, miss = 0;
      for (const k of src.anchors) {
        const p = (y + P[k * 5 + 1]) * w + x + P[k * 5];
        if (mask[p]) continue;
        chk++;
        const m = whiten ? sameOrWhitened(d, p * 4, P[k * 5 + 2], P[k * 5 + 3], P[k * 5 + 4])
                         : same(d, p * 4, P[k * 5 + 2], P[k * 5 + 3], P[k * 5 + 4]);
        if (!m && ++miss > maxMiss) break;
      }
      if (miss > maxMiss || chk < 3) continue;
      const s = score(img, mask, t, x, y, minScore, whiten);
      if (s >= minScore) found.push({ icon: t.key, x, y, w: t.w, h: t.h, score: s });
    }
  }
  // 같은 자리에 여러 후보가 있으면 가장 잘 맞는 것만
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of found) if (!kept.some(k => overlap(k, f) > 0.3)) kept.push(f);
  return kept;
}
function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
}

/* ---------- 인벤토리 칸 격자 ---------- */
// 칸 왼쪽 위 모서리(테두리 3픽셀 + 바탕 1픽셀)를 모두 찾은 뒤, 서로 붙어 있는 가장 큰 무리(= 인벤토리 창)만 쓴다.
// 화면 전체 캡처에 다른 창의 비슷한 칸이 함께 찍혀 있어도 섞이지 않는다.
function findGrid(img) {
  const { w, h, d } = img, W4 = w * 4;
  const [br, bgg, bb] = CELL_BORDER, [gr, gg, gb] = CELL_BG;
  const isB = p => Math.abs(d[p] - br) <= 4 && Math.abs(d[p + 1] - bgg) <= 4 && Math.abs(d[p + 2] - bb) <= 4;
  const isG = p => Math.abs(d[p] - gr) <= 4 && Math.abs(d[p + 1] - gg) <= 4 && Math.abs(d[p + 2] - gb) <= 4;
  const hx = [], hy = [];
  scan: for (let y = 0; y < h - 1; y++) for (let x = 0, p = y * W4; x < w - 1; x++, p += 4) {
    if (Math.abs(d[p] - br) > 4) continue; // 빨강 값만으로 먼저 거른다
    if (isB(p) && isB(p + 4) && isB(p + W4) && isG(p + W4 + 4)) { hx.push(x); hy.push(y); }
    if (hx.length > 2000) break scan;
  }
  const N = hx.length;
  if (N < 2) return null;
  // 칸 간격: 같은 줄(열)에 있는 모서리끼리 가장 흔한 거리
  const pitch = (A, B, lo, hi) => {
    const cnt = {};
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (B[i] !== B[j]) continue;
      const dd = A[j] - A[i];
      if (dd >= lo && dd <= hi) cnt[dd] = (cnt[dd] || 0) + 1;
    }
    const k = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    return k ? +k : 0;
  };
  const sx = pitch(hx, hy, 30, 45) || 36, sy = pitch(hy, hx, 28, 42) || 34;
  // 가까이(칸 2개 반 이내) 있는 모서리끼리 한 무리로 묶고 가장 큰 무리를 고른다
  const group = new Int32Array(N).fill(-1);
  let best = [];
  for (let s = 0; s < N; s++) {
    if (group[s] >= 0) continue;
    const members = [s], stack = [s]; group[s] = s;
    while (stack.length) {
      const i = stack.pop();
      for (let j = 0; j < N; j++) {
        if (group[j] >= 0 || Math.abs(hx[j] - hx[i]) > sx * 2.5 || Math.abs(hy[j] - hy[i]) > sy * 2.5) continue;
        group[j] = s; members.push(j); stack.push(j);
      }
    }
    if (members.length > best.length) best = members;
  }
  // 무리 안에서 빠진 줄(가려진 칸)을 칸 간격으로 채운다
  const fill = (vals, step) => {
    const v = [...new Set(vals)].sort((a, b) => a - b), out = [v[0]];
    for (let i = 1; i < v.length; i++) {
      if (v[i] - out[out.length - 1] < step * 0.5) continue; // 같은 줄로 본다
      while (v[i] - out[out.length - 1] > step * 1.5) out.push(out[out.length - 1] + step);
      out.push(v[i]);
    }
    return out;
  };
  const X = fill(best.map(i => hx[i]), sx), Y = fill(best.map(i => hy[i]), sy);
  const cells = []; let covered = 0;
  for (const y of Y) for (const x of X) {
    if (x + CELL > w || y + CELL > h) continue;
    let bgN = 0, border = 0;
    for (let yy = y; yy < y + CELL; yy += 2) for (let xx = x; xx < x + CELL; xx += 2) if (isG((yy * w + xx) * 4)) bgN++;
    for (let k = 0; k < CELL; k++) { if (isB(((y + k) * w + x) * 4)) border++; if (isB((y * w + x + k) * 4)) border++; }
    // 주황색 틀이 둘린 칸은 바탕이 덜 보여도 칸으로 친다
    const framed = hasFrame(img, x, y);
    if (bgN >= 25 || framed) cells.push(framed ? { x, y, w: CELL, h: CELL, framed } : { x, y, w: CELL, h: CELL });
    else if (border < 6) covered++; // 칸 바탕도 테두리도 안 보임 = 다른 창 등에 가려짐
  }
  if (!cells.length) return null;
  cells.covered = covered;
  return cells;
}

/* ---------- 가려진 곳 찾기 ---------- */
// 칸 안에 바탕이 아닌 픽셀이 어느 정도 있으면 = 무언가 들어 있음
function cellHasContent(img, mask, c) {
  const { w, d } = img; let n = 0;
  for (let y = c.y + 1; y < c.y + CELL; y++) for (let x = c.x + 1; x < c.x + CELL; x++) {
    const p = y * w + x;
    if (mask[p] || same(d, p * 4, ...CELL_BG, 6) || same(d, p * 4, ...CELL_BORDER, 6)) continue;
    if (++n >= 40) return true;
  }
  return false;
}

// 게임 마우스 커서 (게임이 직접 그리는 커서라 캡처에 찍힌다). 사각형 r과 겹치는 위치만 본다.
function findCursor(img, cursors, r) {
  const { w, h, d } = img;
  for (const t of cursors) {
    const P = t.pts, A = t.primary;
    const ya = Math.max(0, r.y0 - t.h + 1), yb = Math.min(h - t.h, r.y1);
    const xa = Math.max(0, r.x0 - t.w + 1), xb = Math.min(w - t.w, r.x1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      let ok = true;
      for (const k of A) if (!same(d, ((y + P[k * 5 + 1]) * w + x + P[k * 5]) * 4, P[k * 5 + 2], P[k * 5 + 3], P[k * 5 + 4])) { ok = false; break; }
      if (ok && score(img, null, t, x, y, 0.85, false) >= 0.85) return { t, x, y };
    }
  }
  return null;
}

// 템플릿 t를 (ox, oy)에 놓았을 때, "보이는 부분은 그대로 맞고 나머지는 무언가에 덮였는지" 판단한다.
//  - hide(커서 자리)에 덮인 경우: 보이는 점이 거의 다 맞아야 한다
//  - 창·설명 상자 같은 사각형에 덮인 경우: 안 맞는 점들이 템플릿 가장자리에서 들어온 한 덩어리여야 한다
//    (비슷하게 생긴 다른 아이템은 안 맞는 점이 아이콘 곳곳에 흩어져 있어서 걸러진다)
const OKBUF = new Uint8Array(4096);
function occludedAt(img, mask, hide, t, ox, oy, tol, minVisible) {
  const { w, d } = img, P = t.pts, n = t.n;
  let ok = 0, bad = 0, hid = 0, skip = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
  const maxBad = n * (1 - minVisible);
  for (let k = 0; k < n; k++) {
    const px = P[k * 5], py = P[k * 5 + 1], p = (oy + py) * w + ox + px;
    OKBUF[k] = 2;
    if (mask[p]) { skip++; continue; }
    if (hide && hide[p]) { hid++; continue; }
    if (same(d, p * 4, P[k * 5 + 2], P[k * 5 + 3], P[k * 5 + 4], tol)) { ok++; OKBUF[k] = 1; continue; }
    OKBUF[k] = 0;
    if (++bad > maxBad) return false;
    if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
  }
  const seen = ok + bad;
  if (skip > n * 0.2 || ok < n * minVisible) return false;
  if (hid >= Math.max(3, n * 0.05) && bad <= seen * 0.08) return true; // 커서에 덮임
  if (bad < Math.max(3, seen * 0.08)) return false;                    // 다 보임 = 가려진 게 아님
  const edge = bx0 <= t.x0 + 1 || by0 <= t.y0 + 1 || bx1 >= t.x1 - 1 || by1 >= t.y1 - 1;
  if (!edge) return false;
  let inOk = 0, inAll = 0;
  for (let k = 0; k < n; k++) {
    if (OKBUF[k] === 2) continue;
    const px = P[k * 5], py = P[k * 5 + 1];
    if (px < bx0 || px > bx1 || py < by0 || py > by1) continue;
    inAll++; if (OKBUF[k] === 1) inOk++;
  }
  return inOk <= inAll * 0.05;
}

// 칸 안에 아는 아이콘이 일부만 보이는지
function partialIconIn(img, mask, hide, c, icons) {
  const { w, h, d } = img;
  for (const t of icons) {
    const P = t.pts, n = t.n, mix = t.mix;
    for (let oy = c.y - 4; oy <= c.y + 8; oy++) for (let ox = c.x - 4; ox <= c.x + 8; ox++) {
      if (ox < 0 || oy < 0 || ox + t.w > w || oy + t.h > h) continue;
      // 아이콘 전체에 고르게 퍼진 16점 중 3점 이상 맞는 자리만 자세히 본다
      let q = 0, qs = 0;
      for (let j = 0; j < n && qs < 16; j++) {
        const k = mix[j], p = (oy + P[k * 5 + 1]) * w + ox + P[k * 5];
        if (mask[p] || (hide && hide[p])) continue;
        qs++;
        if (same(d, p * 4, P[k * 5 + 2], P[k * 5 + 3], P[k * 5 + 4])) q++;
      }
      if (q < 3) continue;
      if (occludedAt(img, mask, hide, t, ox, oy, TOL, 0.35)) return true;
    }
  }
  return false;
}

// 칸의 개수 숫자 줄(dy: 칸 위에서 숫자까지 거리)에 일부만 보이는 숫자가 있는지
function partialDigitIn(img, mask, hide, c, digits, dy) {
  const { w, h } = img;
  const ys = dy == null ? [14, 26] : [dy, dy];
  for (let y0 = c.y + ys[0]; y0 <= c.y + ys[1]; y0++) for (let x0 = c.x - 1; x0 <= c.x + 24; x0++) {
    for (const t of digits) {
      if (x0 < 0 || y0 < 0 || x0 + t.w > w || y0 + t.h > h) continue;
      if (occludedAt(img, mask, hide, t, x0, y0, 8, 0.4)) return true;
    }
  }
  return false;
}

// 화면 쪽에 알려 줄 "가려진 곳" 목록
function findWarnings(ctx, tpl) {
  const { img, mask, grid, known, coin, meso, kind, digitDy, cellRuns, unsure } = ctx, warn = {};
  if (!grid) return warn;
  const { w } = img;
  if (!coin) warn.meso = 'hidden';                 // 동전·메소 칸이 안 보임
  else if (meso == null) warn.meso = 'unreadable';   // 메소 숫자를 못 읽음
  if (grid.covered) warn.covered = grid.covered;     // 칸 전체가 가려짐

  // 인벤토리(+메소 칸) 위에 게임 커서가 있으면 그 자리는 "가려진 곳"으로 따로 표시
  const gx0 = Math.min(...grid.map(c => c.x)), gy0 = Math.min(...grid.map(c => c.y));
  const gx1 = Math.max(...grid.map(c => c.x + CELL)), gy1 = Math.max(...grid.map(c => c.y + CELL));
  const mesoBox = coin ? { x0: coin.x + 14, y0: coin.y - 4, x1: coin.x + 175, y1: coin.y + 18 } : null;
  const cur = tpl.cursors ? findCursor(img, tpl.cursors, { x0: gx0, y0: gy0, x1: gx1, y1: Math.max(gy1, mesoBox ? mesoBox.y1 : 0) }) : null;
  let hide = null;
  if (cur) {
    hide = new Uint8Array(img.w * img.h);
    for (let k = 0; k < cur.t.n; k++) hide[(cur.y + cur.t.pts[k * 5 + 1]) * w + cur.x + cur.t.pts[k * 5]] = 1;
  }
  const cursorOver = (x0, y0, x1, y1) => {
    if (!cur) return false;
    const P = cur.t.pts;
    for (let k = 0; k < cur.t.n; k++) {
      const x = cur.x + P[k * 5], y = cur.y + P[k * 5 + 1];
      if (x >= x0 && x < x1 && y >= y0 && y < y1) return true;
    }
    return false;
  };

  const taken = new Set(known.map(k => k.box));
  const content = grid.filter(c => taken.has(c) || cellHasContent(img, mask, c));
  const suspects = content.filter(c => !taken.has(c));
  // 아는 아이템인데 아이콘 일부가 가려져서 못 알아본 칸 (기타 창이면 기타 아이템만, 소비 창이면 소비 아이템만 비교)
  const pool = tpl.icons.filter(t => String(t.key).startsWith('e:') === (kind === 'etc'));
  const hiddenItems = suspects.filter(c => partialIconIn(img, mask, hide, c, pool)).length;
  if (hiddenItems) warn.items = hiddenItems;
  // 개수 숫자가 일부 가려진 칸
  // 커서는 읽은 숫자 바로 앞·뒤의 "숫자 하나 들어갈 자리"를 절반 넘게 덮을 때만 문제다
  // (숫자가 조금이라도 보이면 아래 partialDigitIn이 찾는다)
  const dh = tpl.digits[0].h, dw = Math.max(...tpl.digits.map(t => t.w));
  const slotHidden = (x0, y0) => {
    let n = 0;
    for (let y = y0; y < y0 + dh; y++) for (let x = x0; x < x0 + dw; x++) if (hide[y * w + x]) n++;
    return n >= dw * dh * 0.5;
  };
  const cursorOnDigits = c => {
    if (!cur || digitDy == null) return false;
    const r = cellRuns.get(c), y0 = c.y + digitDy;
    if (!r) return slotHidden(c.x + 1, y0);
    return (r.x - c.x >= dw && slotHidden(r.x - dw, y0)) || slotHidden(r.x + r.w, y0);
  };
  // unsure: 주황색 틀에 앞자리가 가려져 확실히 읽지 못한 칸
  const hiddenCounts = content.filter(c => cursorOnDigits(c) || partialDigitIn(img, mask, hide, c, tpl.digits, digitDy)).length + (unsure || 0);
  if (hiddenCounts) warn.counts = hiddenCounts;
  // 메소 숫자 위에 커서
  if (mesoBox && cursorOver(mesoBox.x0, mesoBox.y0, mesoBox.x1, mesoBox.y1)) warn.meso = 'unreadable';
  // 커서 때문에 생긴 문제면 문구에서 커서를 콕 집어 말한다
  if (cur && (warn.items || warn.counts || warn.meso === 'unreadable')) warn.cursor = true;
  return warn;
}

/* ---------- 선택된 탭 ---------- */
// 인벤토리 창 위쪽 탭 줄(첫 칸보다 7~27px 위)에서 붉게 칠해진 탭 = 지금 보고 있는 탭
// 탭은 왼쪽부터 장비·소비·설치·기타·캐시·꾸미기, 첫 칸 왼쪽 6px 앞에서 시작해 33px 간격
// 칸이 5열 모두 보일 때만 믿는다: 첫 열이 잘리거나 가려지면 탭 위치가 한 칸씩 밀리기 때문
const TABS = ['equip', 'use', 'setup', 'etc', 'cash', 'deco'];
function activeTab(img, gb) {
  const { w, h, d } = img;
  const y0 = gb.y0 - 27, y1 = gb.y0 - 7;
  if (y0 < 0 || gb.x1 - gb.x0 < 36 * 4 + CELL - 2) return null; // 5열 = 칸 간격 36px × 4 + 칸 32px
  const red = TABS.map((_, k) => {
    let n = 0;
    const xa = gb.x0 - 6 + 33 * k + 4, xb = xa + 25;
    for (let y = y0; y < y1 && y < h; y++) for (let x = Math.max(0, xa); x < xb && x < w; x++) {
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 150 && r - g > 50 && r - b > 30) n++;
    }
    return n;
  });
  const best = red.indexOf(Math.max(...red));
  const second = Math.max(...red.filter((_, k) => k !== best));
  return red[best] >= 60 && red[best] >= second * 3 ? TABS[best] : null;
}

/* ---------- 메소 ---------- */
// near가 있으면 인벤토리 칸 바로 아래에 있는 동전만, 없으면 가장 아래쪽 동전
function findCoin(img, coin, buckets, near) {
  const { w } = img;
  let best = null;
  for (const o of candidates(img, buckets, coin, coin)) {
    const x = o % w, y = (o / w) | 0;
    if (near && (x < near.x0 - 30 || x > near.x1 || y < near.y1 - 4 || y > near.y1 + 70)) continue;
    if (score(img, null, coin, x, y, 0.95, false) >= 0.95 && (!best || y > best.y)) best = { x, y };
  }
  return best;
}
const GLYPHS = Object.entries(GULIM).map(([ch, rows]) => ({ ch, w: rows[0].length, h: rows.length, rows }));
function readMeso(img, coin) {
  const { w, h, d } = img;
  const y0 = Math.max(0, coin.y - 4), y1 = Math.min(h, coin.y + 18);
  const x0 = coin.x + 16, x1 = Math.min(w, coin.x + 175);
  const dark = (x, y) => { const i = (y * w + x) * 4; return d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60; };
  // 검은 픽셀 덩어리(8방향 연결)마다 한 글자 — 쉼표가 숫자에 바짝 붙어 있어도 나눠진다
  const seen = new Set(), comps = [];
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
    const key = y * w + x;
    if (seen.has(key) || !dark(x, y)) continue;
    const stack = [[x, y]], c = { x0: x, x1: x, y0: y, y1: y };
    seen.add(key);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      c.x0 = Math.min(c.x0, cx); c.x1 = Math.max(c.x1, cx); c.y0 = Math.min(c.y0, cy); c.y1 = Math.max(c.y1, cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, k = ny * w + nx;
        if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1 || seen.has(k) || !dark(nx, ny)) continue;
        seen.add(k); stack.push([nx, ny]);
      }
    }
    comps.push(c);
  }
  if (!comps.length) return null;
  comps.sort((a, b) => a.x0 - b.x0);
  let out = '';
  for (const c of comps) {
    const gw = c.x1 - c.x0 + 1, gh = c.y1 - c.y0 + 1;
    const g = GLYPHS.find(g => g.w === gw && g.h === gh && g.rows.every((row, ry) => [...row].every((ch, rx) => (ch === '#') === dark(c.x0 + rx, c.y0 + ry))));
    if (!g) return null;
    if (g.ch !== ',') out += g.ch;
  }
  return out ? parseInt(out, 10) : null;
}

/* ---------- 전체 분석 ---------- */
// return { kind:'use'|'etc'|'quick'|'unknown', inventory, meso, known:[{icon,count,box}], quick, warn }
// 아이콘 key가 'e:'로 시작하면 기타 아이템, 그 밖은 소비 아이템
// withWarn=false면 가려진 곳 검사는 건너뛰고, 나중에 addWarnings(result, tpl)로 할 수 있다
export function analyze(img, tpl, withWarn = true) {
  const T = {}, now = () => performance.now(); let t = now();
  const lap = k => { const n = now(); T[k] = Math.round(n - t); t = n; };
  const buckets = colorBuckets(img, tpl.colors); lap('buckets');
  const { runs, mask } = findDigits(img, tpl.digits, buckets); lap('digits');
  const grid = findGrid(img); let unsure = 0;
  // 주황색 틀이 둘린 칸: 틀 자리는 비교에서 빼고, 틀 때문에 놓친 개수 숫자를 다시 찾는다
  if (grid && grid.some(c => c.framed)) {
    const ring = new Uint8Array(img.w * img.h), widest = rs => Math.max(0, ...rs.map(r => r.w)); unsure = 0;
    for (const c of grid) if (c.framed) {
      maskFrame(img, ring, c);
      // 틀을 빼고 읽은 숫자가 더 길 때만(= 앞자리가 틀에 덮였던 것) 바꾼다
      const old = runs.filter(r => r.x >= c.x - 2 && r.x <= c.x + 26 && r.y >= c.y + 10 && r.y <= c.y + 24);
      const again = framedDigits(img, ring, mask, c, tpl.digits);
      if (widest(again.runs) > widest(old)) { for (const r of old) runs.splice(runs.indexOf(r), 1); runs.push(...again.runs); if (again.unsure) unsure++; }
    }
    for (let p = 0; p < ring.length; p++) if (ring[p]) mask[p] = 1;
  }
  lap('grid');
  const isInventory = !!(grid && grid.length >= 4);
  let gb = null;
  if (isInventory) gb = {
    x0: Math.min(...grid.map(c => c.x)), y0: Math.min(...grid.map(c => c.y)),
    x1: Math.max(...grid.map(c => c.x + CELL)), y1: Math.max(...grid.map(c => c.y + CELL))
  };
  const coin = findCoin(img, tpl.coin, buckets, gb); lap('coin');
  const icons = findIcons(img, mask, tpl.icons, !isInventory, buckets); lap('icons');
  const meso = coin ? readMeso(img, coin) : null;

  const usedRuns = new Set(), dys = {}, cellRuns = new Map();
  const runFor = (box, cell) => {
    let best = null, bd = 1e9;
    runs.forEach((r, i) => {
      if (usedRuns.has(i)) return;
      let okPos;
      if (cell) okPos = r.x >= cell.x - 2 && r.x <= cell.x + 10 && r.y >= cell.y + 10 && r.y <= cell.y + 24;
      else okPos = r.x >= box.x - 8 && r.x <= box.x + 8 && r.y >= box.y + 6 && r.y <= box.y + box.h;
      if (!okPos) return;
      const dist = Math.abs(r.x - box.x) + Math.abs(r.y + r.h - (box.y + box.h));
      if (dist < bd) { bd = dist; best = i; }
    });
    if (best == null) return null;
    usedRuns.add(best);
    if (cell) { const dy = runs[best].y - cell.y; dys[dy] = (dys[dy] || 0) + 1; cellRuns.set(cell, runs[best]); }
    return runs[best].value;
  };
  const cellOf = b => grid && grid.find(c => b.x + b.w / 2 >= c.x && b.x + b.w / 2 < c.x + CELL && b.y + b.h / 2 >= c.y && b.y + b.h / 2 < c.y + CELL);

  // 인벤토리 사진이면 칸 안에 있는 아이콘만 인벤토리 아이템으로 센다
  const inCells = isInventory ? icons.filter(f => cellOf(f)) : icons;
  const known = inCells.map(f => {
    const cell = cellOf(f);
    const n = runFor(f, cell);
    return { icon: f.icon, count: n == null ? 1 : n, box: cell || f };
  });

  // 화면 전체 캡처처럼 인벤토리 밖에 퀵슬롯이 함께 찍힌 경우: 퀵슬롯 아이콘은 따로 모은다
  let quick = [];
  if (isInventory) {
    const gx0 = gb.x0 - 4, gy0 = gb.y0 - 4, gx1 = gb.x1 + 4, gy1 = gb.y1 + 60; // 아래 메소 칸까지
    const inside = b => b.x + b.w / 2 >= gx0 && b.x + b.w / 2 <= gx1 && b.y + b.h / 2 >= gy0 && b.y + b.h / 2 <= gy1;
    if ((gx1 - gx0) * (gy1 - gy0) < img.w * img.h * 0.6) {
      const useIcons = tpl.icons.filter(t => !String(t.key).startsWith('e:'));
      quick = findIcons(img, mask, useIcons, true, buckets)
        .filter(f => !inside(f))
        .map(f => { const n = runFor(f, null); return { icon: f.icon, count: n == null ? 1 : n, box: f }; });
    }
  }

  const nEtc = known.filter(k => String(k.icon).startsWith('e:')).length;
  const nUse = known.length - nEtc;
  let kind;
  // 인벤토리 창은 들어 있는 아이템으로 소비/기타를 정한다. 아는 아이템이 하나도 없을 때만 위쪽의 선택된 탭(붉은색)을 본다
  // → 텅 빈 소비·기타 창도 구분하고, 장비 탭처럼 다른 탭이 찍힌 사진은 '모름'(tab에 어느 탭인지 남긴다)
  const tab = isInventory ? activeTab(img, gb) : null;
  const byTab = tab === 'use' || tab === 'etc' ? tab : null;
  if (isInventory) kind = nEtc > nUse ? 'etc' : nUse > nEtc ? 'use' : nUse ? (byTab || 'use') : (byTab || 'unknown');
  else kind = nUse ? 'quick' : 'unknown';
  lap('quick');

  const dyKeys = Object.keys(dys);
  const digitDy = dyKeys.length ? +dyKeys.sort((a, b) => dys[b] - dys[a])[0] : null;
  const result = { kind, tab, inventory: isInventory, meso, known, quick, coin, grid: isInventory ? grid : null, warn: {}, w: img.w, h: img.h, timings: T };
  // 가려진 곳 검사에 필요한 것들 (화면 쪽으로는 보내지 않는다)
  Object.defineProperty(result, 'ctx', { value: { img, mask, grid: isInventory ? grid : null, known, coin, meso, kind, digitDy, cellRuns, unsure }, enumerable: false });
  if (withWarn) addWarnings(result, tpl);
  return result;
}
function addWarnings(result, tpl) {
  const t0 = performance.now();
  result.warn = findWarnings(result.ctx, tpl);
  result.timings.warn = Math.round(performance.now() - t0);
  return result;
}

/* ---------- 필요한 부분만 잘라 두기 ---------- */
// 인벤토리 창(제목·탭·메소 칸 포함)과 퀵슬롯이 들어가는 사각형
function regionOf(r, W, H) {
  const boxes = [];
  if (r.grid) {
    const x0 = Math.min(...r.grid.map(c => c.x)), y0 = Math.min(...r.grid.map(c => c.y));
    const x1 = Math.max(...r.grid.map(c => c.x + CELL)), y1 = Math.max(...r.grid.map(c => c.y + CELL));
    boxes.push({ x0: x0 - 12, y0: y0 - 52, x1: x1 + 32, y1: y1 + 50 });
  } else {
    for (const k of r.known) boxes.push({ x0: k.box.x - 14, y0: k.box.y - 16, x1: k.box.x + k.box.w + 14, y1: k.box.y + k.box.h + 14 });
  }
  if (r.coin) boxes.push({ x0: r.coin.x - 6, y0: r.coin.y - 8, x1: r.coin.x + 200, y1: r.coin.y + 22 });
  for (const k of r.quick || []) boxes.push({ x0: k.box.x - 14, y0: k.box.y - 16, x1: k.box.x + k.box.w + 14, y1: k.box.y + k.box.h + 14 });
  if (!boxes.length) return null;
  const x = Math.max(0, Math.min(...boxes.map(b => b.x0))), y = Math.max(0, Math.min(...boxes.map(b => b.y0)));
  const x1 = Math.min(W, Math.max(...boxes.map(b => b.x1))), y1 = Math.min(H, Math.max(...boxes.map(b => b.y1)));
  const parts = boxes.map(b => ({ x: Math.max(0, b.x0), y: Math.max(0, b.y0), x1: Math.min(W, b.x1), y1: Math.min(H, b.y1) }));
  return { x, y, w: x1 - x, h: y1 - y, parts };
}
const summary = r => JSON.stringify([r.kind, r.meso, r.known.map(k => k.icon + ':' + k.count).sort(), (r.quick || []).map(k => k.icon + ':' + k.count).sort()]);

// 사진 한 장을 분석하고, 화면 전체 캡처라면 필요한 부분만 잘라낸 PNG도 돌려준다.
// 잘라낸 사진을 다시 분석해서 결과가 똑같을 때만 잘라낸 것을 쓴다.
// 가려진 곳 검사는 마지막에 쓰는 사진 한 장에만 한다.
export async function processBlob(blob, tpl) {
  const bmp = await createImageBitmap(blob);
  const px = bitmapPixels(bmp);
  const result = analyze(px, tpl, false);
  let crop = null, out = null;
  const reg = regionOf(result, px.w, px.h);
  if (reg && reg.w > 0 && reg.h > 0 && reg.w * reg.h < px.w * px.h * 0.7) {
    const c = makeCanvas(reg.w, reg.h), ctx = c.getContext('2d', { willReadFrequently: true });
    // 인벤토리·퀵슬롯 부분만 옮기고 그 사이 배경은 단색으로 → PNG가 훨씬 작아진다
    ctx.fillStyle = '#20252c'; ctx.fillRect(0, 0, reg.w, reg.h);
    for (const p of reg.parts) ctx.drawImage(bmp, p.x, p.y, p.x1 - p.x, p.y1 - p.y, p.x - reg.x, p.y - reg.y, p.x1 - p.x, p.y1 - p.y);
    const r2 = analyze({ w: reg.w, h: reg.h, d: ctx.getImageData(0, 0, reg.w, reg.h).data }, tpl, true);
    if (summary(r2) === summary(result)) {
      out = r2;
      crop = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise(res => c.toBlob(res, 'image/png'));
    }
  }
  if (!out) out = addWarnings(result, tpl);
  bmp.close && bmp.close();
  // 화면 쪽으로 보낼 결과에서 큰 데이터는 뺀다
  const { grid, ...rest } = out;
  return { result: rest, crop, original: { w: px.w, h: px.h } };
}
