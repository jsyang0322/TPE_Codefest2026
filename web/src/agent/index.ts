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
import { routeByKeywords } from './keywords';
import { slotsFromText } from './normalize';
import { fallbackAnswer, faqPrompt, pickFaqs, taskPrompt, taskUserPrompt, type FaqFile } from './prompts';
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

/** web/src/data/faq/ 底下所有 JSON，建置時打包；key 是檔名（parking_fee、library…），挑相關資料用 */
const faqs = Object.fromEntries(
  Object.entries(import.meta.glob<FaqFile>('../data/faq/*.json', { eager: true, import: 'default' })).map(
    ([path, faq]) => [path.replace(/^.*\/|\.json$/g, ''), faq],
  ),
);

export type Intent =
  | { kind: 'task'; script: TaskScript; slots: Record<string, string> }
  | { kind: 'question'; question: string }
  | { kind: 'unknown' };

/** 用關鍵字判斷；判斷不了回傳 null */
function keywordIntent(text: string): Intent | null {
  const route = routeByKeywords(text, Object.keys(scripts));
  if (!route) return null;
  if (route.kind === 'question') return { kind: 'question', question: text };
  const script = scripts[route.id];
  return { kind: 'task', script, slots: slotsFromText(script, text) };
}

/** 任務 A 只輸出一行 JSON，不用 150 */
const TASK_MAX_TOKENS = 80;
/** 任務 A 最多等多久；超過就當成聽不懂，請使用者再說一次（第二次會顯示任務大按鈕） */
const TASK_TIMEOUT_MS = 15000;

/**
 * 理解使用者說的一句話。
 * 先用關鍵字：常見的說法馬上就有結果，不用等手機上的 LLM；關鍵字判斷不了的才問 LLM（任務 A）。
 */
export async function understand(text: string): Promise<Intent> {
  const quick = keywordIntent(text);
  if (quick) return quick;

  let raw: string | null = null;
  try {
    raw = await bridge.ask(taskPrompt(scripts), taskUserPrompt(text), undefined, TASK_MAX_TOKENS, TASK_TIMEOUT_MS);
  } catch {
    // 模型還沒準備好、推論失敗或太久
  }
  const output = raw ? parseTaskOutput(raw, scripts) : null;

  if (output?.task === 'question') return { kind: 'question', question: output.question || text };
  if (output && scripts[output.task]) return { kind: 'task', script: scripts[output.task], slots: output.slots };
  return { kind: 'unknown' };
}

/** 規定問答（任務 B）；模型不可用或沒有回答時，回傳固定的說明，不丟例外 */
export async function answer(question: string, onPartial?: (text: string) => void): Promise<string> {
  try {
    const text = (await bridge.ask(faqPrompt(pickFaqs(faqs, question)), question, onPartial)).trim();
    return text || fallbackAnswer();
  } catch (error) {
    return fallbackAnswer((error as { code?: string }).code);
  }
}
