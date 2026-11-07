// 把 run_task 讀回來的結果轉成一句話，給畫面顯示和語音朗讀用。
// 純函式、不 import 其他模組，可以直接用 node --test 測。

/** 停車費帳單：runner.js `read` 加 `pairs` 讀出的一筆 */
type Bill = Record<string, string>;

/** "NT$1,150" → 1150；讀不出數字回傳 0 */
function toAmount(text: string | undefined): number {
  const digits = (text ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

/** "2024/12/31" → "2024 年 12 月 31 日"；格式不符就原樣回傳 */
function toSpokenDate(text: string): string {
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return text;
  return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

function describeBills(bills: Bill[]): string {
  if (bills.length === 0) return '沒有查到未繳的停車費。';
  const total = bills.reduce((sum, bill) => sum + toAmount(bill['繳費金額']), 0);
  // 日期格式是 YYYY/MM/DD，字串排序就是時間排序
  const deadlines = bills.map((bill) => bill['繳費期限']).filter(Boolean).sort();
  const sentence = `查到 ${bills.length} 筆，共 ${total} 元`;
  return deadlines.length ? `${sentence}，最早的期限是 ${toSpokenDate(deadlines[0])}。` : `${sentence}。`;
}

/** 依腳本 id 把結果轉成一句話；沒有專用規則的腳本，把文字結果串起來 */
export function describeResult(scriptId: string, result: Record<string, unknown>): string {
  if (scriptId === 'parking_fee' && Array.isArray(result.bills)) {
    return describeBills(result.bills as Bill[]);
  }
  return Object.values(result)
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .join('\n');
}
