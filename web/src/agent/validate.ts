// 檢查 LLM 任務 A 的輸出。小模型常在 JSON 外面加說明或 ```json 包裹，
// 也可能編出腳本沒有的欄位；這裡只留下確定能用的部分。

import type { TaskScript } from '../bridge/types.ts';
import { normalizeSlot } from './normalize.ts';

export interface TaskOutput {
  /** 腳本 id，或 'question'、'other' */
  task: string;
  /** 只含腳本定義、且通過正規化的欄位 */
  slots: Record<string, string>;
  /** task 為 'question' 時的問題（可能是空字串） */
  question: string;
}

/** 取出文字裡第一個 { 到最後一個 } 之間的 JSON；解析失敗回傳 null */
function extractJson(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 驗證任務 A 的輸出。整份不能用時回傳 null（呼叫端改用關鍵字）；
 * 個別欄位格式不符就丟掉，視為使用者沒說，之後由補齊關鍵字流程再問。
 */
export function parseTaskOutput(raw: string, scripts: Record<string, TaskScript>): TaskOutput | null {
  const json = extractJson(raw);
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const { task, slots, question } = json as Record<string, unknown>;

  if (typeof task !== 'string') return null;
  if (task === 'question' || task === 'other') {
    return { task, slots: {}, question: typeof question === 'string' ? question.trim() : '' };
  }

  const script = scripts[task];
  if (!script) return null;

  const valid: Record<string, string> = {};
  if (slots && typeof slots === 'object' && !Array.isArray(slots)) {
    for (const [key, value] of Object.entries(slots)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const normalized = normalizeSlot(script, key, String(value));
      if (normalized) valid[key] = normalized;
    }
  }
  return { task, slots: valid, question: '' };
}
