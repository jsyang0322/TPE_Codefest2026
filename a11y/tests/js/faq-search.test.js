// 用實際整理好的關鍵字與同義詞（backend/data/*.json）測試搜尋結果是否合理。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { normalize, popularFaqs, searchFaq } from '../../frontend/js/faq-search.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../backend/data/${name}`, import.meta.url), 'utf8'));
const keywords = load('faq_keywords.json');
const synonyms = load('faq_synonyms.json');
const faqs = Object.entries(keywords).map(([question, words], id) => ({ id, question, keywords: words, popularity: 0 }));

const questions = (query) => searchFaq(query, faqs, synonyms).map((faq) => faq.question);

test('normalize 去掉標點、轉小寫、換成標準詞', () => {
  assert.equal(normalize('我登不進去！', synonyms), '我登入');
  assert.equal(normalize('QR Code 怎麼掃？', synonyms), 'qrcode怎麼掃');
  assert.equal(normalize('我的身份證', synonyms), '我的身分證');
});

test('長的口語說法先換', () => {
  assert.equal(normalize('密碼想不起來', { 忘記密碼: ['想不起來密碼', '密碼想不起來'], 忘記: ['想不起來'] }), '忘記密碼');
});

test('「我登不進去」找得到登入相關的問題', () => {
  const result = questions('我登不進去');
  assert.ok(result.length > 0 && result.length <= 3);
  assert.ok(result.includes('帳號輸入錯誤幾次會被鎖定？如被鎖定該如何解鎖？'));
  assert.ok(result.includes('無法收到忘記密碼驗證信，請問如何處理？為什麼會出現傳送失敗？'));
});

test('口語問法找得到對的題目（第一名）', () => {
  assert.equal(questions('密碼忘了怎麼辦')[0], '無法收到忘記密碼驗證信，請問如何處理？為什麼會出現傳送失敗？');
  assert.equal(questions('優惠券要怎麼用')[0], '如何使用優惠券？');
  assert.equal(questions('身份證一直掃描失敗')[0], '為什麼掃描身分證(證件)會失敗？');
  assert.equal(questions('我的小孩沒有身分證')[0], '孩子沒有身分證怎麼申請？');
  assert.equal(questions('怎麼用 QR Code 登入')[0], '如何使用手機掃描QRcode進行登入？');
  assert.equal(questions('帳號被鎖住了')[0], '帳號輸入錯誤幾次會被鎖定？如被鎖定該如何解鎖？');
  assert.equal(questions('我要怎麼註冊台北通')[0], '如何申請註冊成為台北通會員？');
});

test('沒有關鍵字就回傳空的，不硬給答案', () => {
  assert.deepEqual(questions('今天天氣如何'), []);
  assert.deepEqual(questions(''), []);
});

test('最多回傳 3 題', () => {
  assert.ok(questions('優惠券').length <= 3);
});

test('同分時，被點選較多次的排前面', () => {
  const items = [
    { id: 1, question: 'A', keywords: ['優惠券'], popularity: 0 },
    { id: 2, question: 'B', keywords: ['優惠券'], popularity: 5 },
  ];
  assert.deepEqual(searchFaq('優惠券', items).map((f) => f.question), ['B', 'A']);
  assert.deepEqual(popularFaqs(items, 1).map((f) => f.question), ['B']);
});
