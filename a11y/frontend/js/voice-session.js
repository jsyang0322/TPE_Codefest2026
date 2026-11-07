// 念與聽的共用流程（讓家人幫忙的頁面使用；常見問題頁的流程相同）。
//
// 使用者每做一件事就換一輪（turn）：停掉正在念的、正在聽的。
// 舊的那一輪念完或聽完後發現 turn 變了，就不再接著做事，避免兩個流程同時進行。

import { announce, isScreenReaderMode } from './a11y.js';
import * as bridge from './bridge.js';
import { speechText } from './speech-text.js';

/**
 * @param {object} options
 * @param {HTMLButtonElement} options.button 說話按鈕
 * @param {HTMLElement} options.label 按鈕上的主要文字
 * @param {HTMLElement} options.partial 按鈕上顯示「正在聽到的話」
 * @param {(text: string) => void} options.onText 聽到一句話
 * @param {(error: object, info: { auto: boolean }) => void} [options.onError]
 */
export function createVoice({ button, label, partial, idleText, listeningText, hintText, onText, onError }) {
  let turn = 0;
  let listening = false;
  let lastSpeech = '';

  function setListening(on) {
    listening = on;
    button.classList.toggle('listening', on);
    button.setAttribute('aria-pressed', String(on));
    label.textContent = on ? listeningText : idleText;
    partial.textContent = on ? hintText : '';
  }

  /** 停掉正在念的、正在聽的，開始新的一輪 */
  function interrupt() {
    turn += 1;
    bridge.stopSpeaking();
    if (listening) {
      bridge.stopListening();
      setListening(false);
    }
    return turn;
  }

  async function speak(text, urgent) {
    lastSpeech = text;
    await announce(text, { urgent, speech: speechText(text) });
  }

  async function listen(current = interrupt(), { auto = false } = {}) {
    setListening(true);
    let text = '';
    let error = null;
    try {
      text = await bridge.listen((heard) => {
        if (current === turn) partial.textContent = heard;
      });
    } catch (e) {
      error = e;
    }
    if (current !== turn) return;
    setListening(false);
    if (error) onError?.(error, { auto });
    else onText(text);
  }

  button.addEventListener('click', () => {
    if (listening) bridge.stopListening(); // 說完了：已經聽到的內容照常處理
    else listen();
  });

  return {
    /** 念出來（會打斷正在念的、正在聽的） */
    async say(text, { urgent = false } = {}) {
      interrupt();
      await speak(text, urgent);
    },
    /** 念完後自動聽一次；螢幕閱讀器模式不自動開麥克風 */
    async sayThenListen(text, { urgent = false } = {}) {
      const current = interrupt();
      await speak(text, urgent);
      if (current === turn && !isScreenReaderMode()) listen(current, { auto: true });
    },
    listen: () => listen(),
    interrupt,
    get lastSpeech() {
      return lastSpeech;
    },
  };
}

/** 電腦開發用：沒有台北通 App 時，用畫面上的輸入框代替說話（不使用雲端語音辨識） */
export function setupMockMic({ form, input, cancel }) {
  if (bridge.inApp) return;
  let resolveMic = null;
  const finish = (text) => {
    form.hidden = true;
    const resolve = resolveMic;
    resolveMic = null;
    resolve?.(text);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    finish(input.value);
  });
  cancel.addEventListener('click', () => finish(''));
  bridge.setMockListener({
    listen: () =>
      new Promise((resolve) => {
        resolveMic?.('');
        resolveMic = resolve;
        input.value = '';
        form.hidden = false;
        input.focus();
      }),
    stop: () => finish(input.value),
  });
}
