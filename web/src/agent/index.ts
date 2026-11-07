// 對話邏輯（4 號負責）。
// 這裡是先讓畫面能跑起來的最小版本：任務 A、規定問答、關鍵字備案、車號正規化都很陽春，
// 4 號依 docs/系統設計文件.md 第四節替換。畫面（stores/assistant.ts）只依賴這個檔案 export 的介面。

import { bridge } from '../bridge';
import type { TaskScript } from '../bridge/types';
import parkingFee from './scripts/parking_fee.json';

export const scripts: Record<string, TaskScript> = {
  parking_fee: parkingFee as TaskScript,
};

export type Intent =
  | { kind: 'task'; script: TaskScript; slots: Record<string, string> }
  | { kind: 'question'; question: string }
  | { kind: 'unknown' };

/** 任務 A 的 system prompt：任務清單由腳本自動產生 */
function taskPrompt(): string {
  const lines = Object.values(scripts).map((s) => {
    const slots = Object.keys(s.slots).join('、');
    return `- ${s.id}：${s.description}。資料：${slots}`;
  });
  return [
    '你是臺北市政府城市通的語音助手。從下列任務中選出最符合使用者需求的一個，並抽出需要的資料。只輸出 JSON，不要輸出其他文字。',
    '任務：',
    ...lines,
    '- question：詢問規定或其他問題',
    '- other：以上都不是',
    '格式：{"task": "...", "slots": {...}, "question": "task 為 question 時，填使用者的問題"}',
    '使用者沒提到的資料不要填。',
  ].join('\n');
}

/** LLM 不可用或輸出驗證失敗時，用關鍵字猜任務 */
function keywordIntent(text: string): Intent {
  if (text.includes('停車')) return { kind: 'task', script: scripts.parking_fee, slots: {} };
  return { kind: 'unknown' };
}

/** 理解使用者說的一句話 */
export async function understand(text: string): Promise<Intent> {
  try {
    const raw = await bridge.ask(taskPrompt(), `使用者說：「${text}」`);
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (json.task === 'question') return { kind: 'question', question: json.question || text };
    const script = scripts[json.task];
    if (!script) return keywordIntent(text);
    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(json.slots ?? {})) {
      const normalized = normalizeSlot(script, key, String(value));
      if (normalized) slots[key] = normalized;
    }
    return { kind: 'task', script, slots };
  } catch {
    return keywordIntent(text);
  }
}

/** 補齊關鍵字時，把使用者的簡短回答轉成腳本要的值；不合格回傳 null */
export function normalizeSlot(script: TaskScript, key: string, value: string): string | null {
  const spec = script.slots[key];
  if (!spec) return null;
  if (spec.options) return spec.options.find((option) => value.includes(option)) ?? null;
  if (key === 'plate') {
    // TODO（4 號）：中文數字轉阿拉伯數字
    const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const plate = compact.replace(/^([A-Z]+)(\d+)$/, '$1-$2').replace(/^(\d+)([A-Z]+)$/, '$1-$2');
    return spec.pattern && !new RegExp(spec.pattern).test(plate) ? null : plate;
  }
  return value.trim() || null;
}

/** 規定問答（任務 B） */
export async function answer(question: string, onPartial?: (text: string) => void): Promise<string> {
  // TODO（4、5 號）：放入 web/src/data/faq/ 的資料
  const system = [
    '你是臺北市政府城市通的語音助手，對象是長輩。只根據下面的資料回答，使用繁體中文（臺灣用語），兩句話以內，口語化，不要條列。',
    '資料裡沒有的內容，回答「這個我不確定，可以幫您撥 1999 詢問」。',
    '資料：',
    '（尚未放入）',
  ].join('\n');
  return bridge.ask(system, question, onPartial);
}
