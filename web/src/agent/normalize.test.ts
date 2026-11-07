import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeyword, matchOption, normalizePlate, normalizeSlot } from './normalize.ts';
import type { TaskScript } from '../bridge/types.ts';

test('車號：各種唸法', () => {
  const cases: [string, string][] = [
    ['ABC-123', 'ABC-123'],
    ['abc123', 'ABC-123'],
    ['A B C 一 二 三', 'ABC-123'],
    ['ABC 杠 123', 'ABC-123'],
    ['ＡＢＣ１２３４', 'ABC-1234'],
    ['我的車號是 ABC 一二三四', 'ABC-1234'],
    ['1234 AB', '1234-AB'],
    ['ab 兩洞幺八', 'AB-2018'],
    ['6789 槓 W2', '6789-W2'],
  ];
  for (const [input, expected] of cases) assert.equal(normalizePlate(input), expected, input);
});

test('車號：讀不出來', () => {
  assert.equal(normalizePlate('我不知道'), null);
  assert.equal(normalizePlate(''), null);
});

test('車號：字母數字交錯又沒說分隔，不亂補', () => {
  assert.equal(normalizePlate('6789W2'), '6789W2');
});

test('選項：取最後說的那個、認得其他說法', () => {
  assert.equal(matchOption(['汽車', '機車'], '機車'), '機車');
  assert.equal(matchOption(['汽車', '機車'], '不是汽車，是機車'), '機車');
  assert.equal(matchOption(['汽車', '機車'], '摩托車'), '機車');
  assert.equal(matchOption(['汽車', '機車'], '我開轎車'), '汽車');
  assert.equal(matchOption(['汽車', '機車'], '腳踏車'), null);
});

test('選項：機關簡稱', () => {
  const offices = ['地政事務所', '戶政事務所', '區公所', '稅捐處', '就業服務站'];
  assert.equal(matchOption(offices, '戶政'), '戶政事務所');
  assert.equal(matchOption(offices, '我要去公所'), '區公所');
  assert.equal(matchOption(offices, '中正區公所'), '區公所');
  assert.equal(matchOption(offices, '找工作的地方'), '就業服務站');
});

const script: TaskScript = {
  id: 'parking_fee',
  description: '查詢路邊停車費',
  slots: {
    vehicle: { ask: '', options: ['汽車', '機車'] },
    plate: { ask: '', pattern: '^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$' },
  },
  steps: [],
};

test('normalizeSlot：依腳本格式檢查', () => {
  assert.equal(normalizeSlot(script, 'plate', 'abc 一二三'), 'ABC-123');
  assert.equal(normalizeSlot(script, 'plate', '6789W2'), null); // 不符 pattern
  assert.equal(normalizeSlot(script, 'vehicle', '機車'), '機車');
  assert.equal(normalizeSlot(script, 'unknown', 'x'), null);
});

test('選項：前面有否定詞的不算（review）', () => {
  assert.equal(matchOption(['汽車', '機車'], '機車，不是汽車'), '機車');
  assert.equal(matchOption(['汽車', '機車'], '不是汽車 是機車'), '機車');
  assert.equal(matchOption(['汽車', '機車'], '不要汽車'), null);
});

test('查書關鍵字：去掉前後綴（review）', () => {
  const cases: [string, string][] = [
    ['我要找東野圭吾的書', '東野圭吾'],
    ['幫我查哈利波特', '哈利波特'],
    ['圖書館有沒有東野圭吾寫的書？', '東野圭吾'],
    ['神奇柑仔店', '神奇柑仔店'],
    ['查理與巧克力工廠', '查理與巧克力工廠'], // 單字「查」不能切
  ];
  for (const [input, expected] of cases) assert.equal(extractKeyword(input), expected, input);
});

test('查書關鍵字：沒說書名就回傳 null，讓流程再問一次', () => {
  assert.equal(extractKeyword('我要找書'), null);
  assert.equal(extractKeyword('幫我找一本書'), null);
  assert.equal(extractKeyword(''), null);
});

test('選項：繳費方式的說法', () => {
  const methods = ['悠遊付', '台北富邦信用卡', '智慧支付平台'];
  assert.equal(matchOption(methods, '用悠遊卡'), '悠遊付');
  assert.equal(matchOption(methods, '刷信用卡'), '台北富邦信用卡');
  assert.equal(matchOption(methods, '智慧支付'), '智慧支付平台');
});
