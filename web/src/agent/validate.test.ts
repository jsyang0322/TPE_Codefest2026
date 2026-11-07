import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskOutput } from './validate.ts';
import type { TaskScript } from '../bridge/types.ts';

const scripts: Record<string, TaskScript> = {
  parking_fee: {
    id: 'parking_fee',
    description: '查詢路邊停車費',
    slots: {
      vehicle: { ask: '', options: ['汽車', '機車'] },
      plate: { ask: '', pattern: '^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$' },
    },
    steps: [],
  },
};

test('正常輸出', () => {
  assert.deepEqual(
    parseTaskOutput('{"task":"parking_fee","slots":{"vehicle":"機車","plate":"ABC-123"}}', scripts),
    { task: 'parking_fee', slots: { vehicle: '機車', plate: 'ABC-123' }, question: '' },
  );
});

test('去掉 ```json 包裹和前後說明', () => {
  const raw = '好的，以下是結果：\n```json\n{"task": "parking_fee", "slots": {}}\n```\n希望有幫助';
  assert.deepEqual(parseTaskOutput(raw, scripts), { task: 'parking_fee', slots: {}, question: '' });
});

test('車號會正規化', () => {
  const out = parseTaskOutput('{"task":"parking_fee","slots":{"plate":"abc 123"}}', scripts);
  assert.deepEqual(out?.slots, { plate: 'ABC-123' });
});

test('腳本沒定義的欄位、格式不符的值都丟掉', () => {
  const raw = '{"task":"parking_fee","slots":{"vehicle":"腳踏車","plate":"不知道","color":"紅色","office":"區公所"}}';
  assert.deepEqual(parseTaskOutput(raw, scripts)?.slots, {});
});

test('slots 不是物件也不會出錯', () => {
  assert.deepEqual(parseTaskOutput('{"task":"parking_fee","slots":"ABC-123"}', scripts)?.slots, {});
  assert.deepEqual(parseTaskOutput('{"task":"parking_fee"}', scripts)?.slots, {});
});

test('question、other', () => {
  assert.deepEqual(parseTaskOutput('{"task":"question","slots":{},"question":" 停車費可以超商繳嗎 "}', scripts), {
    task: 'question',
    slots: {},
    question: '停車費可以超商繳嗎',
  });
  assert.equal(parseTaskOutput('{"task":"other"}', scripts)?.task, 'other');
});

test('整份不能用時回傳 null', () => {
  assert.equal(parseTaskOutput('我不知道', scripts), null);
  assert.equal(parseTaskOutput('{"task": "parking_fee", ', scripts), null);
  assert.equal(parseTaskOutput('{"task":"library_search","slots":{}}', scripts), null); // 不在清單內
  assert.equal(parseTaskOutput('{"slots":{}}', scripts), null);
  assert.equal(parseTaskOutput('[1,2]', scripts), null);
});
