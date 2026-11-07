// 是非題按鈕的文字。按下按鈕等於說出這段文字，所以必須能被 agent/keywords.ts 的 matchYesNo
// 判斷成 yes／no，而且不能含「取消」「不要了」這類會被當成停止指令的字。choices.test.ts 會檢查。

/** 一般是非題，例如「要現在幫您繳費嗎？」 */
export const YES_NO_LABELS: [string, string] = ['要', '不要'];

/** 複誦確認，例如「用悠遊付繳 ABC-123 的停車費，共 60 元，確定嗎？」。「確定」本身判斷不出來，所以寫「對，確定」 */
export const CONFIRM_LABELS: [string, string] = ['對，確定', '不對'];
