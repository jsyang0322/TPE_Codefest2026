// 語音指令判斷（規格第二部分第 7.3 節）。
// 每個畫面只開放部分指令（allowed）；不是指令的話，頁面會把它當成新的問題去查。

// 依陣列順序判斷：
// - 「再說一次」「下一段」裡都有「一」，所以要在「第幾個」之前判斷
// - 「取消授權」裡有「取消」、「不確定」裡有「確定」，所以 revoke 在 cancel 之前、cancel 在 confirm 之前
const RULES = [
  ['repeat', ['再說一次', '再講一次', '再唸一次', '再念一次', '重唸', '重念', '沒聽清楚', '聽不清楚']],
  ['revoke', ['停止授權', '終止授權', '取消授權', '不要讓他操作', '不要讓她操作', '不要再幫我']],
  ['takeover', ['我自己來', '我自己操作', '我自己做']],
  ['cancel', ['取消', '不確定', '不要', '算了', '不用了']],
  ['confirm', ['確定', '沒錯', '是的']],
  ['invite', ['讓家人幫我', '家人幫我', '請家人幫忙', '幫我操作']],
  ['none', ['都不是', '都不對', '換個說法', '重新問', '再問一次', '問別的']],
  ['back', ['回到問題', '回上一頁', '上一頁', '返回', '回首頁']],
  ['next', ['下一段', '繼續唸', '繼續念', '接著唸', '接著念']],
  ['call', ['撥打1999', '打1999', '撥1999', '打一九九九', '撥打一九九九', '打電話', '撥電話', '找真人', '真人客服']],
  ['all', ['全部問題', '所有問題', '看全部']],
];

const INDEX = { '一': 0, '1': 0, '二': 1, '兩': 1, '2': 1, '三': 2, '3': 2 };
// 「第一個」「第2題」「我要第三個」；「第一次登入」不算（後面接的不是個、題、項、號）
const ORDINAL = /第([一二兩三123])(?:個|題|項|號|$)/;
// 只說「一」「一個」「2」這種很短的回答
const SHORT = /^([一二兩三123])(?:個|題|項|號)?$/;

const clean = (text) => String(text ?? '').replace(/[\s，。！？、,.!?]/g, '');

/**
 * @param {string} text 語音辨識的結果
 * @param {string[]} allowed 這個畫面開放的指令：
 *   常見問題 repeat、none、back、next、call、all、select；
 *   照顧者代操作 revoke（停止授權）、takeover（我自己來）、confirm（確定）、cancel（取消）、invite（讓家人幫我）
 * @returns {{type: string, index?: number} | null} 不是指令就回傳 null
 */
export function parseCommand(text, allowed) {
  const t = clean(text);
  if (!t) return null;

  for (const [type, words] of RULES) {
    if (allowed.includes(type) && words.some((word) => t.includes(word))) return { type };
  }

  if (allowed.includes('select')) {
    const match = t.match(ORDINAL) ?? t.match(SHORT);
    if (match) return { type: 'select', index: INDEX[match[1]] };
  }
  return null;
}
