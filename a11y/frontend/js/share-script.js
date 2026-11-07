// 開始／停止分享畫面（被照顧者的頁面使用）。
//
// 在台北通裡：把「rrweb 錄製程式＋分享程式＋設定」組成一段程式交給 App，
//   App 會放進之後打開的每個服務網頁（TownPass 需要套用 a11y/townpass/ 的修改）。
// 在電腦瀏覽器裡：沒有 App，把設定存在 sessionStorage，示範用的模擬服務頁（demo/service.html）自己載入分享程式。

import { inApp, startShareInApp, stopShareInApp } from './bridge.js';

const STORAGE_KEY = 'a11y.share';
let sources = null;

async function text(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.text();
}

/** 組成要放進服務網頁的程式。rrweb 包在函式裡，避免碰到網頁自己的 define／module（AMD、CommonJS）。 */
export async function buildScript(config) {
  sources ??= await Promise.all([text('vendor/rrweb/record.min.js'), text('js/share-agent.js')]);
  const [recordLib, agent] = sources;
  return [
    `window.__A11Y_SHARE__=${JSON.stringify(config)};`,
    `(function(){var define,module,exports;\n${recordLib}\n;window.__a11yRrwebRecord=rrwebRecord;}).call(window);`,
    agent,
  ].join('\n');
}

/**
 * 開始分享。share 是後端 POST /api/share/start 的回覆。
 * 回傳 'app'（App 已準備好）、'browser'（電腦測試）或 'unsupported'（App 還沒加這個功能）。
 */
export async function startSharing(share) {
  const config = {
    server: location.origin,
    token: share.token,
    caregiverName: share.caregiver_name,
    elderName: share.elder_name,
  };
  if (!inApp) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // 無痕模式等情況無法儲存，模擬服務頁就不會分享
    }
    return 'browser';
  }
  return (await startShareInApp(await buildScript(config))) ? 'app' : 'unsupported';
}

export function stopSharing() {
  stopShareInApp();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 略過
  }
}
