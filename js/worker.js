/*
 * 사진 분석을 화면과 따로(백그라운드) 돌려서, 큰 캡처를 넣어도 화면이 멈추지 않게 한다.
 * 메시지: { type:'warm', icons, base }  → 아이콘 미리 받기
 *         { id, blob, icons, base }    → 분석 결과 { id, result, crop }
 */
import { loadTemplates, processBlob } from './recognize.js';

let tplPromise = null;
const templates = (icons, base) => (tplPromise ||= loadTemplates(icons, base));

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'warm') { templates(m.icons, m.base).catch(() => { tplPromise = null; }); return; }
  try {
    const tpl = await templates(m.icons, m.base);
    const out = await processBlob(m.blob, tpl);
    self.postMessage({ id: m.id, ...out });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  }
};
