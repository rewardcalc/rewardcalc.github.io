/*
 * 사진 분석을 화면과 따로(백그라운드) 돌려서, 큰 캡처를 넣어도 화면이 멈추지 않게 한다.
 * 메시지: { type:'warm', icons, base }  → 아이콘 미리 받기
 *         { id, blob, icons, base }    → 분석 결과 { id, result, crop }
 */
import { loadTemplates, processBlob } from './recognize.js';

let tplPromise = null;
// 아이콘을 못 받아 준비에 실패하면 기억하지 않고 다음 요청 때 다시 시도한다
// 아이템 아이콘 몇 개를 못 받았을 때도 이번 분석만 그대로 하고, 다음 요청 때 다시 받는다
const templates = (icons, base) => (tplPromise ||= loadTemplates(icons, base).then(t => { if (t.missing) tplPromise = null; return t; }, err => { tplPromise = null; throw err; }));

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'warm') { templates(m.icons, m.base).catch(() => {}); return; }
  try {
    const tpl = await templates(m.icons, m.base);
    const out = await processBlob(m.blob, tpl);
    self.postMessage({ id: m.id, ...out });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  }
};
