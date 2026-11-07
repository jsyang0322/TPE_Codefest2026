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

// 比對順序：含否定字的肯定說法 → 否定 → 肯定。
// 「不錯」「沒問題」含「不」「沒」但意思是肯定；「不是」包含「是」、「不要」包含「要」。
const YES_WITH_NEGATIVE = ['不錯', '沒問題', '沒錯'];
const NO = ['不是', '不要', '不對', '錯了', '不'];
const YES = ['對', '是', '好', '可以', '要'];

/** 是非題的回答；判斷不出來回傳 null，由呼叫端再問 LLM 或再問一次 */
export function matchYesNo(text: string): 'yes' | 'no' | null {
  if (YES_WITH_NEGATIVE.some((word) => text.includes(word))) return 'yes';
  if (NO.some((word) => text.includes(word))) return 'no';
  if (YES.some((word) => text.includes(word))) return 'yes';
  return null;
}

/**
 * 腳本 id → 關鍵字，依陣列順序判斷，越具體的越前面。
 * 不用單字「書」：「區公所辦證明書要排多久」會被當成查書。
 */
const SCRIPT_KEYWORDS: [string, string[]][] = [
  ['parking_fee', ['停車']],
  [
    'counter_calling',
    ['叫號', '排隊', '號碼牌', '輪到', '等候', '等多久', '幾個人', '幾號',
      '地政', '戶政', '戶籍', '區公所', '公所', '稅捐', '就業服務站'],
  ],
  ['library_search', ['圖書館', '借書', '想借', '要借', '借閱', '找書', '查書', '的書', '這本書', '書名', '作者', '館藏']],
];

/** 用關鍵字挑腳本；只回傳 scriptIds 裡有的（還沒寫好的腳本不會被挑到） */
export function matchScript(text: string, scriptIds: string[]): string | null {
  for (const [id, words] of SCRIPT_KEYWORDS) {
    if (scriptIds.includes(id) && words.some((word) => text.includes(word))) return id;
  }
  return null;
}

const QUESTION = /[?？]|嗎|呢|怎麼|怎樣|如何|多少|幾點|哪裡|哪裏|什麼|為什麼|可不可以|能不能|要不要|是不是/;

/** 像不像問句；LLM 不可用時，用來決定交給規定問答還是回「聽不懂」 */
export function looksLikeQuestion(text: string): boolean {
  return QUESTION.test(text);
}
