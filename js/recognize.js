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
export async function pixelsFromSource(src) {
  const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w, h, d: ctx.getImageData(0, 0, w, h).data };
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
    if (lum < 35 || lum > 235) continue;
    c.push({ k, x, y, s: Math.max(r, g, b) - Math.min(r, g, b) + (prefer(x, y) ? 100 : 0) });
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
  for (let p = 0; p < N; p++) {
    const arr = map.get(qkey(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]));
    if (arr) arr.push(p);
  }
  return map;
}

/* ---------- 템플릿 준비 ---------- */
// icons: [{ key, url }] — key는 인식 결과에 그대로 돌려준다
export async function loadTemplates(icons) {
  const load = async url => { try { return await pixelsFromSource(url); } catch (e) { return await pixelsFromSource(url + '?r=1'); } };
  // 작은 이미지 100여 개를 4개씩 나눠 불러온다
  const tIcons = [], digits = [];
  for (let i = 0; i < icons.length; i += 4) {
    const batch = await Promise.all(icons.slice(i, i + 4).map(async ic => makeTemplate(ic.key, await load(ic.url))));
    tIcons.push(...batch);
  }
  const icons_ = tIcons;
  for (const d of '0123456789') digits.push(makeTemplate(d, await load(`assets/digit/${d}.png`)));
  const coin = makeTemplate('coin', await load('assets/coin.png'));
  return { icons: icons_, digits, coin };
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
function findDigits(img, digits) {
  const { w, h, d } = img, hits = [];
  for (const t of digits) {
    for (let y = 0; y + t.h <= h; y++) for (let x = 0; x + t.w <= w; x++) {
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
function findIcons(img, mask, icons, whiten) {
  const { w, h, d } = img, found = [];
  const minScore = whiten ? 0.88 : 0.9;
  const srcOf = t => whiten ? t.quick : t;
  const buckets = colorBuckets(img, icons.flatMap(t => { const s = srcOf(t); return s.primary.map(k => s.pts.slice(k * 5 + 2, k * 5 + 5)); }));
  for (const t of icons) {
    const src = srcOf(t), P = src.pts;
    // 대표 픽셀이 맞는 자리만 후보로
    const cand = new Set();
    for (const a of src.primary) {
      const r = P[a * 5 + 2], g = P[a * 5 + 3], b = P[a * 5 + 4], R = r >> 3, G = g >> 3, B = b >> 3;
      for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
        const list = buckets.get(((R + dr) << 10) | ((G + dg) << 5) | (B + db));
        if (!list) continue;
        for (const p of list) {
          if (!same(d, p * 4, r, g, b)) continue;
          const ox = (p % w) - P[a * 5], oy = ((p / w) | 0) - P[a * 5 + 1];
          if (ox >= 0 && oy >= 0 && ox + t.w <= w && oy + t.h <= h) cand.add(oy * w + ox);
        }
      }
    }
    for (const o of cand) {
      const x = o % w, y = (o / w) | 0;
      let chk = 0, miss = 0;
      for (const k of src.anchors) {
        const p = (y + P[k * 5 + 1]) * w + x + P[k * 5];
        if (mask[p]) continue;
        chk++;
        const m = whiten ? sameOrWhitened(d, p * 4, P[k * 5 + 2], P[k * 5 + 3], P[k * 5 + 4])
                         : same(d, p * 4, P[k * 5 + 2], P[k * 5 + 3], P[k * 5 + 4]);
        if (!m && ++miss > 2) break;
      }
      if (miss > 2 || chk < 3) continue;
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
  const X = [...xs.keys()].sort((a, b) => a - b), Y = [...ys.keys()].sort((a, b) => a - b);
  const cells = [];
  for (const y of Y) for (const x of X) {
    if (x + CELL > w || y + CELL > h) continue;
    let bg = 0;
    for (let yy = y; yy < y + CELL; yy += 2) for (let xx = x; xx < x + CELL; xx += 2) if (is(xx, yy, CELL_BG)) bg++;
    if (bg >= 25) cells.push({ x, y, w: CELL, h: CELL });
  }
  return cells.length ? cells : null;
}

/* ---------- 메소 ---------- */
function findCoin(img, coin) {
  const { w, h } = img;
  for (let y = h - coin.h; y >= 0; y--) for (let x = 0; x + coin.w <= w; x++) {
    if (score(img, null, coin, x, y, 0.95, false) >= 0.95) return { x, y };
  }
  return null;
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
  const { runs, mask } = findDigits(img, tpl.digits);
  const coin = findCoin(img, tpl.coin);
  const grid = findGrid(img);
  const isInventory = !!(grid && grid.length >= 4);
  const icons = findIcons(img, mask, tpl.icons, !isInventory);
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
    return { icon: f.icon, count: n == null ? 1 : n, box: cell || f };
  });

  // 화면 전체 캡처처럼 인벤토리 밖에 퀵슬롯이 함께 찍힌 경우: 퀵슬롯 아이콘은 따로 모은다
  let quick = [];
  if (isInventory) {
    const gx0 = Math.min(...grid.map(c => c.x)) - 4, gy0 = Math.min(...grid.map(c => c.y)) - 4;
    const gx1 = Math.max(...grid.map(c => c.x + CELL)) + 4, gy1 = Math.max(...grid.map(c => c.y + CELL)) + 60; // 아래 메소 칸까지
    const inside = b => b.x + b.w / 2 >= gx0 && b.x + b.w / 2 <= gx1 && b.y + b.h / 2 >= gy0 && b.y + b.h / 2 <= gy1;
    if ((gx1 - gx0) * (gy1 - gy0) < img.w * img.h * 0.6) {
      const useIcons = tpl.icons.filter(t => !String(t.key).startsWith('e:'));
      quick = findIcons(img, mask, useIcons, true)
        .filter(f => !inside(f))
        .map(f => { const n = runFor(f, null); return { icon: f.icon, count: n == null ? 1 : n, box: f }; });
    }
  }

  const nEtc = known.filter(k => String(k.icon).startsWith('e:')).length;
  const nUse = known.length - nEtc;
  let kind;
  if (isInventory) kind = nEtc > nUse ? 'etc' : nUse ? 'use' : quick.length ? 'use' : 'unknown';
  else kind = nUse ? 'quick' : 'unknown';
  return { kind, inventory: isInventory, meso, known, quick, w: img.w, h: img.h };
}
