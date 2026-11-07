// 把使用者說的話（或 LLM 抽出的值）轉成腳本要的格式。
// 純函式，可以直接用 node --test 測。

import type { TaskScript } from '../bridge/types.ts';

const CHINESE_DIGITS: Record<string, string> = {
  零: '0', 〇: '0', 洞: '0',
  一: '1', 幺: '1', 么: '1',
  二: '2', 兩: '2', 两: '2',
  三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9',
};

/** 唸車號時代表「-」的說法 */
const SEPARATOR = /杠|槓|横|橫|減|dash|-/gi;

/**
 * 車號正規化：「abc 一二三」「ABC 杠 123」「ＡＢＣ１２３」→「ABC-123」。
 * 有說出分隔符號就照使用者說的位置；沒說就在英文字母和數字交界處補「-」。
 * 讀不出來回傳 null；格式是否合法由呼叫端用腳本的 pattern 檢查。
 */
export function normalizePlate(text: string): string | null {
  let plate = text.normalize('NFKC').toUpperCase(); // 全形轉半形
  plate = plate.replace(/[零〇洞一幺么二兩两三四五六七八九]/g, (char) => CHINESE_DIGITS[char]);
  plate = plate.replace(SEPARATOR, '-').replace(/[^A-Z0-9-]/g, '');
  plate = plate.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!plate) return null;
  if (plate.includes('-')) return plate;

  // 沒有分隔符號：只有「字母段＋數字段」或「數字段＋字母段」兩段時才補
  const groups = plate.match(/[A-Z]+|\d+/g) ?? [];
  return groups.length === 2 ? groups.join('-') : plate;
}

/** 選項的其他說法 */
const OPTION_ALIASES: Record<string, string[]> = {
  汽車: ['轎車', '小客車', '小汽車'],
  機車: ['摩托車', '重機', '速克達'],
  地政事務所: ['地政'],
  戶政事務所: ['戶政', '戶籍'],
  區公所: ['公所'],
  稅捐處: ['稅捐', '繳稅'],
  就業服務站: ['就業', '找工作'],
  悠遊付: ['悠遊卡', '悠遊'],
  台北富邦信用卡: ['信用卡', '富邦', '刷卡'],
  智慧支付平台: ['智慧支付'],
};

/** 這個位置前面緊接著否定詞，例如「不是汽車」的「汽車」 */
function isNegated(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[\s，,、。]/g, '');
  return /(不是|不要|不|沒有)$/.test(before);
}

/**
 * 從一句話挑出選項。前面有否定詞的不算，剩下的取最後說的那個，
 * 例如「不是汽車，是機車」「機車，不是汽車」都是「機車」。
 */
export function matchOption(options: string[], text: string): string | null {
  let best: string | null = null;
  let bestIndex = -1;
  for (const option of options) {
    for (const word of [option, ...(OPTION_ALIASES[option] ?? [])]) {
      for (let index = text.indexOf(word); index >= 0; index = text.indexOf(word, index + 1)) {
        if (index > bestIndex && !isNegated(text, index)) {
          best = option;
          bestIndex = index;
        }
      }
    }
  }
  return best;
}

// 查書時的前後綴。只放多字的說法：單字（「查」「書」）會切到書名，例如「查理與巧克力工廠」。
const KEYWORD_PREFIXES = [
  '我想要找', '我想要借', '我要找', '我想找', '幫我找', '幫我查', '我要借', '我想借', '我要查', '我想查',
  '幫我搜尋', '搜尋一下', '找一下', '查一下', '圖書館', '有沒有', '我想要', '我要', '我想', '幫我', '請', '麻煩',
];
const KEYWORD_SUFFIXES = ['寫的書', '的書', '這本書', '那本書', '的作品', '的小說', '寫的', '嗎', '呢', '吧', '啊'];

/** 只剩這些字表示沒說書名，例如「我要找書」 */
const NOT_A_KEYWORD = /^(一本|本)?書$/;

/** 書名或作者：「我要找東野圭吾的書」→「東野圭吾」。沒說書名回傳 null */
export function extractKeyword(text: string): string | null {
  const original = text.replace(/[。？?！!，,\s]+$/g, '').trim();
  let keyword = original;
  for (let changed = true; changed; ) {
    changed = false;
    keyword = keyword.replace(/^[，,、\s]+|[，,、\s]+$/g, '');
    for (const prefix of KEYWORD_PREFIXES) {
      if (keyword.startsWith(prefix) && keyword.length > prefix.length) {
        keyword = keyword.slice(prefix.length);
        changed = true;
      }
    }
    for (const suffix of KEYWORD_SUFFIXES) {
      if (keyword.endsWith(suffix) && keyword.length > suffix.length) {
        keyword = keyword.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  if (!keyword || NOT_A_KEYWORD.test(keyword)) return null;
  return keyword;
}

/** 把一個欄位的值轉成腳本要的格式；不合格回傳 null */
export function normalizeSlot(script: TaskScript, key: string, value: string): string | null {
  const spec = script.slots[key];
  if (!spec) return null;
  if (spec.options) return matchOption(spec.options, value);

  const normalized =
    key === 'plate' ? normalizePlate(value) : key === 'keyword' ? extractKeyword(value) : value.trim() || null;
  if (!normalized) return null;
  return spec.pattern && !new RegExp(spec.pattern).test(normalized) ? null : normalized;
}

/**
 * 從一整句話找出車號：「幫我查停車費，車號 ABC 123」→「ABC-123」。
 * 先把中文數字、全形轉掉、拿掉空白（「A B C 杠 一 二 三」），再找「字母和數字混合」的一段。
 * 只回傳通過 pattern 的；找不到回傳 null，之後再問使用者。
 */
export function findPlate(text: string, pattern?: string): string | null {
  const flat = text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[零〇洞一幺么二兩两三四五六七八九]/g, (char) => CHINESE_DIGITS[char])
    .replace(/\s+/g, '')
    .replace(SEPARATOR, '-');
  for (const candidate of flat.match(/[A-Z0-9]+(?:-[A-Z0-9]+)?/g) ?? []) {
    if (!/[A-Z]/.test(candidate) || !/\d/.test(candidate)) continue;
    const plate = normalizePlate(candidate);
    if (plate && (!pattern || new RegExp(pattern).test(plate))) return plate;
  }
  return null;
}

/** 查書的關鍵字裡不該有這些字；有的話表示沒抽乾淨（「在圖書館查書」），之後再問使用者 */
const NOT_A_BOOK = /圖書館|書|借|找|查/;

/** 不用 LLM，從句子裡抽出腳本要的資料：選項（汽車／機車）、車號、書名 */
export function slotsFromText(script: TaskScript, text: string): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const [key, spec] of Object.entries(script.slots)) {
    let value: string | null = null;
    if (spec.options) value = matchOption(spec.options, text);
    else if (key === 'plate') value = findPlate(text, spec.pattern);
    else if (key === 'keyword') {
      const keyword = extractKeyword(text);
      value = keyword && !NOT_A_BOOK.test(keyword) ? keyword : null;
    }
    if (value) slots[key] = value;
  }
  return slots;
}
