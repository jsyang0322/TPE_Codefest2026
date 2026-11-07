// 兩個 LLM 任務的 prompt。內容見 docs/系統設計文件.md 第四節「LLM 任務」。
// 純函式：腳本和 FAQ 由呼叫端傳入，新增腳本或 FAQ 檔不用改這裡。

import type { TaskScript } from '../bridge/types.ts';

/** web/src/data/faq/*.json 的格式 */
export interface FaqFile {
  source: string;
  url?: string;
  retrievedAt?: string;
  items: Record<string, unknown>[];
}

/** 範例對話，只放進清單裡有的腳本；示範車號格式與「沒說的資料不要填」 */
const EXAMPLES: Record<string, [string, object][]> = {
  parking_fee: [
    ['我要查 ABC 一二三這台機車的停車費', { task: 'parking_fee', slots: { vehicle: '機車', plate: 'ABC-123' } }],
    ['幫我查停車費', { task: 'parking_fee', slots: {} }],
  ],
  library_search: [['圖書館有沒有東野圭吾的書', { task: 'library_search', slots: { keyword: '東野圭吾' } }]],
  counter_calling: [['戶政事務所現在要等多久', { task: 'counter_calling', slots: { office: '戶政事務所' } }]],
};

function describeSlot(key: string, spec: TaskScript['slots'][string]): string {
  if (spec.options) return `${key}（${spec.options.join('或')}）`;
  return spec.label ? `${key}（${spec.label}）` : key;
}

/** 任務 A 的 system prompt：任務清單由腳本自動產生 */
export function taskPrompt(scripts: Record<string, TaskScript>): string {
  const tasks = Object.values(scripts).map((s) => {
    const slots = Object.entries(s.slots).map(([key, spec]) => describeSlot(key, spec));
    return `- ${s.id}：${s.description}。資料：${slots.join('、')}`;
  });
  const examples = Object.keys(scripts)
    .flatMap((id) => EXAMPLES[id] ?? [])
    .concat([['停車費可以去超商繳嗎', { task: 'question', slots: {}, question: '停車費可以去超商繳嗎' }]])
    .map(([said, output]) => `使用者說：「${said}」\n${JSON.stringify(output)}`);

  return [
    '你是臺北市政府城市通的語音助手。從下列任務中選出最符合使用者需求的一個，並抽出需要的資料。只輸出 JSON，不要輸出其他文字。',
    '任務：',
    ...tasks,
    '- question：詢問規定或其他問題',
    '- other：以上都不是',
    '格式：{"task": "...", "slots": {...}, "question": "task 為 question 時，填使用者的問題"}',
    '使用者沒提到的資料不要填。車號用大寫英文字母和阿拉伯數字，中間加「-」，例如 ABC-1234。',
    '範例：',
    ...examples,
  ].join('\n');
}

/** 任務 A 的使用者訊息 */
export function taskUserPrompt(text: string): string {
  return `使用者說：「${text}」`;
}

/** 一筆 FAQ 轉成文字；格式為 { q, a } 或 { question, answer }，其他格式把值串起來 */
function faqItemText(item: Record<string, unknown>): string {
  const q = item.q ?? item.question;
  const a = item.a ?? item.answer;
  if (typeof q === 'string' && typeof a === 'string') return `問：${q}\n答：${a}`;
  return Object.values(item).map(String).join('：');
}

/** 任務 B 的 system prompt：資料來自 web/src/data/faq/ */
export function faqPrompt(faqs: FaqFile[]): string {
  const sections = faqs
    .filter((faq) => faq.items?.length)
    .map((faq) => [`【${faq.source}】`, ...faq.items.map(faqItemText)].join('\n'));

  return [
    '你是臺北市政府城市通的語音助手，對象是長輩與行動不便的市民。只根據下面的資料回答，使用繁體中文（臺灣用語），兩句話以內，口語化，不要條列。',
    '資料裡沒有的內容，回答「這個我不確定，可以幫您撥 1999 詢問」。',
    '資料：',
    sections.length ? sections.join('\n\n') : '（尚未放入）',
  ].join('\n');
}
