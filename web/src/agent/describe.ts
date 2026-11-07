// 把 run_task 讀回來的結果轉成一句話，給畫面顯示和語音朗讀用。
// 純函式、不 import 其他模組，可以直接用 node --test 測。

/** 停車費帳單：runner.js `read` 加 `pairs` 讀出的一筆 */
type Bill = Record<string, string>;

/** "NT$1,150" → 1150；讀不出數字回傳 0 */
function toAmount(text: string | undefined): number {
  const digits = (text ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

/** "2024/12/31"、"2024/9/1"（月、日可為一位數）→ [年, 月, 日]；格式不符回傳 null */
function parseDate(text: string): [number, number, number] | null {
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

const billsTotal = (bills: Bill[]) => bills.reduce((sum, bill) => sum + toAmount(bill['繳費金額']), 0);

function describeBills(bills: Bill[]): string {
  if (bills.length === 0) return '沒有查到未繳的停車費。';
  const total = billsTotal(bills);
  // 解析成數字再比較：字串排序會把 2024/12/31 排在 2024/9/1 前面
  const deadlines = bills
    .map((bill) => parseDate(bill['繳費期限'] ?? ''))
    .filter((date) => date !== null)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const sentence = `查到 ${bills.length} 筆，共 ${total} 元`;
  if (!deadlines.length) return `${sentence}。`;
  const [year, month, day] = deadlines[0];
  return `${sentence}，最早的期限是 ${year} 年 ${month} 月 ${day} 日。`;
}

/** 書名去掉副題，唸起來比較短：「歡迎光臨錢天堂 : 神奇柑仔店大圖鑑」→「歡迎光臨錢天堂」 */
function shortTitle(title: string): string {
  return title.split(/\s[:=]\s/)[0].trim();
}

function describeBooks(books: string[]): string {
  if (books.length === 0) return '沒有找到相關的書，可以換個書名或作者再試一次。';
  const names = books.slice(0, 3).map((title) => `《${shortTitle(title)}》`).join('、');
  // 讀到的是頁面上列出的筆數，不一定是全部館藏，所以說「先列出」
  return `先列出 ${books.length} 本，有${names}${books.length > 3 ? '等' : ''}。`;
}

/** 櫃檯一列：「綜合受理|0379號 等候0」 */
function describeCounters(counters: string[]): string {
  const parts = counters.flatMap((row) => {
    const match = row.match(/^(.+?)\s*\|\s*0*(\d+)號\s*等候\s*(\d+)/);
    return match ? [`${match[1]}叫到 ${match[2]} 號，等候 ${match[3]} 人`] : [];
  });
  return parts.length ? `${parts.join('；')}。` : '目前查不到櫃檯的等候狀況。';
}

/** 繳費完成頁：{ 付款方式: '悠遊付', 帳單總金額: 'NT$510', ... } */
function describeReceipt(receipt: Bill): string {
  const method = receipt['付款方式'];
  return `繳費完成，${method ? `用${method}` : ''}繳了 ${toAmount(receipt['帳單總金額'])} 元。`;
}

/** 結果的摘要值，給接續腳本的確認句使用（例如「共 {total} 元」） */
export function resultVars(scriptId: string, result: Record<string, unknown>): Record<string, string> {
  if (scriptId === 'parking_fee' && Array.isArray(result.bills)) {
    const bills = result.bills as Bill[];
    return { count: String(bills.length), total: String(billsTotal(bills)) };
  }
  return {};
}

/** 依腳本 id 把結果轉成一句話；沒有專用規則的腳本，把文字結果串起來 */
export function describeResult(scriptId: string, result: Record<string, unknown>): string {
  if (scriptId === 'parking_fee' && Array.isArray(result.bills)) {
    return describeBills(result.bills as Bill[]);
  }
  if (scriptId === 'parking_fee_pay' && result.receipt && typeof result.receipt === 'object') {
    return describeReceipt(result.receipt as Bill);
  }
  if (scriptId === 'library_search' && Array.isArray(result.books)) {
    return describeBooks(result.books.map(String));
  }
  if (scriptId === 'counter_calling' && Array.isArray(result.counters)) {
    return describeCounters(result.counters.map(String));
  }
  return Object.values(result)
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .join('\n');
}
