// 做完一個腳本後要不要接著做下一個，例如查完停車費接著繳費。
// 付款、送出這類動作一定要先問、再複誦確認，所以拆成兩段腳本，中間由畫面（store）問使用者。
// 純函式，可以直接用 node --test 測。

import type { TaskScript } from '../bridge/types.ts';
import { resultVars } from './describe.ts';

export interface FollowUp {
  script: TaskScript;
  /** 先問要不要做 */
  ask: string;
  /** 從上一個腳本帶過來的關鍵字（只帶下一個腳本有定義的） */
  slots: Record<string, string>;
  /** 補齊關鍵字後，執行前要複誦的句子 */
  confirm: (slots: Record<string, string>) => string;
}

/** 「共 {total} 元」→「共 510 元」；沒有的值保留原樣 */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

/** 依腳本的 next 設定和執行結果，決定要不要接著做；不用的話回傳 null */
export function planFollowUp(
  script: TaskScript,
  result: Record<string, unknown>,
  slots: Record<string, string>,
  followUpScripts: Record<string, TaskScript>,
): FollowUp | null {
  const next = script.next;
  if (!next) return null;
  const target = followUpScripts[next.script];
  if (!target) return null;
  const items = result[next.when];
  if (!Array.isArray(items) || items.length === 0) return null;
  // 停車費：示範站查無此車牌時也會回別台車的帳單，比對車號後沒有剩下的就不問（見 describe.ts）
  const vars = resultVars(script.id, result, slots);
  if (vars.count === '0') return null;

  const carried: Record<string, string> = {};
  for (const key of Object.keys(target.slots)) {
    if (slots[key]) carried[key] = slots[key];
  }
  return {
    script: target,
    ask: next.ask,
    slots: carried,
    confirm: (filled) => fillTemplate(next.confirm, { ...vars, ...filled }),
  };
}
