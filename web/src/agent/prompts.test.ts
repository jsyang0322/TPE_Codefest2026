import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faqPrompt, taskPrompt } from './prompts.ts';
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
