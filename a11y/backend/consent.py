"""同意：判斷語音回答、產生確認數字、伺服器端確認（規格第二部分第 5.5、8.2、8.3 節）。

付款這類操作在真正執行前，伺服器自己再檢查三件事，不只靠畫面擋住：
1. 真的有同意過嗎？
2. 同意的內容和送出的內容一樣嗎？（比對 payload 的雜湊值，像簽在寫好金額的支票上）
3. 這個同意用過了嗎？（每次同意只能用一次，60 秒後失效）
"""

import hashlib
import json
import re
import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import auth, config, store, templates
from .errors import ApiError
from .ws import hub

router = APIRouter(prefix="/api/consent", tags=["consent"])

# ---- 判斷語音回答 ----

ZH = {"零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
REPEAT = ["再說一次", "再講一次", "再唸一次", "沒聽清楚", "聽不清楚"]
# 「不同意」裡有「同意」，所以一定先檢查拒絕；判斷不出來一律當作沒聽懂，不會當作同意
REJECT = ["不同意", "不要", "不行", "不好", "取消", "等一下", "不"]
ACCEPT = ["同意", "好", "可以", "對", "沒問題"]


def zh_to_digits(text: str) -> str:
    """把「四十七」「四七」都轉成「47」。"""

    def tens(match: re.Match) -> str:
        a, b = match.group(1), match.group(2)
        return str((ZH[a] if a else 1) * 10 + (ZH[b] if b else 0))

    text = re.sub(r"([一二兩三四五六七八九])?十([一二三四五六七八九])?", tens, text)
    return "".join(str(ZH[c]) if c in ZH else c for c in text)


def parse_consent(transcript: str, voice_code: str | None) -> str:
    """回傳 accept / reject / repeat / unknown。voice_code 為 None 時是 L1（只要說「同意」）。"""
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


def new_voice_code() -> str:
    """21～98 之間、不是 10 的倍數的兩位數：念起來清楚，也不容易和「十」「一百」混淆。"""
    while True:
        n = 21 + secrets.randbelow(78)
        if n % 10 != 0:
            return str(n)


def payload_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---- 伺服器端確認 ----

def verify_consent_token(token: str | None, link_id: str, action_type: str, payload: dict) -> store.ConsentRequest:
    state = store.state
    t = state.consent_tokens.get(token or "")
    if t is None or t.voided or t.used_at is not None or store.now() >= t.expires_at:
        raise ApiError(403, "consent_invalid", "同意已失效，請重新請求")
    consent = state.consents[t.consent_id]
    if consent.status != "approved" or consent.link_id != link_id or consent.action_type != action_type:
        raise ApiError(403, "consent_mismatch", "同意內容不符")
    if consent.payload_hash != payload_hash(payload):
        raise ApiError(403, "consent_payload_mismatch", "操作內容與同意時不同，已拒絕執行")
    if state.links[link_id].status != "active":
        raise ApiError(403, "link_closed", "授權已結束")
    t.used_at = store.now()  # 只能使用一次
    return consent


# ---- 同意請求 ----

class ParkingPayload(BaseModel):
    plate: str = Field(pattern=r"^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$")
    amount: int = Field(ge=1, le=100000)


class ConsentCreate(BaseModel):
    session_id: str
    action_type: str
    payload: dict


def _validated_payload(action_type: str, payload: dict) -> dict:
    if action_type == "pay_parking":
        try:
            return ParkingPayload(**payload).model_dump()
        except Exception:
            raise ApiError(400, "invalid_payload", "車牌或金額格式不正確")
    raise ApiError(400, "unknown_action", "不支援這個操作")


@router.post("/requests")
async def create_request(body: ConsentCreate, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """照顧者請被照顧者同意。等級由後端依操作決定，照顧者不能自己降級。"""
    state = store.state
    if body.action_type in templates.FORBIDDEN_ACTIONS:
        raise ApiError(403, "forbidden_for_caregiver", "這個操作只有本人能做")
    if body.action_type not in templates.CONSENT_ACTIONS:
        raise ApiError(400, "unknown_action", "不支援這個操作")

    care_session = state.care_sessions.get(body.session_id)
    link = state.links.get(care_session.link_id) if care_session else None
    if not care_session or care_session.ended_at or not link or link.caregiver_id != session.user_id:
        raise ApiError(403, "not_your_session", "目前沒有在代操作")
    if link.status != "active":
        raise ApiError(403, "link_closed", "授權已結束")

    payload = _validated_payload(body.action_type, body.payload)
    level = templates.CONSENT_ACTIONS[body.action_type]["level"]

    # 同一次代操作只保留一個等待中的同意請求
    for old in state.consents.values():
        if old.session_id == care_session.id and old.status == "pending":
            await _cancel(old, "replaced")

    caregiver_name = store.USERS[link.caregiver_id]
    summary = templates.consent_summary(body.action_type, caregiver_name, payload)
    voice_code = new_voice_code() if level == "L2" else None
    now = store.now()
    consent = store.ConsentRequest(
        id=str(uuid.uuid4()),
        link_id=link.id,
        session_id=care_session.id,
        level=level,
        action_type=body.action_type,
        payload=payload,
        payload_hash=payload_hash(payload),
        summary=summary,
        prompt_text=templates.consent_prompt(summary, level, voice_code),
        voice_code=voice_code,
        created_at=now,
        expires_at=now + timedelta(seconds=config.CONSENT_TTL_SECONDS),
    )
    state.consents[consent.id] = consent
    store.audit(link.id, session.user_id, f"consent_requested:{body.action_type}", level, consent_id=consent.id)

    await hub.send(link.elder_id, "consent_requested", elder_view(consent))
    # 回給照顧者的內容不含確認數字：只有聽完內容的被照顧者才知道
    return {
        "consent_id": consent.id,
        "level": level,
        "summary": summary,
        "expires_at": store.iso(consent.expires_at),
        "ttl_seconds": config.CONSENT_TTL_SECONDS,
        "elder_name": store.USERS[link.elder_id],
    }


def elder_view(consent: store.ConsentRequest) -> dict:
    """推給被照顧者的同意請求（含確認數字）。"""
    remaining = max(0, int((consent.expires_at - store.now()).total_seconds()))
    return {
        "consent_id": consent.id,
        "level": consent.level,
        "action_type": consent.action_type,
        "summary": consent.summary,
        "prompt_text": consent.prompt_text,
        "voice_code": consent.voice_code,
        "payload": consent.payload,
        "expires_at": store.iso(consent.expires_at),
        "ttl_seconds": remaining,
    }


class ConsentResponse(BaseModel):
    method: str = Field(pattern="^(tap|voice)$")
    accept: bool | None = None
    step: str | None = Field(default=None, pattern="^(first|final)$")
    transcript: str | None = Field(default=None, max_length=100)


@router.post("/requests/{consent_id}/respond")
async def respond(consent_id: str, body: ConsentResponse, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    state = store.state
    consent = state.consents.get(consent_id)
    link = state.links.get(consent.link_id) if consent else None
    if not consent or not link or link.elder_id != session.user_id:
        raise ApiError(404, "consent_not_found", "找不到這個同意請求")
    if consent.status != "pending" or store.now() >= consent.expires_at:
        raise ApiError(409, "consent_closed", "這個請求已經結束了")

    if body.method == "tap":
        if not body.accept:
            await _resolve(consent, "rejected", "tap")
            return {"result": "reject", "speak": templates.consent_result("rejected", for_elder=True)}
        if consent.level == "L2":
            if body.step == "first":
                consent.tap_confirmed = True
                return {"result": "confirm_again", "speak": templates.tap_confirm_again(consent.summary)}
            if body.step != "final" or not consent.tap_confirmed:
                raise ApiError(400, "confirm_twice", "請先按一次同意，再按一次確認")
        await _resolve(consent, "approved", "tap")
        return {"result": "accept", "speak": templates.consent_result("approved", for_elder=True)}

    # 語音
    result = parse_consent(body.transcript or "", consent.voice_code)
    if result == "repeat":
        return {"result": "repeat", "speak": consent.prompt_text}
    if result == "unknown":
        consent.voice_attempts += 1
        if consent.voice_attempts >= config.CONSENT_MAX_VOICE_ATTEMPTS:
            await _resolve(consent, "rejected", "voice", detail="voice_attempts_exceeded")
            return {"result": "reject", "speak": "沒有聽清楚，已取消。如果要同意，請按畫面上的按鈕。"}
        return {"result": "unknown", "speak": templates.consent_unknown(consent.level, consent.voice_code)}
    if result == "reject":
        await _resolve(consent, "rejected", "voice")
        return {"result": "reject", "speak": templates.consent_result("rejected", for_elder=True)}
    await _resolve(consent, "approved", "voice")
    return {"result": "accept", "speak": templates.consent_result("approved", for_elder=True)}


async def _resolve(consent: store.ConsentRequest, result: str, method: str | None, detail: str | None = None) -> None:
    state = store.state
    link = state.links[consent.link_id]
    consent.status = result
    consent.method = method
    consent.responded_at = store.now()
    data = {
        "consent_id": consent.id,
        "result": result,
        "speak": templates.consent_result(result, for_elder=False, elder=store.USERS[link.elder_id]),
    }
    if result == "approved":
        token = store.ConsentToken(
            token=secrets.token_urlsafe(24),
            consent_id=consent.id,
            expires_at=store.now() + timedelta(seconds=config.CONSENT_TOKEN_TTL_SECONDS),
        )
        state.consent_tokens[token.token] = token
        data["consent_token"] = token.token
    store.audit(link.id, link.elder_id, f"consent_{result}", consent.level, consent_id=consent.id, method=method, detail=detail)
    await hub.send(link.caregiver_id, "consent_resolved", data)


async def _cancel(consent: store.ConsentRequest, reason: str) -> None:
    link = store.state.links[consent.link_id]
    consent.status = "cancelled"
    consent.responded_at = store.now()
    await hub.send(link.elder_id, "consent_cancelled", {"consent_id": consent.id, "reason": reason, "speak": "同意請求已取消。"})


async def cancel_for_link(link_id: str) -> None:
    """授權結束時：取消等待中的同意、作廢還沒用的 token。"""
    state = store.state
    for consent in state.consents.values():
        if consent.link_id == link_id and consent.status == "pending":
            await _cancel(consent, "link_closed")
    for token in state.consent_tokens.values():
        if token.used_at is None and state.consents[token.consent_id].link_id == link_id:
            token.voided = True


def pending_for_link(link_id: str) -> store.ConsentRequest | None:
    for consent in store.state.consents.values():
        if consent.link_id == link_id and consent.status == "pending" and store.now() < consent.expires_at:
            return consent
    return None


async def expire_requests() -> None:
    """背景工作：超過時間沒有回應的同意請求視為不同意，通知雙方。"""
    for consent in list(store.state.consents.values()):
        if consent.status == "pending" and store.now() >= consent.expires_at:
            link = store.state.links[consent.link_id]
            await _resolve(consent, "expired", None)
            await hub.send(link.elder_id, "consent_cancelled", {
                "consent_id": consent.id,
                "reason": "expired",
                "speak": templates.consent_result("expired", for_elder=True),
            })
