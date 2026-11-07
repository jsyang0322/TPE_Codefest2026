import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCommand } from '../../frontend/js/voice-commands.js';

const ALL = ['repeat', 'none', 'back', 'next', 'call', 'all', 'select'];

test('選第幾個', () => {
  assert.deepEqual(parseCommand('第一個', ALL), { type: 'select', index: 0 });
  assert.deepEqual(parseCommand('第2個', ALL), { type: 'select', index: 1 });
  assert.deepEqual(parseCommand('我要第三個。', ALL), { type: 'select', index: 2 });
  assert.deepEqual(parseCommand('一', ALL), { type: 'select', index: 0 });
  assert.deepEqual(parseCommand('兩個', ALL), { type: 'select', index: 1 });
});

test('含「一」的指令不會被當成選第一個', () => {
  assert.deepEqual(parseCommand('再說一次', ALL), { type: 'repeat' });
  assert.deepEqual(parseCommand('換個說法再問一次', ALL), { type: 'none' });
});

test('一般句子不是指令', () => {
  assert.equal(parseCommand('第一次登入要怎麼做', ALL), null);
  assert.equal(parseCommand('我登不進去', ALL), null);
  assert.equal(parseCommand('', ALL), null);
});

test('其他指令', () => {
  assert.deepEqual(parseCommand('下一段', ALL), { type: 'next' });
  assert.deepEqual(parseCommand('都不是', ALL), { type: 'none' });
  assert.deepEqual(parseCommand('回到問題', ALL), { type: 'back' });
  assert.deepEqual(parseCommand('幫我打 1999', ALL), { type: 'call' });
  assert.deepEqual(parseCommand('看全部問題', ALL), { type: 'all' });
});

test('照顧者代操作的指令', () => {
  const observe = ['revoke', 'takeover', 'repeat'];
  assert.deepEqual(parseCommand('停止授權', observe), { type: 'revoke' });
  assert.deepEqual(parseCommand('不要讓他操作了', observe), { type: 'revoke' });
  assert.deepEqual(parseCommand('我自己來就好', observe), { type: 'takeover' });

  const confirmDialog = ['confirm', 'cancel', 'repeat'];
  assert.deepEqual(parseCommand('確定', confirmDialog), { type: 'confirm' });
  assert.deepEqual(parseCommand('不確定', confirmDialog), { type: 'cancel' });
  assert.deepEqual(parseCommand('取消', confirmDialog), { type: 'cancel' });
  // 「取消授權」在觀看畫面是停止授權，不是取消
  assert.deepEqual(parseCommand('取消授權', ['revoke', 'cancel']), { type: 'revoke' });

  assert.deepEqual(parseCommand('我想讓家人幫我', ['invite']), { type: 'invite' });
});

test('只判斷這個畫面開放的指令', () => {
  assert.equal(parseCommand('第一個', ['repeat', 'next']), null);
  assert.equal(parseCommand('下一段', ['repeat', 'select']), null);
});
