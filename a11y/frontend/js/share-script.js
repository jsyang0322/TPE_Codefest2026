// 開始／停止分享畫面（被照顧者的頁面使用）。
//
// 在台北通裡：把這次分享的 token 交給 App（TownPass 需要套用 a11y/townpass/ 的修改），
//   App 之後把整個台北通的畫面送給照顧者，也幫照顧者在同一個位置點按、打字。
// 在電腦瀏覽器裡：沒有 App，把設定存在 sessionStorage，示範用的模擬服務頁（demo/service.html）
//   自己載入分享程式（rrweb），把那一頁分享給照顧者。

import { inApp, startShareInApp, stopShareInApp } from './bridge.js';

const STORAGE_KEY = 'a11y.share';

/**
 * 開始分享。share 是後端 POST /api/share/start 的回覆。
 * 回傳 'app'（台北通已開始分享整個畫面）、'browser'（電腦測試）或 'unsupported'（這個版本的台北通還沒有這個功能）。
 */
export async function startSharing(share, { goHome = false } = {}) {
  if (!inApp) {
    const config = {
      server: location.origin,
      token: share.token,
      caregiverName: share.caregiver_name,
      elderName: share.elder_name,
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // 無痕模式等情況無法儲存，模擬服務頁就不會分享
    }
    return 'browser';
  }
  const ok = await startShareInApp({
    token: share.token,
    caregiver_name: share.caregiver_name,
    elder_name: share.elder_name,
    // 長輩剛按「同意」時為 true：App 關掉這一頁回到台北通首頁，家人一看到就是台北通本來的畫面
    go_home: goHome,
  });
  return ok ? 'app' : 'unsupported';
}

export function stopSharing() {
  stopShareInApp();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 略過
  }
}
