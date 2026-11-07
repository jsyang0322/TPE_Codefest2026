import assert from 'node:assert/strict';
import { test } from 'node:test';

import { speechText } from '../../frontend/js/speech-text.js';

test('電話號碼一個數字一個數字念', () => {
  assert.equal(speechText('請致電客服1999(外縣市02-27208889)轉8585。'), '請致電客服1 9 9 9(外縣市0 2 2 7 2 0 8 8 8 9)轉8 5 8 5。');
});

test('短的數字照常念', () => {
  assert.equal(speechText('錯誤3次將被鎖定15分鐘。'), '錯誤3次將被鎖定15分鐘。');
});

test('網址不念', () => {
  assert.equal(speechText('網址如下：\nhttps://service.taipei/case-detail/AW004'), '網址如下：');
});

test('編號改成停頓，沒有標點的行補句號', () => {
  assert.equal(speechText('請依以下步驟：\n1.登入\n2.升級金質會員'), '請依以下步驟： 1，登入。 2，升級金質會員。');
  assert.equal(speechText('(一)點擊卡證。'), '一，點擊卡證。');
});

test('時間範圍與提醒符號', () => {
  assert.equal(speechText('週一至週五 09:00~5:00'), '週一至週五 09:00到5:00。');
  assert.equal(speechText('※手機有設定黑名單'), '手機有設定黑名單。');
  assert.equal(speechText('※提醒您鎖定期間無法變更密碼。'), '提醒您鎖定期間無法變更密碼。');
});
