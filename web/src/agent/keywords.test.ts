import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCommand, matchScript, matchYesNo } from './keywords.ts';

test('指令：停止、再說一次', () => {
  assert.equal(matchCommand('停止'), 'stop');
  assert.equal(matchCommand('算了不要了'), 'stop');
  assert.equal(matchCommand('取消'), 'stop');
  assert.equal(matchCommand('可以再說一次嗎'), 'repeat');
  assert.equal(matchCommand('我聽不清楚'), 'repeat');
  assert.equal(matchCommand('機車'), null);
  assert.equal(matchCommand('ABC 一二三'), null);
});

test('是非題：否定詞先比對', () => {
  assert.equal(matchYesNo('不是'), 'no');
  assert.equal(matchYesNo('不要'), 'no');
  assert.equal(matchYesNo('不對喔'), 'no');
  assert.equal(matchYesNo('錯了'), 'no');
  assert.equal(matchYesNo('對'), 'yes');
  assert.equal(matchYesNo('是的'), 'yes');
  assert.equal(matchYesNo('好啊'), 'yes');
  assert.equal(matchYesNo('沒錯'), 'yes');
  assert.equal(matchYesNo('嗯嗯'), null);
});

test('關鍵字挑腳本', () => {
  const all = ['parking_fee', 'library_search', 'counter_calling'];
  assert.equal(matchScript('我想查停車費', all), 'parking_fee');
  assert.equal(matchScript('幫我在圖書館找一本書', all), 'library_search');
  assert.equal(matchScript('現在叫到幾號', all), null);
  assert.equal(matchScript('我要排隊', all), 'counter_calling');
  assert.equal(matchScript('今天天氣如何', all), null);
});

test('還沒有的腳本不會被挑到', () => {
  assert.equal(matchScript('我要借書', ['parking_fee']), null);
});
