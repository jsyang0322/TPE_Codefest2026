"""照顧者代操作時，被照顧者會看到、聽到的固定句子。

一律由後端依實際資料產生（規格第二部分第 3.2 節第 2 點）：照顧者不能自訂被照顧者聽到的話，
也不使用 AI。被照顧者「聽到的」和後端「實際執行的」一定是同一份資料。
"""

# 每種代操作的步驟名稱
STEPS = {
    "pay_parking": {1: "開啟繳停車費頁面", 2: "填寫車牌", 3: "確認金額"},
}

# 需要同意的操作：等級與摘要
CONSENT_ACTIONS = {
    "pay_parking": {"level": "L2", "summary": "{caregiver} 要幫你繳停車費，金額 {amount} 元，車牌 {plate}。"},
}

# 照顧者一律不能做的操作（L3，規格第一部分第 4.4 節）
FORBIDDEN_ACTIONS = {"change_password", "change_login_method", "add_caregiver", "change_authorization", "delete_account"}


def bind_code_speak(code: str) -> str:
    digits = "、".join(code)
    return f"你的數字是 {digits}。請把這組數字告訴家人，5 分鐘內有效。"


def link_confirm(caregiver: str) -> str:
    return f"{caregiver} 要幫你操作，同意嗎？同意請說「同意」，不同意請說「不同意」。"


def link_activated(other: str, *, for_elder: bool) -> str:
    return f"已同意，{other} 現在可以幫你操作。" if for_elder else f"{other} 已同意，你可以開始幫忙操作。"


def link_closed(elder: str, reason: str) -> str:
    return {
        "revoked": f"{elder} 已停止授權。",
        "ended": f"{elder} 已登出，授權已結束。",
        "expired": f"{elder} 的登入已逾時，授權已結束。",
        "rejected": f"{elder} 沒有同意授權。",
        "confirm_expired": f"{elder} 沒有在時間內同意，請重新取得數字碼。",
        "replaced": f"已換成和 {elder} 的新授權。",
    }.get(reason, "授權已結束。")


def session_started(caregiver: str) -> str:
    return f"{caregiver} 開始幫你操作。你隨時可以說「停止授權」或「我自己來」。"


def session_ended(other: str, reason: str, *, for_elder: bool) -> str:
    if reason == "elder_takeover":
        return "好的，換你自己操作。" if for_elder else f"{other} 說要自己來，已結束代操作。"
    if reason == "idle_timeout":
        return "太久沒有操作，已結束代操作。"
    return f"{other} 已結束代操作。" if for_elder else "已結束代操作。"


def step_speak(caregiver: str, action_type: str, step: int, fields: dict) -> str:
    text = f"{caregiver} 正在幫你{STEPS[action_type][step]}"
    if action_type == "pay_parking" and step == 3 and fields.get("amount") is not None:
        text += f"，金額 {fields['amount']} 元"
    return text + "。"


def consent_summary(action_type: str, caregiver: str, payload: dict) -> str:
    return CONSENT_ACTIONS[action_type]["summary"].format(caregiver=caregiver, **payload)


def consent_prompt(summary: str, level: str, voice_code: str | None) -> str:
    if level == "L2":
        return f"{summary}如果同意，請說「同意」，再說數字 {voice_code}。如果不同意，請說「不同意」。"
    return f"{summary}如果同意，請說「同意」。如果不同意，請說「不同意」。"


def consent_unknown(level: str, voice_code: str | None) -> str:
    if level == "L2":
        return f"沒有聽清楚。同意請說「同意」，再說數字 {voice_code}；不同意請說「不同意」。"
    return "沒有聽清楚。同意請說「同意」，不同意請說「不同意」。"


def tap_confirm_again(summary: str) -> str:
    return f"你選擇同意。{summary}請再按一次「確認同意」。"


def consent_result(result: str, *, for_elder: bool, elder: str = "") -> str:
    if for_elder:
        return {"approved": "已同意，正在幫你處理。", "rejected": "已拒絕，不會執行。", "expired": "已經超過時間，已取消。"}[result]
    return {"approved": f"{elder} 已同意。", "rejected": f"{elder} 不同意，已取消。", "expired": f"{elder} 沒有在時間內回應，已取消。"}[result]


def paid(amount: int) -> str:
    return f"已幫你繳停車費 {amount} 元。"
