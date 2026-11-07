// 對話邏輯（4 號負責）的對外介面。畫面（stores/assistant.ts）只依賴這個檔案 export 的東西。
// 各部分的規則在：
//   normalize.ts  車號正規化、選項比對
//   keywords.ts   停止／再說一次、是非題、關鍵字挑腳本（LLM 不可用時的備案）
//   validate.ts   檢查 LLM 任務 A 的輸出
//   prompts.ts    任務 A、B 的 prompt
//   describe.ts   把腳本結果轉成一句話
//   followup.ts   做完後接著做的腳本（查完停車費接著繳費）

import { bridge } from '../bridge';
import type { TaskScript } from '../bridge/types';
import counterCalling from './scripts/counter_calling.json';
import librarySearch from './scripts/library_search.json';
import parkingFee from './scripts/parking_fee.json';
import parkingFeePay from './scripts/parking_fee_pay.json';
import { planFollowUp, type FollowUp } from './followup';
import { looksLikeQuestion, matchScript } from './keywords';
import { matchOption } from './normalize';
import { fallbackAnswer, faqPrompt, taskPrompt, taskUserPrompt, type FaqFile } from './prompts';
import { parseTaskOutput } from './validate';

export { describeResult } from './describe';
export { matchCommand, matchYesNo } from './keywords';
export { normalizeSlot } from './normalize';

export const scripts: Record<string, TaskScript> = {
  parking_fee: parkingFee as TaskScript,
  library_search: librarySearch as TaskScript,
  counter_calling: counterCalling as TaskScript,
};

/**
 * 只能從別的腳本接續執行的腳本（例如繳費一定要先查詢、再確認）。
 * 不放進 scripts，所以 LLM 和關鍵字不會直接挑到。
 */
const followUpScripts: Record<string, TaskScript> = {
  parking_fee_pay: parkingFeePay as TaskScript,
};

export type { FollowUp };

/** 腳本做完後，要不要接著問使用者做下一個；不用的話回傳 null */
export function nextTask(
  script: TaskScript,
  result: Record<string, unknown>,
  slots: Record<string, string>,
): FollowUp | null {
  return planFollowUp(script, result, slots, followUpScripts);
}

/** web/src/data/faq/ 底下所有 JSON，建置時打包 */
const faqs = Object.values(
  import.meta.glob<FaqFile>('../data/faq/*.json', { eager: true, import: 'default' }),
);

export type Intent =
  | { kind: 'task'; script: TaskScript; slots: Record<string, string> }
  | { kind: 'question'; question: string }
  | { kind: 'unknown' };

/** LLM 不可用或輸出不能用時，用關鍵字挑腳本；有說到的選項（汽車／機車）順便填上 */
function keywordIntent(text: string): Intent {
  const id = matchScript(text, Object.keys(scripts));
  // 像問句就交給任務 B：模型沒準備好時，answer() 會說明，而不是回「聽不懂」
  if (!id) return looksLikeQuestion(text) ? { kind: 'question', question: text } : { kind: 'unknown' };
  const script = scripts[id];
  const slots: Record<string, string> = {};
  for (const [key, spec] of Object.entries(script.slots)) {
    const option = spec.options && matchOption(spec.options, text);
    if (option) slots[key] = option;
  }
  return { kind: 'task', script, slots };
}

/** 理解使用者說的一句話（任務 A） */
export async function understand(text: string): Promise<Intent> {
  let raw: string | null = null;
  try {
    raw = await bridge.ask(taskPrompt(scripts), taskUserPrompt(text));
  } catch {
    // 模型還沒準備好或推論失敗，改用關鍵字
  }
  const output = raw ? parseTaskOutput(raw, scripts) : null;

  if (output?.task === 'question') return { kind: 'question', question: output.question || text };
  if (output && scripts[output.task]) return { kind: 'task', script: scripts[output.task], slots: output.slots };
  return keywordIntent(text);
}

/** 規定問答（任務 B）；模型不可用或沒有回答時，回傳固定的說明，不丟例外 */
export async function answer(question: string, onPartial?: (text: string) => void): Promise<string> {
  try {
    const text = (await bridge.ask(faqPrompt(faqs), question, onPartial)).trim();
    return text || fallbackAnswer();
  } catch (error) {
    return fallbackAnswer((error as { code?: string }).code);
  }
}
