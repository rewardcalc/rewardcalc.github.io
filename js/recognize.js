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
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
export function bitmapPixels(bmp) {
  const w = bmp.width, h = bmp.height, c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w, h, d: ctx.getImageData(0, 0, w, h).data };
}
export async function pixelsFromSource(src) {
  const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
  return bitmapPixels(await createImageBitmap(blob));
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
  return { key, w: px.w, h: px.h, pts, n, anchors, primary, quick };
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
  for (const t of tpl.icons) { add(t); add(t.quick); }
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
  // 작은 이미지 100여 개를 16개씩 동시에 불러온다
  const tIcons = [], digits = [];
  for (let i = 0; i < icons.length; i += 16) {
    const batch = await Promise.all(icons.slice(i, i + 16).map(async ic => makeTemplate(ic.key, await load(ic.url))));
    tIcons.push(...batch);
  }
  const icons_ = tIcons;
  for (const d of '0123456789') digits.push(makeTemplate(d, await load(abs(`assets/digit/${d}.png`))));
  const coin = makeTemplate('coin', await load(abs('assets/coin.png')));
  const cursors = [];
  for (const c of ['normal', 'hover0', 'hover1', 'hover2', 'hover3', 'press', 'grab0', 'grab1', 'grab2']) cursors.push(makeTemplate(c, await load(abs(`assets/cursor/${c}.png`))));
  const tpl = { icons: icons_, digits, coin, cursors };
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
  const mask = new Uint8Array(w * h);
  for (const g of kept) for (let k = 0; k < g.t.n; k++) mask[(g.y + g.t.pts[k * 5 + 1]) * w + g.x + g.t.pts[k * 5]] = 1;
  return { runs: runs.map(r => ({ x: r.x, y: r.y, w: r.x2 - r.x, h: r.h, value: parseInt(r.text, 10) })), mask };
}

/* ---------- 아이템 아이콘 ---------- */
// partial: 아이콘 일부만 보여도(가려짐) 찾기 — 경고용
function findIcons(img, mask, icons, whiten, buckets, partial = false) {
  const { w, d } = img, found = [];
  const minScore = partial ? 0.5 : whiten ? 0.88 : 0.9, maxMiss = partial ? 5 : 2;
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
function findGrid(img) {
  const { w, h, d } = img;
  const is = (x, y, c, tol = 4) => x >= 0 && y >= 0 && x < w && y < h && same(d, (y * w + x) * 4, c[0], c[1], c[2], tol);
  const xs = new Map(), ys = new Map();
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    if (is(x, y, CELL_BORDER) && is(x + 1, y, CELL_BORDER) && is(x, y + 1, CELL_BORDER) && is(x + 1, y + 1, CELL_BG)) {
      xs.set(x, (xs.get(x) || 0) + 1); ys.set(y, (ys.get(y) || 0) + 1);
    }
  }
  if (!xs.size) return null;
  // 칸 간격(가로 36 / 세로 34 정도)으로 사이에 빠진 줄을 채운다 → 무언가에 가려 모서리가 안 보이는 칸도 자리를 안다
  const fill = (vals, lo, hi) => {
    const v = [...vals].sort((a, b) => a - b), diffs = {};
    for (let i = 1; i < v.length; i++) { const dd = v[i] - v[i - 1]; if (dd >= lo && dd <= hi) diffs[dd] = (diffs[dd] || 0) + 1; }
    const step = +Object.keys(diffs).sort((a, b) => diffs[b] - diffs[a])[0];
    if (!step) return v;
    const out = [v[0]];
    for (let i = 1; i < v.length; i++) {
      const gap = v[i] - out[out.length - 1];
      if (gap > step * 1.5) for (let k = 1; out[out.length - 1] + step < v[i] - step / 2 && k < 20; k++) out.push(out[out.length - 1] + step);
      out.push(v[i]);
    }
    return out;
  };
  const X = fill(xs.keys(), 30, 45), Y = fill(ys.keys(), 28, 42);
  const cells = []; let covered = 0;
  for (const y of Y) for (const x of X) {
    if (x + CELL > w || y + CELL > h) continue;
    let bg = 0, border = 0;
    for (let yy = y; yy < y + CELL; yy += 2) for (let xx = x; xx < x + CELL; xx += 2) if (is(xx, yy, CELL_BG)) bg++;
    for (let k = 0; k < CELL; k++) { if (is(x, y + k, CELL_BORDER)) border++; if (is(x + k, y, CELL_BORDER)) border++; }
    if (bg >= 25) cells.push({ x, y, w: CELL, h: CELL });
    else if (border < 6) covered++; // 칸 바탕도 테두리도 안 보임 = 다른 창·커서 등에 가려짐
  }
  if (!cells.length) return null;
  cells.covered = covered;
  return cells;
}

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
// 칸 안 여러 위치에서 아는 아이콘과 일정 비율 이상 맞으면 = 그 아이템이 일부 가려진 것
const PARTIAL_MIN = 0.35;
function partialIconIn(img, mask, c, icons) {
  const { w, h, d } = img;
  for (const t of icons) {
    const step = Math.max(1, Math.floor(t.n / 60)); // 60점 정도만 골라 빠르게 비교
    const maxBad = Math.ceil(t.n / step * (1 - PARTIAL_MIN));
    for (let oy = c.y - 4; oy <= c.y + 8; oy++) for (let ox = c.x - 4; ox <= c.x + 8; ox++) {
      if (ox < 0 || oy < 0 || ox + t.w > w || oy + t.h > h) continue;
      let ok = 0, seen = 0, bad = 0;
      for (let k = 0; k < t.n; k += step) {
        const p = (oy + t.pts[k * 5 + 1]) * w + ox + t.pts[k * 5];
        if (mask[p]) continue;
        seen++;
        if (same(d, p * 4, t.pts[k * 5 + 2], t.pts[k * 5 + 3], t.pts[k * 5 + 4])) ok++; else if (++bad > maxBad) break;
      }
      if (bad <= maxBad && seen >= 25 && ok / seen >= PARTIAL_MIN) return true;
    }
  }
  return false;
}

