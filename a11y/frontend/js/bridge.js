// 與台北通 App 的雙向溝通。
// 訊息格式和組員的 TPE_Codefest2026/web/src/bridge/index.ts 相同（docs/系統設計文件.md 第三節）：
//   網頁送出 window.flutterObject.postMessage(JSON.stringify({ name, data }))，需要回覆的請求 data 帶 id；
//   App 回覆 { name, data: { id, status: 'partial' | 'done' | 'error', ... } }。
// 用的都是 TownPass 已經有的 Handler：voice_listen、tts_speak（AI 語音助手加的）、phone_call（內建），不需要改 App。
//
// 在一般瀏覽器（電腦開發）裡沒有 window.flutterObject：
// - 聽：改用頁面提供的文字輸入框（setMockListener）。不使用瀏覽器的語音辨識，因為它會把錄音送到雲端。
// - 念：改用瀏覽器內建的 speechSynthesis。

export const inApp = typeof window !== 'undefined' && !!window.flutterObject;

let seq = 0;

function parse(raw) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** 需要回覆的訊息。partial 交給 onPartial；done 時 resolve；error 或逾時 reject（App 沒有這個 Handler 時不會回覆）。 */
function request(name, data, { onPartial, timeoutMs = 30000 } = {}) {
  const id = `a11y-${++seq}`;
  const flutter = window.flutterObject;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      flutter.removeEventListener('message', onMessage);
    };
    const onMessage = (event) => {
      const msg = parse(event.data);
      if (!msg || msg.name !== name || msg.data?.id !== id) return;
      if (msg.data.status === 'partial') {
        onPartial?.(msg.data);
        return;
      }
      cleanup();
      if (msg.data.status === 'done') resolve(msg.data);
      else reject(msg.data);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject({ status: 'error', code: 'timeout' });
    }, timeoutMs);
    flutter.addEventListener('message', onMessage);
    flutter.postMessage(JSON.stringify({ name, data: { ...data, id } }));
  });
}

/** 不需要回覆的訊息，例如 { action: 'stop' } */
function send(name, data) {
  window.flutterObject.postMessage(JSON.stringify({ name, data }));
}

// ---- 語音辨識 ----

let mockListener = null;

/** 電腦開發用：頁面提供 { listen: () => Promise<string>, stop: () => void }，用打字代替說話 */
export function setMockListener(listener) {
  mockListener = listener;
}

/**
 * 開始聽，使用者停頓後回傳整句；說話中的文字交給 onPartial。
 * 失敗時 reject { code }：no_speech（沒聽到）、permission（沒有權限）、unavailable（手機不支援）。
 */
export async function listen(onPartial) {
  stopSpeaking(); // 避免把正在念的話辨識進去
  if (inApp) {
    const reply = await request('voice_listen', { action: 'start', locale: 'zh-TW' }, {
      timeoutMs: 60000,
      onPartial: (r) => onPartial?.(String(r.text ?? '')),
    });
    return String(reply.text ?? '');
  }
  if (!mockListener) throw { status: 'error', code: 'unavailable' };
  const text = await mockListener.listen();
  if (!text.trim()) throw { status: 'error', code: 'no_speech' };
  return text;
}

/** 提早結束聆聽；已經聽到的內容照常回傳 */
export function stopListening() {
  if (inApp) send('voice_listen', { action: 'stop' });
  else mockListener?.stop();
}

// ---- 語音朗讀 ----

/** 念完（或被 stopSpeaking 中斷）才 resolve。rate 0.5 是正常語速，不帶時用 App 的預設（稍慢，給長輩聽）。 */
export function speak(text, rate) {
  if (!text) return Promise.resolve();
  if (inApp) {
    return request('tts_speak', rate ? { text, rate } : { text }, { timeoutMs: 120000 }).then(() => {});
  }
  return browserSpeak(text);
}

export function stopSpeaking() {
  if (inApp) send('tts_speak', { action: 'stop' });
  else window.speechSynthesis?.cancel();
}

function browserSpeak(text) {
  const synth = window.speechSynthesis;
  // 有些瀏覽器念完不會觸發 onend，所以依字數設一個最長等待時間
  const maxWait = text.length * 400 + 3000;
  if (!synth) return new Promise((resolve) => setTimeout(resolve, Math.min(maxWait, 6000)));
  synth.cancel();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxWait);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 0.9;
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}

// ---- 分享畫面（TownPass 需要套用 a11y/townpass/ 的修改） ----

/** 收到第一個同名回覆就結束（App 的回覆沒有 id）。App 沒有這個 Handler 時，逾時回傳 null。 */
function oneShot(name, data, timeoutMs) {
  const flutter = window.flutterObject;
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(value) {
      clearTimeout(timer);
      flutter.removeEventListener('message', onMessage);
      resolve(value);
    }
    function onMessage(event) {
      const msg = parse(event.data);
      if (msg?.name === name) finish(msg.data);
    }
    flutter.addEventListener('message', onMessage);
    flutter.postMessage(JSON.stringify({ name, data }));
  });
}

/** 請 App 把分享程式放進之後打開的每個服務網頁。成功回傳 true；App 還沒加這個功能時回傳 false。 */
export async function startShareInApp(script) {
  if (!inApp) return false;
  return (await oneShot('a11y_share_start', { script }, 3000)) === true;
}

export function stopShareInApp() {
  if (inApp) send('a11y_share_stop', null);
}

/** 在台北通裡打開另一個服務網頁（TownPass 內建的 open_link，會開新的網頁畫面） */
export function openInApp(url) {
  if (inApp) send('open_link', url);
  else window.location.href = url;
}

// ---- 撥電話（TownPass 內建的 Handler） ----

export function callPhone(number) {
  if (inApp) send('phone_call', number);
  else window.location.href = `tel:${number}`;
}
