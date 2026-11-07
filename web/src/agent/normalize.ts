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
};

/**
 * 從一句話挑出選項。說了好幾個時取最後說的那個，
 * 例如「不是汽車，是機車」→「機車」。
 */
export function matchOption(options: string[], text: string): string | null {
  let best: string | null = null;
  let bestIndex = -1;
  for (const option of options) {
    for (const word of [option, ...(OPTION_ALIASES[option] ?? [])]) {
      const index = text.lastIndexOf(word);
      if (index > bestIndex) {
        best = option;
        bestIndex = index;
      }
    }
  }
  return best;
}

/** 把一個欄位的值轉成腳本要的格式；不合格回傳 null */
export function normalizeSlot(script: TaskScript, key: string, value: string): string | null {
  const spec = script.slots[key];
  if (!spec) return null;
  if (spec.options) return matchOption(spec.options, value);

  const normalized = key === 'plate' ? normalizePlate(value) : value.trim() || null;
  if (!normalized) return null;
  return spec.pattern && !new RegExp(spec.pattern).test(normalized) ? null : normalized;
}
