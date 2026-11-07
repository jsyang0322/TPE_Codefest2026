import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeyword, findPlate, matchOption, normalizePlate, normalizeSlot, slotsFromText } from './normalize.ts';
import type { TaskScript } from '../bridge/types.ts';
import { readFileSync } from 'node:fs';

const loadScript = (name: string): TaskScript =>
  JSON.parse(readFileSync(new URL(`./scripts/${name}.json`, import.meta.url), 'utf8'));

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

test('從整句話找車號', () => {
  const pattern = loadScript('parking_fee').slots.plate.pattern;
  assert.equal(findPlate('幫我查停車費，車號 ABC 123', pattern), 'ABC-123');
  assert.equal(findPlate('我要查 ABC 一二三 機車的停車費', pattern), 'ABC-123');
  assert.equal(findPlate('A B C 杠 一 二 三 那台汽車的停車費', pattern), 'ABC-123');
  assert.equal(findPlate('查一下 ABC1234 的停車費', pattern), 'ABC-1234');
  assert.equal(findPlate('車號是 ７７８８－ＥＸ', pattern), '7788-EX');
  // 沒說車號、只有數字或只有字母：不亂填
  assert.equal(findPlate('幫我查停車費', pattern), null);
  assert.equal(findPlate('我有兩台車', pattern), null);
  assert.equal(findPlate('查一下停車費', pattern), null);
});

test('不用 LLM 抽出腳本的資料', () => {
  assert.deepEqual(slotsFromText(loadScript('parking_fee'), '幫我查停車費，車號 ABC 123'), { plate: 'ABC-123' });
  assert.deepEqual(slotsFromText(loadScript('parking_fee'), '我要查 ABC 一二三 機車的停車費'), {
    vehicle: '機車',
    plate: 'ABC-123',
  });
  assert.deepEqual(slotsFromText(loadScript('parking_fee'), '我的摩托車停車費還沒繳'), { vehicle: '機車' });
  assert.deepEqual(slotsFromText(loadScript('library_search'), '圖書館有沒有東野圭吾的書'), { keyword: '東野圭吾' });
  assert.deepEqual(slotsFromText(loadScript('library_search'), '我想借哈利波特'), { keyword: '哈利波特' });
  // 抽不乾淨就不填，之後再問
  assert.deepEqual(slotsFromText(loadScript('library_search'), '我要找書'), {});
  assert.deepEqual(slotsFromText(loadScript('library_search'), '幫我在圖書館查書'), {});
  assert.deepEqual(slotsFromText(loadScript('counter_calling'), '區公所現在叫到幾號'), { office: '區公所' });
});
