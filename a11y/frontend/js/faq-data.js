// 下載常見問題，並在這支手機上留一份。
// 網頁打開時（有網路）從後端一次下載全部；之後查詢都在手機上做，切成飛航模式也查得到。
// 下載失敗時改用上次留下的那份。

const CACHE_KEY = 'a11y.faq.v1';

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // 空間不足或無痕模式：這次開啟期間資料還在記憶體裡，不影響使用
  }
}

/** @returns {Promise<{ data: object, offline: boolean }>} offline：用的是上次留下的資料 */
export async function loadFaqData() {
  try {
    const res = await fetch('/api/faq', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.faqs?.length) {
      writeCache(data);
      return { data, offline: false };
    }
    // 後端還沒同步到資料：有舊的就先用舊的
    const cached = readCache();
    return cached ? { data: cached, offline: true } : { data, offline: false };
  } catch (error) {
    const cached = readCache();
    if (cached) return { data: cached, offline: true };
    throw error;
  }
}

// ---- 查詢紀錄：送不出去（沒有網路）就先排隊，有網路時再送 ----

const pending = [];
let flushing = false;

export function sendFeedback(entry) {
  pending.push(entry);
  flush();
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (pending.length) {
      const res = await fetch('/api/faq/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending[0]),
      });
      // 422：資料格式不對，重送也沒用，丟掉
      if (!res.ok && res.status !== 422) break;
      pending.shift();
    }
  } catch {
    // 沒有網路，等 online 事件
  } finally {
    flushing = false;
  }
}

window.addEventListener('online', flush);
