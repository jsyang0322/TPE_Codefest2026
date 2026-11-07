// 瀏覽器開發用的 mock：偵測不到 window.flutterObject 時使用。
// 行為對應 docs/系統設計文件.md 第三節「瀏覽器開發模式」。

import { ref } from 'vue';
import type { BridgeReply, RequestOptions, TaskScript, TaskStep } from './types';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- voice_listen：用畫面上的文字輸入框代替麥克風 ----

/** 畫面用這個判斷要不要顯示「用打字代替說話」的輸入框 */
export const mockMicWaiting = ref(false);
let micResolve: ((text: string) => void) | null = null;

/** 文字輸入框送出時呼叫 */
export function submitMockSpeech(text: string) {
  micResolve?.(text);
}

async function mockListen(options: RequestOptions): Promise<BridgeReply> {
  mockMicWaiting.value = true;
  const text = await new Promise<string>((resolve) => (micResolve = resolve));
  micResolve = null;
  mockMicWaiting.value = false;
  if (!text.trim()) return Promise.reject({ status: 'error', code: 'no_speech' });

  // 模擬說話中的即時字幕
  for (let i = 1; i < text.length; i += 2) {
    options.onPartial?.({ status: 'partial', text: text.slice(0, i) });
    await wait(60);
  }
  return { status: 'done', text };
}

// ---- tts_speak：有瀏覽器語音就念出來，沒有就依字數等一下 ----

async function mockSpeak(text: string, rate = 0.9): Promise<BridgeReply> {
  const synth = window.speechSynthesis;
  if (synth) {
    await new Promise<void>((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-TW';
      utter.rate = rate;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      synth.speak(utter);
    });
  } else {
    await wait(Math.min(text.length * 150, 6000));
  }
  return { status: 'done' };
}

// ---- llm_ask：依關鍵字回傳預設答案 ----

function mockLlmAnswer(system: string, prompt: string): string {
  // 任務 A：挑選腳本、抽出關鍵字
  if (system.includes('"task"')) {
    const plate = prompt.toUpperCase().match(/[A-Z0-9]{2,4}[\s-]?[A-Z0-9]{2,4}/)?.[0];
    if (prompt.includes('停車')) {
      const slots: Record<string, string> = {};
      if (plate) slots.plate = plate;
      if (prompt.includes('汽車')) slots.vehicle = '汽車';
      if (prompt.includes('機車')) slots.vehicle = '機車';
      return JSON.stringify({ task: 'parking_fee', slots });
    }
    if (prompt.includes('書') || prompt.includes('圖書館')) return JSON.stringify({ task: 'library_search', slots: {} });
    if (prompt.includes('叫號') || prompt.includes('排隊')) return JSON.stringify({ task: 'counter_calling', slots: {} });
    if (/[?？嗎]|怎麼|多少|哪裡/.test(prompt)) return JSON.stringify({ task: 'question', slots: {}, question: prompt });
    return JSON.stringify({ task: 'other', slots: {} });
  }
  // 任務 B：規定問答
  return '（瀏覽器模擬回答）這個我不確定，可以幫您撥 1999 詢問。';
}

async function mockAsk(data: Record<string, unknown>, options: RequestOptions): Promise<BridgeReply> {
  await wait(400);
  const answer = mockLlmAnswer(String(data.system ?? ''), String(data.prompt ?? ''));
  for (let i = 4; i < answer.length; i += 4) {
    options.onPartial?.({ status: 'partial', text: answer.slice(0, i) });
    await wait(30);
  }
  return { status: 'done', text: answer };
}

// ---- run_task：在畫面上逐步列出步驟，不真的操作 ----

let taskStopped = false;

function fillSlots(text: string, slots: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (_, key) => slots[key] ?? `{${key}}`);
}

function describeStep(step: TaskStep, slots: Record<string, string>): string {
  if (step.say) return fillSlots(step.say, slots);
  if (typeof step.stop === 'string') return fillSlots(step.stop, slots);
  if (step.open) return '開啟服務頁';
  if (step.click) return '點選畫面上的按鈕';
  if (step.fill) return '填寫欄位';
  if (step.read) return '讀取查詢結果';
  if (step.wait) return '等待頁面出現';
  return '下一步';
}

