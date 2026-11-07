import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCommand, matchYesNo } from '../agent/keywords.ts';
import { CONFIRM_LABELS, YES_NO_LABELS } from './choices.ts';

for (const [yes, no] of [YES_NO_LABELS, CONFIRM_LABELS]) {
  test(`按鈕「${yes}」「${no}」能被判斷成是／否`, () => {
    assert.equal(matchYesNo(yes), 'yes');
    assert.equal(matchYesNo(no), 'no');
  });

  test(`按鈕「${yes}」「${no}」不會被當成停止或重念`, () => {
    assert.equal(matchCommand(yes), null);
    assert.equal(matchCommand(no), null);
  });
}
