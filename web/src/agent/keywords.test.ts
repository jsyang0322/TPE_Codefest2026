import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeQuestion, matchCommand, matchScript, matchYesNo, routeByKeywords } from './keywords.ts';

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
  assert.equal(matchScript('現在叫到幾號', all), 'counter_calling');
  assert.equal(matchScript('我要排隊', all), 'counter_calling');
  assert.equal(matchScript('今天天氣如何', all), null);
});

test('還沒有的腳本不會被挑到', () => {
  assert.equal(matchScript('我要借書', ['parking_fee']), null);
});

test('是非題：「不錯」「沒問題」是肯定（review）', () => {
  assert.equal(matchYesNo('不錯'), 'yes');
  assert.equal(matchYesNo('沒問題'), 'yes');
  assert.equal(matchYesNo('不行'), 'no');
});

test('關鍵字挑腳本：不被「書」誤導、認得機關名稱（review）', () => {
  const all = ['parking_fee', 'library_search', 'counter_calling'];
  assert.equal(matchScript('區公所辦證明書要排多久', all), 'counter_calling');
  assert.equal(matchScript('戶政事務所現在幾號', all), 'counter_calling');
  assert.equal(matchScript('我要找東野圭吾的書', all), 'library_search');
  assert.equal(matchScript('秘書', all), null);
});

test('像不像問句', () => {
  assert.equal(looksLikeQuestion('敬老卡怎麼辦'), true);
  assert.equal(looksLikeQuestion('圖書館幾點關門'), true);
  assert.equal(looksLikeQuestion('可以用悠遊卡嗎'), true);
  assert.equal(looksLikeQuestion('今天天氣'), false);
  assert.equal(looksLikeQuestion('隨便'), false);
});

test('不問 LLM 的判斷：實機測試句', () => {
  const all = ['parking_fee', 'library_search', 'counter_calling'];
  const route = (text: string) => routeByKeywords(text, all);
  const task = (id: string) => ({ kind: 'task', id });
  const question = { kind: 'question' };
  // docs/prompt實機測試.md 的 15 句
  assert.deepEqual(route('幫我查停車費，車號 ABC 123'), task('parking_fee'));
  assert.deepEqual(route('我要查 ABC 一二三 機車的停車費'), task('parking_fee'));
  assert.deepEqual(route('A B C 杠 一 二 三 那台汽車的停車費'), task('parking_fee'));
  assert.deepEqual(route('幫我繳停車費'), task('parking_fee'));
  assert.deepEqual(route('我的摩托車停車費還沒繳'), task('parking_fee'));
  assert.deepEqual(route('停車費要怎麼繳'), question);
  assert.deepEqual(route('圖書館有沒有東野圭吾的書'), task('library_search'));
  assert.deepEqual(route('我想借哈利波特'), task('library_search'));
  assert.deepEqual(route('戶政事務所現在要等多久'), task('counter_calling'));
  assert.deepEqual(route('區公所現在叫到幾號'), task('counter_calling'));
  assert.deepEqual(route('敬老卡要怎麼申請'), question);
  assert.deepEqual(route('圖書館幾點關門'), question);
  assert.deepEqual(route('今天天氣好嗎'), question);
  assert.equal(route('嗯…那個…'), null);
  assert.deepEqual(route('停車費'), task('parking_fee'));
});

test('不問 LLM 的判斷：問句裡要辦事、要辦事的說法裡在問', () => {
  const all = ['parking_fee', 'library_search', 'counter_calling'];
  assert.deepEqual(routeByKeywords('可以幫我查停車費嗎', all), { kind: 'task', id: 'parking_fee' });
  assert.deepEqual(routeByKeywords('我想問停車費怎麼算', all), { kind: 'question' });
  assert.deepEqual(routeByKeywords('我想知道圖書館幾點開', all), { kind: 'question' });
  // 還沒寫好的腳本不會被挑到
  assert.equal(routeByKeywords('幫我查停車費', ['library_search']), null);
});