// 게임 마우스 커서가 사각형(인벤토리) 안에 찍혀 있는지 (커서는 캡처에 그대로 찍힌다)
function cursorIn(img, cursors, r) {
  const { w, h } = img;
  for (const t of cursors) {
    for (let y = Math.max(0, r.y0 - t.h); y <= Math.min(h - t.h, r.y1); y++) for (let x = Math.max(0, r.x0 - t.w); x <= Math.min(w - t.w, r.x1); x++) {
      if (score(img, null, t, x, y, 0.85, false) >= 0.85) return true;
    }
  }
  return false;
}

// 칸 왼쪽 아래(개수 숫자 자리)에 숫자가 일부만 보이면 = 숫자가 가려진 것
function partialDigitIn(img, cell, digits) {
  const { w, h, d } = img;
  for (let y0 = cell.y + 14; y0 <= cell.y + 24; y0++) for (let x0 = cell.x - 1; x0 <= cell.x + 12; x0++) {
    for (const t of digits) {
      if (x0 < 0 || y0 < 0 || x0 + t.w > w || y0 + t.h > h) continue;
      let ok = 0, bad = 0; const maxBad = t.n * 0.35;
      for (let k = 0; k < t.n; k++) {
        const p = ((y0 + t.pts[k * 5 + 1]) * w + x0 + t.pts[k * 5]) * 4;
        if (same(d, p, t.pts[k * 5 + 2], t.pts[k * 5 + 3], t.pts[k * 5 + 4], 8)) ok++; else if (++bad > maxBad) break;
      }
      if (bad <= maxBad && ok < t.n) return true;
    }
  }
  return false;
}

