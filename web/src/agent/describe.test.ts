// 執行：node --test src/agent/   （Node 22.18 以上可直接跑 .ts）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeResult } from './describe.ts';

// 示範服務站停車費頁實際讀回的資料（2026/11/7 用 runner.js 實測）
const bills = [
  { title: 'A1111111111', 繳費期限: '2024/12/31', 繳費金額: 'NT$60', 車號: 'ABC-123' },
  { title: 'A2222222222', 繳費期限: '2025/01/14', 繳費金額: 'NT$150', 車號: 'ABC-123' },
  { title: 'A3333333333', 繳費期限: '2025/01/14', 繳費金額: 'NT$150', 車號: 'ABC-123' },
  { title: 'A44444444444', 繳費期限: '2025/01/14', 繳費金額: 'NT$150', 車號: 'ABC-123' },
];

test('停車費帳單轉成一句話', () => {
  assert.equal(
    describeResult('parking_fee', { bills }),
    '查到 4 筆，共 510 元，最早的期限是 2024 年 12 月 31 日。',
  );
});

test('沒有帳單', () => {
  assert.equal(describeResult('parking_fee', { bills: [] }), '沒有查到未繳的停車費。');
});

test('金額有千分位', () => {
  assert.equal(
    describeResult('parking_fee', { bills: [{ 繳費金額: 'NT$1,200' }] }),
    '查到 1 筆，共 1200 元。',
  );
});

test('瀏覽器模擬回傳文字時原樣顯示', () => {
  assert.equal(describeResult('parking_fee', { bills: '（瀏覽器模擬）查到 2 筆' }), '（瀏覽器模擬）查到 2 筆');
});