// 各腳本 read 步驟讀回的資料，結構與 runner.js 在示範服務站實際讀回的相同（2026/11/7 實測），
// 讓 agent/describe.ts 在瀏覽器裡也測得到。
const MOCK_RESULTS: Record<string, Record<string, unknown>> = {
  parking_fee: {
    bills: [
      { title: 'A1111111111', 繳費期限: '2024/12/31', 繳費金額: 'NT$60', 車號: 'ABC-123', 停車日期: '2024/11/14' },
      { title: 'A2222222222', 繳費期限: '2025/01/14', 繳費金額: 'NT$150', 車號: 'ABC-123', 停車日期: '2024/11/15' },
    ],
  },
  library_search: {
    books: ['歡迎光臨錢天堂 : 神奇柑仔店大圖鑑', '神奇柑仔店. 15, 冒牌的長髮公主餅乾'],
  },
  counter_calling: {
    counters: ['綜合受理|0379號 等候0', '自然人憑證|2023號 等候0', '護照一站式|3004號 等候2'],
  },
  parking_fee_pay: {
    receipt: { 繳費項目: '停車費', 繳費日期: '2026/11/07', 付款方式: '{method}', 帳單總金額: 'NT$210' },
  },
};

/** 假資料裡的 {method} 這類寫法換成這次的關鍵字 */
function mockResult(scriptId: string, slots: Record<string, string>): Record<string, unknown> {
  return JSON.parse(fillSlots(JSON.stringify(MOCK_RESULTS[scriptId] ?? {}), slots));
}

async function mockRunTask(data: Record<string, unknown>, options: RequestOptions): Promise<BridgeReply> {
  const script = data.script as TaskScript;
  const slots = (data.slots ?? {}) as Record<string, string>;
  taskStopped = false;

  for (const [index, step] of script.steps.entries()) {
    if (taskStopped) return Promise.reject({ status: 'error', code: 'stopped', step: index });
    options.onPartial?.({ status: 'partial', step: index, say: describeStep(step, slots) });
    await wait(900);
  }
  return { status: 'done', result: mockResult(script.id, slots) };
}

// ---- 進入點 ----

export function mockRequest(name: string, data: Record<string, unknown>, options: RequestOptions): Promise<BridgeReply> {
  switch (name) {
    case 'voice_listen':
      return mockListen(options);
    case 'tts_speak':
      return mockSpeak(String(data.text ?? ''), data.rate as number | undefined);
    case 'llm_status':
      return Promise.resolve({ status: 'done', state: 'ready' });
    case 'llm_ask':
      return mockAsk(data, options);
    case 'run_task':
      return mockRunTask(data, options);
    default:
      // App 沒有對應 Handler 時不會回覆，這裡模擬成逾時
      return Promise.reject({ status: 'error', code: 'timeout' });
  }
}

export function mockSend(name: string, data: unknown) {
  const action = (data as { action?: string } | null)?.action;
  if (name === 'tts_speak' && action === 'stop') window.speechSynthesis?.cancel();
  if (name === 'voice_listen' && action === 'stop') micResolve?.('');
  if (name === 'run_task' && action === 'stop') taskStopped = true;
  if (name === 'open_link') window.open(String(data), '_blank');
}

/** 與 TownPass assets/mock_data/account.json 的 data 欄位同格式 */
const mockAccount = {
  id: '7f3562f4-bb3f-4ec7-89b9-da3b4b5ff250',
  account: 'wz7786',
  username: 'Wesley',
  realName: '金大森',
  idNo: 'A123456789',
  email: 'ist83903@bcaoo.com',
  phoneNo: '0932166777',
  birthday: '1988/12/12',
  memberType: 'personal',
  verifyLevel: '3',
  residentAddress: '臺北市中山區吉林路 69 號 4 樓',
  citizen: true,
  nativePeople: false,
};

export async function mockBuiltin(name: string, _data: unknown): Promise<unknown> {
  if (name === 'userinfo') return mockAccount;
  if (name === 'location') return { latitude: 25.0478, longitude: 121.5319, accuracy: 10 };
  return false;
}
