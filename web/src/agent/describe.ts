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

/** 比對車號用：只留英數字。示範站畫面上的「ABC–123」可能是全形或 en dash，直接比對會失敗 */
const plateKey = (text: string | undefined) => (text ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * 只留下車號相符的帳單。示範站是假資料站，不管查什麼車號都回同一套帳單，
 * 所以要在這裡比對：問到沒有的車牌時，誠實回「查無此車牌」。
 */
function matchBills(bills: Bill[], plate?: string): Bill[] {
  if (!plate) return bills;
  return bills.filter((bill) => plateKey(bill['車號']) === plateKey(plate));
}

function describeBills(bills: Bill[], plate?: string): string {
  const matched = matchBills(bills, plate);
  if (bills.length > 0 && matched.length === 0) {
    return `查無車號 ${plate} 的未繳停車費，請確認車牌號碼後再試一次。`;
  }
  bills = matched;
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

/** 示範站的搜尋頁沒有功能，腳本改讀首頁書單，再用關鍵字在這裡過濾 */
function matchBooks(books: string[], keyword?: string): string[] {
  return keyword ? books.filter((title) => title.includes(keyword)) : books;
}

function describeBooks(books: string[], keyword?: string): string {
  const hits = matchBooks(books, keyword);
  if (hits.length === 0) {
    return keyword
      ? `館藏查無「${keyword}」這本書，可以換個書名或作者再試一次。`
      : '館藏查無相關的書，可以換個書名或作者再試一次。';
  }
  const names = hits.slice(0, 3).map((title) => `《${shortTitle(title)}》`).join('、');
  return `館藏裡找到 ${hits.length} 本，有${names}${hits.length > 3 ? '等' : ''}。`;
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
export function resultVars(scriptId: string, result: Record<string, unknown>, slots?: Record<string, string>): Record<string, string> {
  if (scriptId === 'parking_fee' && Array.isArray(result.bills)) {
    const bills = matchBills(result.bills as Bill[], slots?.plate);
    return { count: String(bills.length), total: String(billsTotal(bills)) };
  }
  return {};
}

/**
 * 查無結果：車號不符、館藏沒有這本書。
 * 這時服務頁上是示範站的範例資料（別台車的帳單、首頁書單），會誤導使用者，畫面要先關掉服務頁再念結果。
 */
export function foundNothing(scriptId: string, result: Record<string, unknown>, slots: Record<string, string> = {}): boolean {
  if (scriptId === 'parking_fee' && Array.isArray(result.bills)) {
    return matchBills(result.bills as Bill[], slots.plate).length === 0;
  }
  if (scriptId === 'library_search' && Array.isArray(result.books)) {
    return matchBooks(result.books as string[], slots.keyword).length === 0;
  }
  return false;
}

/** 依腳本 id 把結果轉成一句話；沒有專用規則的腳本，把文字結果串起來 */
export function describeResult(
  scriptId: string,
  result: Record<string, unknown>,
  slots: Record<string, string> = {},
): string {
  if (scriptId === 'parking_fee' && Array.isArray(result.bills)) {
    return describeBills(result.bills as Bill[], slots.plate);
  }
  if (scriptId === 'parking_fee_pay' && result.receipt && typeof result.receipt === 'object') {
    return describeReceipt(result.receipt as Bill);
  }
  if (scriptId === 'library_search' && Array.isArray(result.books)) {
    return describeBooks(result.books.map(String), slots.keyword);
  }
  if (scriptId === 'counter_calling' && Array.isArray(result.counters)) {
    return describeCounters(result.counters.map(String));
  }
  return Object.values(result)
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .join('\n');
}
