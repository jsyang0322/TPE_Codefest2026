// 常見問題搜尋：同義詞轉換＋關鍵字計分（規格第二部分第 8.1 節）。
// 在手機上的網頁裡執行，不用連網路。只有純函式、不碰畫面，可以用 node --test 測試。

const PUNCT = /[\s，。！？、；：「」『』（）【】,.!?;:()"'~～…\-]/g;

const clean = (text) => String(text ?? '').replace(PUNCT, '').toLowerCase();

/** 同義詞展開成 [口語說法, 標準詞]，長的說法排前面，例如「密碼想不起來」要比「想不起來」先換 */
function synonymPairs(synonyms) {
  const pairs = [];
  for (const [standard, spokenList] of Object.entries(synonyms ?? {})) {
    for (const spoken of spokenList) pairs.push([clean(spoken), clean(standard)]);
  }
  return pairs.filter(([spoken]) => spoken).sort((a, b) => b[0].length - a[0].length);
}

/** 去掉標點與空白、英文轉小寫，再把口語說法換成標準詞。「我登不進去」→「我登入」 */
export function normalize(text, synonyms = {}) {
  let result = clean(text);
  for (const [spoken, standard] of synonymPairs(synonyms)) {
    result = result.split(spoken).join(standard);
  }
  return result;
}

/**
 * 找出最符合的常見問題，最多 limit 題。
 * 分數＝這題有幾個關鍵字出現在使用者的話裡；同分時，被點選較多次的排前面，再依官方順序。
 * 一個關鍵字都沒有就回傳空陣列，不硬給不相關的答案（規格第一部分第 3.4 節）。
 */
export function searchFaq(query, faqs, synonyms = {}, limit = 3) {
  const text = normalize(query, synonyms);
  if (!text) return [];

  const scored = [];
  faqs.forEach((faq, index) => {
    const score = (faq.keywords ?? []).filter((keyword) => {
      const word = normalize(keyword, synonyms);
      return word && text.includes(word);
    }).length;
    if (score > 0) scored.push({ faq, score, index });
  });

  scored.sort((a, b) => b.score - a.score || (b.faq.popularity ?? 0) - (a.faq.popularity ?? 0) || a.index - b.index);
  return scored.slice(0, limit).map((item) => item.faq);
}

/** 「大家常問」：被點選最多次的前幾題；次數相同依官方順序 */
export function popularFaqs(faqs, limit = 5) {
  return faqs
    .map((faq, index) => ({ faq, index }))
    .sort((a, b) => (b.faq.popularity ?? 0) - (a.faq.popularity ?? 0) || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.faq);
}
