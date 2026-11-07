import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillTemplate, planFollowUp } from './followup.ts';
import type { TaskScript } from '../bridge/types.ts';

const load = (name: string): TaskScript =>
  JSON.parse(readFileSync(new URL(`./scripts/${name}.json`, import.meta.url), 'utf8'));
const parkingFee = load('parking_fee');
const parkingFeePay = load('parking_fee_pay');
const followUps = { parking_fee_pay: parkingFeePay };

const bills = [
  { 繳費期限: '2024/12/31', 繳費金額: 'NT$60', 車號: 'ABC–123' }, // en dash，模擬畫面實況
  { 繳費期限: '2025/01/14', 繳費金額: 'NT$150', 車號: 'ABC–123' },
];

test('查到帳單：接著問要不要繳，車種車號帶過去', () => {
  const next = planFollowUp(parkingFee, { bills }, { vehicle: '機車', plate: 'ABC-123' }, followUps);
  assert.ok(next);
  assert.equal(next.script.id, 'parking_fee_pay');
  assert.equal(next.ask, '要現在幫您繳費嗎？');
  assert.deepEqual(next.slots, { vehicle: '機車', plate: 'ABC-123' });
  assert.equal(
    next.confirm({ ...next.slots, method: '悠遊付' }),
    '用悠遊付繳車號 ABC-123 的停車費，共 210 元，確定嗎？',
  );
});

test('沒有帳單就不問', () => {
  assert.equal(planFollowUp(parkingFee, { bills: [] }, {}, followUps), null);
  assert.equal(planFollowUp(parkingFee, {}, {}, followUps), null);
});

test('車號不符就不問：示範站查 XYZ-999 也回 ABC-123 的帳單', () => {
  assert.equal(planFollowUp(parkingFee, { bills }, { vehicle: '汽車', plate: 'XYZ-999' }, followUps), null);
});

test('沒有 next 的腳本、找不到接續腳本都回傳 null', () => {
  assert.equal(planFollowUp(parkingFeePay, { receipt: {} }, {}, followUps), null);
  assert.equal(planFollowUp(parkingFee, { bills }, {}, {}), null);
});

test('繳費腳本的關鍵字跟查詢腳本一致，才帶得過去', () => {
  assert.deepEqual(parkingFeePay.slots.vehicle, parkingFee.slots.vehicle);
  assert.deepEqual(parkingFeePay.slots.plate, parkingFee.slots.plate);
});

test('fillTemplate：沒有的值保留原樣', () => {
  assert.equal(fillTemplate('共 {total} 元，{x}', { total: '510' }), '共 510 元，{x}');
});
