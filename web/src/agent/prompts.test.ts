import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackAnswer, faqPrompt, pickFaqs, taskPrompt } from './prompts.ts';
import type { TaskScript } from '../bridge/types.ts';

const parking: TaskScript = {
  id: 'parking_fee',
  description: '查詢路邊停車費',
  slots: {
    vehicle: { ask: '', options: ['汽車', '機車'] },
    plate: { ask: '', label: '車號' },
  },
  steps: [],
};

test('任務清單由腳本產生', () => {
  const prompt = taskPrompt({ parking_fee: parking });
  assert.ok(prompt.includes('- parking_fee：查詢路邊停車費。資料：vehicle（汽車或機車）、plate（車號）'));
  assert.ok(prompt.includes('"task"')); // 瀏覽器 mock 靠這個判斷是任務 A
});

test('只放清單裡有的腳本的範例', () => {
  const example = '"plate":"ABC-123"';
  assert.ok(taskPrompt({ parking_fee: parking }).includes(example));
  const other = { ...parking, id: 'library_search' };
  assert.ok(!taskPrompt({ library_search: other }).includes(example));
});

test('FAQ 放進任務 B', () => {
  const prompt = faqPrompt([
    { source: '臺北市停車管理工程處', items: [{ q: '可以超商繳嗎？', a: '可以，四大超商都能繳。' }] },
    { source: '空的', items: [] },
  ]);
  assert.ok(prompt.includes('【臺北市停車管理工程處】\n問：可以超商繳嗎？\n答：可以，四大超商都能繳。'));
  assert.ok(!prompt.includes('空的'));
});

test('沒有 FAQ', () => {
  assert.ok(faqPrompt([]).includes('（尚未放入）'));
});

test('任務 B 失敗時的說明', () => {
  assert.match(fallbackAnswer('not_ready'), /準備中/);
  assert.match(fallbackAnswer('busy'), /稍等/);
  assert.match(fallbackAnswer('timeout'), /1999/);
  assert.match(fallbackAnswer(), /1999/);
});

test('任務 B 只放相關的 FAQ', () => {
  const faq = (source: string) => ({ source, items: [{ q: 'q', a: 'a' }] });
  const faqs = {
    parking_fee: faq('停管處'),
    library: faq('圖書館'),
    household_registration: faq('民政局'),
    townpass: faq('台北通'),
  };
  const sources = (question: string) => pickFaqs(faqs, question).map((f) => f.source);
  assert.deepEqual(sources('停車費可以去超商繳嗎'), ['停管處', '台北通']);
  assert.deepEqual(sources('圖書館幾點關門'), ['圖書館', '台北通']);
  assert.deepEqual(sources('戶政事務所要排隊多久'), ['民政局', '台北通']);
  // 對不到就全部放
  assert.deepEqual(sources('敬老卡要怎麼申請'), ['停管處', '圖書館', '民政局', '台北通']);
});
