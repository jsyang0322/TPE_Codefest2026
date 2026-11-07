// 無障礙共用功能：通知（字幕＋朗讀）、螢幕閱讀器模式、震動、焦點（規格第二部分第 7.2 節）。

import { speak } from './bridge.js';

const SCREEN_READER_KEY = 'a11y.screenReader';

/**
 * 使用者是否開著 VoiceOver／TalkBack。網頁偵測不到，所以由使用者在頁面上勾選，記在這支手機上。
 * 開著的時候，App 不另外朗讀，由螢幕閱讀器念 live region，避免兩個聲音重疊。
 */
export function isScreenReaderMode() {
  try {
    return localStorage.getItem(SCREEN_READER_KEY) === '1';
  } catch {
    return false;
  }
}

export function setScreenReaderMode(on) {
  try {
    localStorage.setItem(SCREEN_READER_KEY, on ? '1' : '0');
  } catch {
    // 無痕模式等情況存不了，只在這次開啟期間有效
  }
}

/**
 * 通知使用者：一律寫進 live region（螢幕閱讀器會念）；不是螢幕閱讀器模式時再用 App 朗讀。念完才 resolve。
 * @param {string} text 畫面與螢幕閱讀器用的文字
 * @param {{ urgent?: boolean, speech?: string }} options speech：朗讀用的文字（例如電話號碼拆開念）
 */
export async function announce(text, { urgent = false, speech } = {}) {
  const region = document.getElementById(urgent ? 'announce-assertive' : 'announce-polite');
  if (region) {
    // 先清空再寫入，同一句話連續出現時螢幕閱讀器才會再念一次
    region.textContent = '';
    setTimeout(() => {
      region.textContent = text;
    }, 50);
  }
  if (!isScreenReaderMode()) {
    await speak(speech ?? text).catch(() => {});
  }
}

// 震動節奏：一般步驟短震一次；同意請求長、短、長；完成短震兩次。iOS 的網頁不支援震動，屬正常。
const VIBRATION = { step: [80], consent: [400, 150, 120, 150, 400], done: [80, 120, 80] };

export function vibrate(kind) {
  try {
    navigator.vibrate?.(VIBRATION[kind] ?? [80]);
  } catch {
    // 不支援就算了
  }
}

/** 把焦點移到元素上（螢幕閱讀器會從這裡開始念） */
export function focusOn(element) {
  if (!element) return;
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  element.focus();
}

// ---- 對話框（同意請求、終止確認）：role="alertdialog" ----

const returnFocus = new Map();

/** 打開對話框：記住原本的焦點，背景設成不能操作（inert），焦點移到標題 */
export function openDialog(dialog, { background = [] } = {}) {
  if (dialog.hidden) returnFocus.set(dialog, document.activeElement);
  dialog.hidden = false;
  for (const element of background) element.inert = true;
  focusOn(dialog.querySelector('h2') ?? dialog);
}

/** 關閉對話框：背景恢復，焦點還給原本的位置 */
export function closeDialog(dialog, { background = [] } = {}) {
  if (dialog.hidden) return;
  dialog.hidden = true;
  for (const element of background) element.inert = false;
  const previous = returnFocus.get(dialog);
  returnFocus.delete(dialog);
  if (previous && document.contains(previous) && !previous.closest('[hidden]')) previous.focus();
}
