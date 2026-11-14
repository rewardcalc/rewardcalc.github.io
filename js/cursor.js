/*
 * 게임 속 마우스 커서 (UI.wz Basic.img/Cursor 원본 프레임, 원본 지연시간)
 *  normal : 기본 손가락 (Cursor/0)
 *  hover  : 누를 수 있는 곳 위 — 톡톡 두드리는 손가락 (Cursor/4)
 *  press  : 누르는 중 (Cursor/12)
 *  grab   : 파일을 끌고 들어올 때 — 잡는 손 (Cursor/5)
 * 브라우저 기본 커서는 움직이는 그림을 못 쓰기 때문에, 커서를 숨기고 그림을 마우스 위치에 직접 그린다.
 * 터치 화면이나 글자 입력 칸 위에서는 원래 커서를 쓴다.
 */
const F = (src, ox, oy, delay = 0) => ({ src: `assets/cursor/${src}.png`, ox, oy, delay });
// 기준점: 원본 origin은 장면마다 달라서 손 전체가 위아래로 흔들려 보인다.
// 손가락 끝(모든 장면에서 그림의 (3,0))을 마우스 위치에 고정해 손가락 모양만 바뀌게 한다.
const STATES = {
  normal: [F('normal', 3, 0)],
  hover: [F('hover0', 3, 0, 120), F('hover1', 3, 0, 150), F('hover2', 3, 0, 150), F('hover3', 3, 0, 120)],
  press: [F('press', 3, 0)],
  grab: [F('grab0', 6, 7, 250), F('grab1', 6, 3, 100), F('grab2', 5, 2, 200), F('grab1', 6, 3, 100)]
};
const CLICKABLE = 'button, a[href], label, summary, select, [role="button"], .drop, input[type="checkbox"], input[type="file"]';
const TEXT = 'input:not([type="checkbox"]):not([type="file"]):not([type="button"]), textarea';

export function initCursor() {
  if (!matchMedia('(pointer: fine)').matches) return;
  // 미리 불러 두기
  Object.values(STATES).flat().forEach(f => { const i = new Image(); i.src = f.src; });

  const el = document.createElement('img');
  el.id = 'game-cursor'; el.alt = ''; el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  document.documentElement.classList.add('game-cursor');

  let state = '', frame = 0, timer = null, x = -100, y = -100, down = false, dragging = 0, raf = 0;
  let pressedAt = 0, releaseTimer = null, lastTarget = null;
  const MIN_PRESS = 140; // 짧게 클릭해도 누른 손이 잠깐은 보이도록 (ms)
  const place = () => {
    raf = 0;
    const f = STATES[state][frame];
    el.style.transform = `translate(${x - f.ox}px, ${y - f.oy}px)`;
  };
  const show = () => {
    const f = STATES[state][frame];
    if (el.getAttribute('src') !== f.src) el.src = f.src;
    place();
  };
  const setState = s => {
    if (s === state) return;
    state = s; frame = 0; clearTimeout(timer); show();
    const tick = () => {
      const list = STATES[state];
      if (list.length < 2) return;
      timer = setTimeout(() => { frame = (frame + 1) % list.length; show(); tick(); }, list[frame].delay);
    };
    tick();
  };
  const update = target => {
    lastTarget = target;
    if (dragging) return setState('grab');
    const overText = target && target.closest && target.closest(TEXT);
    el.hidden = !!overText;
    if (overText) return;
    // 게임처럼 어디를 누르든 누른 손
    if (down || releaseTimer) return setState('press');
    const overClick = target && target.closest && target.closest(CLICKABLE) && !target.closest(':disabled');
    setState(overClick ? 'hover' : 'normal');
  };
  const move = e => { x = e.clientX; y = e.clientY; if (!raf) raf = requestAnimationFrame(place); };
  const release = target => {
    down = false;
    const wait = MIN_PRESS - (performance.now() - pressedAt);
    clearTimeout(releaseTimer);
    if (wait > 0) releaseTimer = setTimeout(() => { releaseTimer = null; update(lastTarget); }, wait);
    else { releaseTimer = null; update(target); }
  };

  // 위치는 매번 옮기고, 모양(손가락/누름 등)은 가리키는 요소가 바뀔 때만 다시 고른다
  addEventListener('pointermove', e => { move(e); if (e.target !== lastTarget) update(e.target); }, { passive: true });
  addEventListener('pointerdown', e => { if (e.button !== 0) return; down = true; pressedAt = performance.now(); move(e); update(e.target); });
  addEventListener('pointerup', e => { if (e.button !== 0) return; release(e.target); });
  // 파일 선택 창이 열리는 등 손을 뗀 신호를 못 받는 경우
  addEventListener('blur', () => { if (down) release(lastTarget); });
  addEventListener('pointercancel', () => release(lastTarget));
  document.addEventListener('pointerleave', () => { el.hidden = true; });
  // 다시 들어올 때 글자 입력 칸 위라면 게임 커서를 숨긴 채로 둔다
  document.addEventListener('pointerenter', e => { el.hidden = false; move(e); update(document.elementFromPoint(e.clientX, e.clientY)); });
  // 바탕화면에서 파일을 끌고 들어올 때 잡는 손
  addEventListener('dragenter', e => { dragging++; move(e); update(); });
  addEventListener('dragover', e => { move(e); });
  addEventListener('dragleave', () => { dragging = Math.max(0, dragging - 1); if (!dragging) update(document.elementFromPoint(x, y)); });
  addEventListener('drop', e => { dragging = 0; move(e); update(e.target); });
  setState('normal');
}
