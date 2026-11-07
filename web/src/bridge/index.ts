// 網頁與城市通 App 的雙向溝通。
// 在 App 裡用 window.flutterObject；在一般瀏覽器裡自動改用 mock.ts，方便在電腦上開發。
// 規格見 docs/系統設計文件.md 第三節。

import type { BridgeReply, RequestOptions, TaskScript, UserInfo } from './types';
import { mockBuiltin, mockRequest, mockSend } from './mock';

interface FlutterObject {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

declare global {
  interface Window {
    flutterObject?: FlutterObject;
  }
}

/** 是否在城市通 App 裡執行 */
export const inApp = typeof window !== 'undefined' && !!window.flutterObject;

let seq = 0;

/**
 * 送出需要回覆的自訂訊息（voice_listen、tts_speak、llm_*、run_task）。
 * 會自動帶 id；partial 回覆交給 onPartial，done 時 resolve，error 或逾時 reject。
 */
export function request(name: string, data: Record<string, unknown>, options: RequestOptions = {}): Promise<BridgeReply> {
  const id = String(++seq);
  if (!inApp) return mockRequest(name, { ...data, id }, options);

  const { onPartial, timeoutMs = 30000 } = options;
  const flutter = window.flutterObject!;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      flutter.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      const msg = parse(event.data);
      if (!msg || msg.name !== name || msg.data?.id !== id) return;
      const reply = msg.data as BridgeReply;
      if (reply.status === 'partial') return onPartial?.(reply);
      cleanup();
      if (reply.status === 'done') resolve(reply);
      else reject(reply);
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
export function send(name: string, data: unknown): void {
  if (!inApp) return mockSend(name, data);
  window.flutterObject!.postMessage(JSON.stringify({ name, data }));
}

/** 內建訊息（userinfo、location、open_link…）：沒有 id，收到第一個同名回覆就結束 */
export function callBuiltin<T = unknown>(name: string, data: unknown = null, timeoutMs = 10000): Promise<T> {
  if (!inApp) return mockBuiltin(name, data) as Promise<T>;
  const flutter = window.flutterObject!;

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const msg = parse(event.data);
      if (!msg || msg.name !== name) return;
      cleanup();
      resolve(msg.data as T);
    };
    const cleanup = () => {
      clearTimeout(timer);
      flutter.removeEventListener('message', onMessage);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject({ status: 'error', code: 'timeout' });
    }, timeoutMs);
    flutter.addEventListener('message', onMessage);
    flutter.postMessage(JSON.stringify({ name, data }));
  });
}

function parse(raw: unknown): { name: string; data: any } | null {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
  } catch {
    return null;
  }
}

// ---- 給畫面和 agent 用的包裝 ----

export const bridge = {
  /** 開始聽；說話中的文字由 onPartial 拿到，結束時回傳整句 */
  listen(onPartial?: (text: string) => void) {
    send('tts_speak', { action: 'stop' });
    return request('voice_listen', { action: 'start', locale: 'zh-TW' }, {
      timeoutMs: 60000,
      onPartial: (r) => onPartial?.(String(r.text ?? '')),
    }).then((r) => String(r.text ?? ''));
  },
  stopListening: () => send('voice_listen', { action: 'stop' }),

  speak: (text: string, rate?: number) => request('tts_speak', { text, rate }, { timeoutMs: 60000 }),
  stopSpeaking: () => send('tts_speak', { action: 'stop' }),

  /**
   * App 立刻回覆目前狀態並在背景載入模型；要等到 ready 請用 stores 的輪詢。
   * 每送一次，App 就會在模型不可用時重新嘗試下載或載入（見 TownPass LlmService.warmUp）。
   * progress：下載百分比（只有 loading 時帶）；message：上次失敗的原因。
   */
  llmStatus: () =>
    request('llm_status', {}, { timeoutMs: 10000 }).then((r) => ({
      state: r.state as 'missing' | 'loading' | 'ready',
      progress: typeof r.progress === 'number' ? r.progress : null,
      message: typeof r.message === 'string' ? r.message : null,
    })),
  ask: (system: string, prompt: string, onPartial?: (text: string) => void, maxTokens = 150) =>
    request('llm_ask', { system, prompt, maxTokens }, {
      timeoutMs: 60000,
      onPartial: (r) => onPartial?.(String(r.text ?? '')),
    }).then((r) => String(r.text ?? '')),

  runTask: (script: TaskScript, slots: Record<string, string>, onStep?: (step: number, say: string) => void) =>
    request('run_task', { script, slots }, {
      timeoutMs: 180000,
      onPartial: (r) => onStep?.(Number(r.step), String(r.say ?? '')),
    }),
  stopTask: () => send('run_task', { action: 'stop' }),

  userinfo: () => callBuiltin<UserInfo>('userinfo'),
  openLink: (url: string) => send('open_link', url),
};
