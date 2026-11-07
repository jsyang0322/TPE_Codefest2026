"""讓家人幫忙時，被照顧者與照顧者會看到、聽到的固定句子。

一律由後端產生：照顧者不能自訂被照顧者聽到的話，也不使用 AI。
（分享畫面時，「王小美 按了『下一步』」這類句子由被照顧者手機上的分享程式產生，
按鈕名稱取自被照顧者自己的畫面，照顧者同樣無法自訂。）
"""


def bind_code_speak(code: str) -> str:
    digits = "、".join(code)
    return f"你的數字是 {digits}。請把這組數字告訴家人，5 分鐘內有效。"


def link_confirm(caregiver: str) -> str:
    return f"{caregiver} 想看你的畫面、幫你操作，同意嗎？同意請說「同意」，不同意請說「不同意」。"


def link_activated(other: str, *, for_elder: bool) -> str:
    if for_elder:
        return f"已同意。{other} 現在可以看你的畫面、幫你操作了。要停止，請說「停止分享」。"
    return f"{other} 已同意，可以看他的畫面了。"


def link_closed(elder: str, reason: str) -> str:
    return {
        "revoked": f"{elder} 已停止分享。",
        "ended": f"{elder} 已登出，分享已結束。",
        "expired": f"{elder} 的登入已逾時，分享已結束。",
        "rejected": f"{elder} 沒有同意。",
        "confirm_expired": f"{elder} 沒有在時間內同意，請重新取得數字碼。",
        "replaced": f"已換成和 {elder} 的新授權。",
    }.get(reason, "分享已結束。")


def share_waiting(elder: str) -> str:
    return f"還看不到 {elder} 的畫面。請他打開台北通的「無障礙輔助」，畫面就會出現。"


def elder_not_on_page(elder: str) -> str:
    return f"還看不到 {elder} 的畫面，沒辦法操作。"
