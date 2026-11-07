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

test('圖書館：書名去掉副題，最多唸三本', () => {
  // 示範服務站搜尋「神奇柑仔店」實際讀回的資料
  assert.equal(
    describeResult('library_search', { books: ['歡迎光臨錢天堂 : 神奇柑仔店大圖鑑', '神奇柑仔店. 15, 冒牌的長髮公主餅乾'] }),
    '找到 2 本，有《歡迎光臨錢天堂》、《神奇柑仔店. 15, 冒牌的長髮公主餅乾》。',
  );
  assert.equal(describeResult('library_search', { books: ['A', 'B', 'C', 'D'] }), '找到 4 本，有《A》、《B》、《C》等。');
  assert.equal(describeResult('library_search', { books: [] }), '沒有找到相關的書，可以換個書名或作者再試一次。');
});

test('臨櫃叫號：去掉號碼前面的 0', () => {
  // 示範服務站戶政事務所、區公所實際讀回的資料
  assert.equal(
    describeResult('counter_calling', { counters: ['綜合受理|0379號 等候0', '博愛櫃檯|903號 等候6', '社會業務|000號 等候0'] }),
    '綜合受理叫到 379 號，等候 0 人；博愛櫃檯叫到 903 號，等候 6 人；社會業務叫到 0 號，等候 0 人。',
  );
  assert.equal(describeResult('counter_calling', { counters: [] }), '目前查不到櫃檯的等候狀況。');
});

test('瀏覽器模擬回傳文字時原樣顯示', () => {
  assert.equal(describeResult('parking_fee', { bills: '（瀏覽器模擬）查到 2 筆' }), '（瀏覽器模擬）查到 2 筆');
});
