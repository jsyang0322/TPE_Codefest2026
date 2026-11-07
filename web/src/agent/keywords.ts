// 關鍵字規則：LLM 不可用時的備案，以及簡短回答的判斷。
// 規則見 docs/系統設計文件.md 第四節「判斷使用者說的話」。

/** 任何時候都要先判斷的指令 */
export type Command = 'stop' | 'repeat';

const COMMANDS: [Command, string[]][] = [
  // 「聽不清楚」「不要了」都含「不」，所以指令要比是非題先判斷
  ['repeat', ['再說一次', '再講一次', '聽不清楚', '沒聽清楚']],
  ['stop', ['停止', '不要了', '取消']],
];

/** 「停止」「再說一次」；都不是回傳 null。補齊關鍵字時要先呼叫這個，再當成答案處理 */
export function matchCommand(text: string): Command | null {
  for (const [command, words] of COMMANDS) {
    if (words.some((word) => text.includes(word))) return command;
  }
  return null;
}

// 「不是」包含「是」、「不要」包含「要」，所以先比對否定詞
const NO = ['不是', '不要', '不對', '錯了', '不'];
const YES = ['對', '是', '好', '沒錯', '可以', '要'];

/** 是非題的回答；判斷不出來回傳 null，由呼叫端再問 LLM 或再問一次 */
export function matchYesNo(text: string): 'yes' | 'no' | null {
  if (NO.some((word) => text.includes(word))) return 'no';
  if (YES.some((word) => text.includes(word))) return 'yes';
  return null;
}

/** 腳本 id → 關鍵字 */
const SCRIPT_KEYWORDS: Record<string, string[]> = {
  parking_fee: ['停車'],
  library_search: ['圖書館', '借書', '找書', '查書', '書'],
  counter_calling: ['叫號', '排隊', '號碼牌', '輪到', '等候', '等多久', '幾個人'],
};

/** 用關鍵字挑腳本；只回傳 scriptIds 裡有的（還沒寫好的腳本不會被挑到） */
export function matchScript(text: string, scriptIds: string[]): string | null {
  for (const [id, words] of Object.entries(SCRIPT_KEYWORDS)) {
    if (scriptIds.includes(id) && words.some((word) => text.includes(word))) return id;
  }
  return null;
}
