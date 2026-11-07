"""判斷被照顧者用說的回答：同意、不同意、再說一次，或沒聽懂。

只用固定的詞判斷，不使用 AI。判斷不出來一律當作沒聽懂，不會當作同意。
"""

import re

ZH = {"零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
REPEAT = ["再說一次", "再講一次", "再唸一次", "沒聽清楚", "聽不清楚"]
# 「不同意」裡有「同意」，所以一定先檢查拒絕
REJECT = ["不同意", "不要", "不行", "不好", "取消", "等一下", "不"]
ACCEPT = ["同意", "好", "可以", "對", "沒問題"]


def zh_to_digits(text: str) -> str:
    """把「四十七」「四七」都轉成「47」。"""

    def tens(match: re.Match) -> str:
        a, b = match.group(1), match.group(2)
        return str((ZH[a] if a else 1) * 10 + (ZH[b] if b else 0))

    text = re.sub(r"([一二兩三四五六七八九])?十([一二三四五六七八九])?", tens, text)
    return "".join(str(ZH[c]) if c in ZH else c for c in text)


def parse_consent(transcript: str, voice_code: str | None = None) -> str:
    """回傳 accept / reject / repeat / unknown。給 voice_code 時，還要說出這個數字才算同意。"""
    t = re.sub(r"[，。！？、,.!?\s]", "", transcript)
    if any(w in t for w in REPEAT):
        return "repeat"
    if any(w in t for w in REJECT):
        return "reject"
    if not any(w in t for w in ACCEPT):
        return "unknown"
    if voice_code is None:
        return "accept"
    return "accept" if voice_code in zh_to_digits(t) else "unknown"
