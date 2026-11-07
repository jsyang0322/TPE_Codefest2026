import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { FaqFile } from '../agent/prompts.ts';

// 競賽規則：資料要註明出處。每個問答檔都要有來源、網址、取得日期，README「資料來源」表照著填。
const dir = new URL('./faq/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));

for (const name of files) {
  test(`${name} 有註明出處`, () => {
    const faq = JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as FaqFile;
    assert.ok(faq.source, 'source');
    assert.match(faq.url ?? '', /^https:\/\//);
    assert.match(faq.retrievedAt ?? '', /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(faq.items.length > 0, 'items');
  });
}

test('至少有一個 data.taipei 的資料集', () => {
  const urls = files.map((name) => (JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as FaqFile).url ?? '');
  assert.ok(urls.some((url) => url.startsWith('https://data.taipei/')));
});
