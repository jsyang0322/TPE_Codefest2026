// 執行：node --test src/agent/   （Node 22.18 以上可直接跑 .ts）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeResult, foundNothing } from './describe.ts';

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
    '館藏裡找到 2 本，有《歡迎光臨錢天堂》、《神奇柑仔店. 15, 冒牌的長髮公主餅乾》。',
  );
  assert.equal(describeResult('library_search', { books: ['A', 'B', 'C', 'D'] }), '館藏裡找到 4 本，有《A》、《B》、《C》等。');
  assert.equal(describeResult('library_search', { books: [] }), '館藏查無相關的書，可以換個書名或作者再試一次。');
  // 關鍵字過濾（搜尋頁沒有功能，改由網頁端過濾首頁書單）
  assert.equal(
    describeResult('library_search', { books: ['歡迎光臨錢天堂 : 神奇柑仔店大圖鑑', '底層邏輯'] }, { keyword: '柑仔店' }),
    '館藏裡找到 1 本，有《歡迎光臨錢天堂》。',
  );
  assert.ok(
    describeResult('library_search', { books: ['底層邏輯'] }, { keyword: '東野圭吾' }).includes('館藏查無「東野圭吾」'),
  );
  // 車號比對：示範站不管查什麼都回同一套帳單，要在網頁端比對
  const bills = [{ 繳費期限: '2024/12/31', 繳費金額: 'NT$60', 車號: 'ABC–123' }]; // en dash，模擬畫面實況
  assert.ok(describeResult('parking_fee', { bills }, { plate: 'XYZ-999' }).includes('查無車號 XYZ-999'));
  assert.equal(
    describeResult('parking_fee', { bills }, { plate: 'ABC-123' }),
    '查到 1 筆，共 60 元，最早的期限是 2024 年 12 月 31 日。',
  );
});

test('臨櫃叫號：去掉號碼前面的 0', () => {
  // 示範服務站戶政事務所、區公所實際讀回的資料
  assert.equal(
    describeResult('counter_calling', { counters: ['綜合受理|0379號 等候0', '博愛櫃檯|903號 等候6', '社會業務|000號 等候0'] }),
    '綜合受理叫到 379 號，等候 0 人；博愛櫃檯叫到 903 號，等候 6 人；社會業務叫到 0 號，等候 0 人。',
  );
  assert.equal(describeResult('counter_calling', { counters: [] }), '目前查不到櫃檯的等候狀況。');
});

test('結果是文字時原樣顯示', () => {
  assert.equal(describeResult('parking_fee', { bills: '（瀏覽器模擬）查到 2 筆' }), '（瀏覽器模擬）查到 2 筆');
});

test('期限用日期比較，不用字串排序（review）', () => {
  assert.equal(
    describeResult('parking_fee', {
      bills: [
        { 繳費期限: '2024/12/31', 繳費金額: 'NT$60' },
        { 繳費期限: '2024/9/1', 繳費金額: 'NT$150' },
      ],
    }),
    '查到 2 筆，共 210 元，最早的期限是 2024 年 9 月 1 日。',
  );
});

test('繳費完成', () => {
  // 示範服務站繳費完成頁實際讀回的資料
  assert.equal(
    describeResult('parking_fee_pay', {
      receipt: { 繳費項目: '停車費', 繳費日期: '2026/11/07', 付款方式: '悠遊付', 帳單總金額: 'NT$510' },
    }),
    '繳費完成，用悠遊付繳了 510 元。',
  );
});

test('查無結果才關服務頁：車號不符、館藏沒有這本書', () => {
  const bills = [{ 繳費期限: '2024/12/31', 繳費金額: 'NT$60', 車號: 'ABC–123' }];
  assert.equal(foundNothing('parking_fee', { bills }, { plate: 'XYZ-999' }), true);
  assert.equal(foundNothing('parking_fee', { bills }, { plate: 'ABC-123' }), false);
  assert.equal(foundNothing('library_search', { books: ['底層邏輯'] }, { keyword: '小王子' }), true);
  assert.equal(foundNothing('library_search', { books: ['小王子'] }, { keyword: '小王子' }), false);
  // 瀏覽器模擬回文字、其他腳本：不關
  assert.equal(foundNothing('parking_fee', { bills: '（瀏覽器模擬）查到 2 筆' }), false);
  assert.equal(foundNothing('counter_calling', { counters: [] }), false);
});
