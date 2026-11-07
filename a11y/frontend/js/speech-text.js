// 念出來之前先整理文字（畫面上顯示的仍是官方原文）：
// - 網址念出來沒有意義，拿掉
// - 電話號碼、分機一個數字一個數字念：「1999」念「一九九九」，不念「一千九百九十九」
// - 每一行開頭的編號「1.」「(1)」「(一)」改成「1，」，不會念成「一點」或「括號」
// - 「※」拿掉（官方答案多半寫成「※提醒您…」，不用再念一次「提醒」）
// - 沒有標點結尾的行補句號，讓語音停頓

const LIST_MARKER = /^[（(]?(\d+|[一二三四五六七八九十]+)[)）.、．]\s*/;

export function speechText(text) {
  return String(text ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\d(?:-?\d){3,}/g, (digits) => digits.replace(/-/g, '').split('').join(' '))
    .replace(/[~～]/g, '到')
    .replace(/※\s*/g, '')
    .split('\n')
    .map((line) => line.trim().replace(LIST_MARKER, '$1，'))
    .filter(Boolean)
    .map((line) => (/[。！？：，；:]$/.test(line) ? line : `${line}。`))
    .join(' ');
}