/* ---------- 메소 ---------- */
function findCoin(img, coin, buckets) {
  const { w } = img;
  let best = null;
  for (const o of candidates(img, buckets, coin, coin)) {
    const x = o % w, y = (o / w) | 0;
    if (score(img, null, coin, x, y, 0.95, false) >= 0.95 && (!best || y > best.y)) best = { x, y }; // 여러 개면 가장 아래쪽
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
// return { kind:'use'|'etc'|'quick'|'unknown', inventory, meso, known:[{icon,count,box}] }
// 아이콘 key가 'e:'로 시작하면 기타 아이템, 그 밖은 소비 아이템
export function analyze(img, tpl) {
  const T = {}, now = () => performance.now(); let t = now();
  const lap = k => { const n = now(); T[k] = Math.round(n - t); t = n; };
  const buckets = colorBuckets(img, tpl.colors); lap('buckets');
  const { runs, mask } = findDigits(img, tpl.digits, buckets); lap('digits');
  const coin = findCoin(img, tpl.coin, buckets); lap('coin');
  const grid = findGrid(img); lap('grid');
  const isInventory = !!(grid && grid.length >= 4);
  const icons = findIcons(img, mask, tpl.icons, !isInventory, buckets); lap('icons');
  const meso = coin ? readMeso(img, coin) : null;

  const usedRuns = new Set();
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
    usedRuns.add(best); return runs[best].value;
  };
  const cellOf = b => grid && grid.find(c => b.x + b.w / 2 >= c.x && b.x + b.w / 2 < c.x + CELL && b.y + b.h / 2 >= c.y && b.y + b.h / 2 < c.y + CELL);

  // 인벤토리 사진이면 칸 안에 있는 아이콘만 인벤토리 아이템으로 센다
  const inCells = isInventory ? icons.filter(f => cellOf(f)) : icons;
  const known = inCells.map(f => {
    const cell = cellOf(f);
    const n = runFor(f, cell);
    return { icon: f.icon, count: n == null ? 1 : n, box: cell || f, noDigits: n == null };
  });

  // 화면 전체 캡처처럼 인벤토리 밖에 퀵슬롯이 함께 찍힌 경우: 퀵슬롯 아이콘은 따로 모은다
  let quick = [];
  if (isInventory) {
    const gx0 = Math.min(...grid.map(c => c.x)) - 4, gy0 = Math.min(...grid.map(c => c.y)) - 4;
    const gx1 = Math.max(...grid.map(c => c.x + CELL)) + 4, gy1 = Math.max(...grid.map(c => c.y + CELL)) + 60; // 아래 메소 칸까지
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
  if (isInventory) kind = nEtc > nUse ? 'etc' : nUse ? 'use' : quick.length ? 'use' : 'unknown';
  else kind = nUse ? 'quick' : 'unknown';
  lap('quick');

  // 가려진 곳 찾기 (다시 캡처해 달라고 알려 주기 위해)
  const warn = {};
  if (isInventory) {
    if (!coin) warn.meso = 'hidden';               // 동전·메소 칸이 안 보임
    else if (meso == null) warn.meso = 'unreadable'; // 메소 숫자가 가려져 못 읽음
    if (grid.covered) warn.covered = grid.covered;   // 칸 자체가 가려짐
    const hiddenCounts = known.filter(k => k.noDigits && partialDigitIn(img, k.box, tpl.digits)).length;
    if (hiddenCounts) warn.counts = hiddenCounts;   // 개수 숫자 일부가 가려짐
    // 아는 아이템인데 아이콘 일부가 가려져서 못 찾은 칸
    const taken = new Set(known.map(k => k.box));
    const suspects = grid.filter(c => !taken.has(c) && cellHasContent(img, mask, c));
    const hiddenItems = suspects.filter(c => partialIconIn(img, mask, c, tpl.icons)).length;
    if (hiddenItems) warn.items = hiddenItems;
    // 마우스 커서가 칸이나 메소 칸 위에 있으면 (숫자·아이콘을 가렸을 수 있음)
    const gx0 = Math.min(...grid.map(c => c.x)), gy0 = Math.min(...grid.map(c => c.y));
    const gx1 = Math.max(...grid.map(c => c.x + CELL)), gy1 = Math.max(...grid.map(c => c.y + CELL)) + 30;
    if (tpl.cursors && cursorIn(img, tpl.cursors, { x0: gx0, y0: gy0, x1: gx1, y1: gy1 })) warn.cursor = true;
  }
  known.forEach(k => delete k.noDigits);
  lap('warn');
  return { kind, inventory: isInventory, meso, known, quick, coin, grid: isInventory ? grid : null, warn, w: img.w, h: img.h, timings: T };
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
const summary = r => JSON.stringify([r.kind, r.meso, r.known.map(k => k.icon + ':' + k.count).sort(), (r.quick || []).map(k => k.icon + ':' + k.count).sort(), r.warn]);

// 사진 한 장을 분석하고, 화면 전체 캡처라면 필요한 부분만 잘라낸 PNG도 돌려준다.
// 잘라낸 사진을 다시 분석해서 결과가 똑같을 때만 잘라낸 것을 쓴다.
export async function processBlob(blob, tpl) {
  const bmp = await createImageBitmap(blob);
  const px = bitmapPixels(bmp);
  const result = analyze(px, tpl);
  let crop = null, out = result;
  const reg = regionOf(result, px.w, px.h);
  if (reg && reg.w > 0 && reg.h > 0 && reg.w * reg.h < px.w * px.h * 0.7) {
    const c = makeCanvas(reg.w, reg.h), ctx = c.getContext('2d', { willReadFrequently: true });
    // 인벤토리·퀵슬롯 부분만 옮기고 그 사이 배경은 단색으로 → PNG가 훨씬 작아진다
    ctx.fillStyle = '#20252c'; ctx.fillRect(0, 0, reg.w, reg.h);
    for (const p of reg.parts) ctx.drawImage(bmp, p.x, p.y, p.x1 - p.x, p.y1 - p.y, p.x - reg.x, p.y - reg.y, p.x1 - p.x, p.y1 - p.y);
    const r2 = analyze({ w: reg.w, h: reg.h, d: ctx.getImageData(0, 0, reg.w, reg.h).data }, tpl);
    if (summary(r2) === summary(result)) {
      out = r2;
      crop = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise(res => c.toBlob(res, 'image/png'));
    }
  }
  bmp.close && bmp.close();
  // 화면 쪽으로 보낼 결과에서 큰 데이터는 뺀다
  const { grid, ...rest } = out;
  return { result: rest, crop, original: { w: px.w, h: px.h } };
}
