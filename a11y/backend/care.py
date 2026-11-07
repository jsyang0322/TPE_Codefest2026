"""功能 B：讓家人幫忙——數字碼與 QR code、授權、停止分享（規格第二部分第 5.3、5.4、8.5 節）。

流程：
1. 被照顧者產生 6 位數字碼與 QR code（5 分鐘有效、只能用一次）
2. 照顧者輸入數字碼或掃描 QR code → 被照顧者手機問「王小美 想看你的畫面、幫你操作，同意嗎？」→ 同意後授權生效
3. 被照顧者開始分享畫面（share.py）：之後在台北通打開的服務網頁，照顧者都看得到，也能遠端點按、填寫
4. 授權在被照顧者「這一次登入」期間有效：停止分享、登出、登入逾時都會立即結束
"""

import re
import secrets
import uuid
from datetime import timedelta

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from . import auth, config, consent, share, store, templates
from .errors import ApiError
from .ws import hub

router = APIRouter(prefix="/api/care", tags=["care"])

OPEN_LINK = ("pending", "active")


def _name(user_id: str) -> str:
    return store.USERS[user_id]


def _qr_svg(text: str) -> str:
    """後端產生 QR code 的 SVG，網頁不需要另外載入套件。寬高交給 CSS 控制。"""
    image = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    svg = image.to_string(encoding="unicode")
    return re.sub(r'\s(width|height)="[^"]*mm"', "", svg, count=2)


def link_view(link: store.CareLink, viewer_id: str) -> dict:
    """給網頁的授權資料，包含目前的分享狀態（重新整理時用來還原）。"""
    return {
        "link_id": link.id,
        "status": link.status,
        "elder": auth.user_view(link.elder_id),
        "caregiver": auth.user_view(link.caregiver_id),
        "created_at": store.iso(link.created_at),
        "share": share.share_view(link) if link.status == "active" else None,
    }


def _link_for(link_id: str, user_id: str, *, as_elder: bool | None = None) -> store.CareLink:
    link = store.state.links.get(link_id)
    if link is None or user_id not in (link.elder_id, link.caregiver_id):
        raise ApiError(404, "link_not_found", "找不到這個授權")
    if as_elder is True and link.elder_id != user_id:
        raise ApiError(403, "elder_only", "只有被照顧者本人可以做這件事")
    if as_elder is False and link.caregiver_id != user_id:
        raise ApiError(403, "caregiver_only", "只有照顧者可以做這件事")
    return link


# ---- 1. 數字碼與 QR code ----

def _new_code() -> str:
    while True:
        code = f"{secrets.randbelow(10**6):06d}"
        if code not in store.state.bind_codes:
            return code


@router.post("/bind-codes")
async def create_bind_code(request: Request, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """產生新的數字碼；同一位被照顧者的舊碼立即失效。"""
    state = store.state
    for code, bind_code in list(state.bind_codes.items()):
        if bind_code.elder_id == session.user_id:
            del state.bind_codes[code]

    code = _new_code()
    expires_at = store.now() + timedelta(seconds=config.BIND_CODE_TTL_SECONDS)
    state.bind_codes[code] = store.BindCode(code, session.user_id, session.token, expires_at)

    # QR code 內容是照顧者頁的網址：用台北通掃描或手機相機掃描都能直接打開並帶入數字碼
    url = f"{str(request.base_url).rstrip('/')}/caregiver.html?code={code}"
    return {
        "code": code,
        "qr_svg": _qr_svg(url),
        "qr_text": url,
        "expires_at": store.iso(expires_at),
        "ttl_seconds": config.BIND_CODE_TTL_SECONDS,
        "speak": templates.bind_code_speak(code),
    }


@router.delete("/bind-codes")
async def cancel_bind_codes(session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """被照顧者離開數字碼畫面時，作廢還沒用的數字碼。"""
    state = store.state
    for code, bind_code in list(state.bind_codes.items()):
        if bind_code.elder_id == session.user_id:
            del state.bind_codes[code]
    return {"ok": True}


# ---- 2. 授權 ----

def _check_failures(user_id: str) -> None:
    """同一人短時間內輸入錯誤太多次就先擋下，防止亂猜 6 位數。"""
    since = store.now() - timedelta(seconds=config.BIND_CODE_LOCK_SECONDS)
    recent = [t for t in store.state.code_failures.get(user_id, []) if t > since]
    store.state.code_failures[user_id] = recent
    if len(recent) >= config.BIND_CODE_MAX_FAILURES:
        raise ApiError(429, "too_many_attempts", "輸入錯誤太多次，請等 1 分鐘再試")


class LinkCreate(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/links")
async def create_link(body: LinkCreate, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """照顧者輸入數字碼，建立等待同意的授權，並請被照顧者確認。"""
    state = store.state
    _check_failures(session.user_id)

    bind_code = state.bind_codes.get(body.code)
    if bind_code is None or store.now() >= bind_code.expires_at:
        state.code_failures.setdefault(session.user_id, []).append(store.now())
        raise ApiError(400, "bind_code_invalid", "數字碼不正確或已經過期，請對方重新產生")
    if bind_code.elder_id == session.user_id:
        raise ApiError(400, "bind_self", "不能授權給自己")
    elder_session = state.sessions.get(bind_code.elder_token)
    if elder_session is None or elder_session.ended_at is not None:
        raise ApiError(400, "bind_code_invalid", "對方已經登出，請對方重新產生數字碼")

    del state.bind_codes[body.code]  # 每組只能用一次
    now = store.now()
    link = store.CareLink(
        id=str(uuid.uuid4()),
        elder_id=bind_code.elder_id,
        caregiver_id=session.user_id,
        elder_token=bind_code.elder_token,
        status="pending",
        created_at=now,
        confirm_expires_at=now + timedelta(seconds=config.LINK_CONFIRM_TTL_SECONDS),
    )
    state.links[link.id] = link
    store.audit(link.id, session.user_id, "link_requested")

    caregiver_name = _name(session.user_id)
    await hub.send(link.elder_id, "link_confirm_requested", {
        "link_id": link.id,
        "caregiver_name": caregiver_name,
        "speak": templates.link_confirm(caregiver_name),
        "ttl_seconds": config.LINK_CONFIRM_TTL_SECONDS,
    })
    return link_view(link, session.user_id)


class LinkConfirm(BaseModel):
    accept: bool | None = None
    transcript: str | None = Field(default=None, max_length=100)


@router.post("/links/{link_id}/confirm")
async def confirm_link(link_id: str, body: LinkConfirm, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """被照顧者同意或拒絕。可以按按鈕（accept），也可以送語音辨識文字（transcript）由後端判斷。"""
    link = _link_for(link_id, session.user_id, as_elder=True)
    if link.status != "pending":
        raise ApiError(409, "link_not_pending", "這個授權請求已經結束了")

    if body.transcript is not None:
        result = consent.parse_consent(body.transcript, None)
        if result in ("repeat", "unknown"):
            speak = templates.link_confirm(_name(link.caregiver_id))
            return {"result": result, "speak": speak if result == "repeat" else "沒有聽清楚。" + speak}
        accept = result == "accept"
    else:
        accept = bool(body.accept)

    now = store.now()
    caregiver_name, elder_name = _name(link.caregiver_id), _name(link.elder_id)
    if accept:
        # 同一位家人重新綁定：新的授權取代舊的，名單上不會出現兩筆
        for old in list(store.state.links.values()):
            if (old.id != link.id and old.status in OPEN_LINK
                    and (old.elder_id, old.caregiver_id) == (link.elder_id, link.caregiver_id)):
                await close_link(old, "replaced", session.user_id)
        link.status, link.activated_at = "active", now
        store.audit(link.id, session.user_id, "link_activated", method="voice" if body.transcript else "tap")
        await hub.send(link.caregiver_id, "link_activated", {
            "link_id": link.id, "speak": templates.link_activated(elder_name, for_elder=False),
        })
        speak = templates.link_activated(caregiver_name, for_elder=True)
        return {"result": "accept", "speak": speak, "link": link_view(link, session.user_id)}

    link.status, link.closed_at = "rejected", now
    store.audit(link.id, session.user_id, "link_rejected", method="voice" if body.transcript else "tap")
    await hub.send(link.caregiver_id, "link_closed", {
        "link_id": link.id, "reason": "rejected", "speak": templates.link_closed(elder_name, "rejected"),
    })
    return {"result": "reject", "speak": "好的，沒有授權。"}


@router.get("/links")
async def list_links(session: store.LoginSession = Depends(auth.current_session)) -> dict:
    links = [
        link_view(link, session.user_id)
        for link in store.state.links.values()
        if link.status in OPEN_LINK and session.user_id in (link.elder_id, link.caregiver_id)
    ]
    return {"links": links}


@router.delete("/links/{link_id}")
async def revoke_link(link_id: str, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """被照顧者停止分享（終止授權），立即生效。"""
    link = _link_for(link_id, session.user_id, as_elder=True)
    if link.status not in OPEN_LINK:
        raise ApiError(409, "link_closed", "授權已經結束了")
    await close_link(link, "revoked", session.user_id)
    return {"ok": True, "speak": f"已停止分享，{_name(link.caregiver_id)} 看不到你的畫面了。"}


@router.get("/links/{link_id}/audit")
async def link_audit(link_id: str, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """操作紀錄：誰、什麼時候、做了什麼。"""
    link = _link_for(link_id, session.user_id, as_elder=True)
    entries = [e for e in store.state.audit if e.link_id == link.id]
    return {"entries": [
        {"at": store.iso(e.created_at), "actor": _name(e.actor_id), "action": e.action, "method": e.method}
        for e in entries
    ]}


# ---- 3. 結束授權 ----

async def close_link(link: store.CareLink, status: str, actor_id: str) -> None:
    """終止授權、登出、登入逾時都走這裡（規格第二部分第 8.5 節）。"""
    link.status = status
    link.closed_at = store.now()
    await share.close_share(link)  # 被照顧者手機上的分享程式立即停止
    store.audit(link.id, actor_id, f"link_closed:{status}")

    data = {"link_id": link.id, "reason": status, "speak": templates.link_closed(_name(link.elder_id), status)}
    await hub.send(link.caregiver_id, "link_closed", data)
    await hub.send(link.elder_id, "link_closed", {**data, "speak": None})


async def close_links_for_session(elder_token: str, status: str) -> None:
    for link in list(store.state.links.values()):
        if link.elder_token == elder_token and link.status in OPEN_LINK:
            await close_link(link, status, link.elder_id)


# ---- 背景工作 ----

async def expire_bind_codes() -> None:
    state = store.state
    for code, bind_code in list(state.bind_codes.items()):
        if store.now() >= bind_code.expires_at:
            del state.bind_codes[code]


async def expire_pending_links() -> None:
    """照顧者輸入數字碼後，被照顧者一直沒回應：視為沒有授權。"""
    for link in list(store.state.links.values()):
        if link.status == "pending" and store.now() >= link.confirm_expires_at:
            link.status, link.closed_at = "expired", store.now()
            store.audit(link.id, link.elder_id, "link_confirm_expired")
            await hub.send(link.caregiver_id, "link_closed", {
                "link_id": link.id, "reason": "confirm_expired",
                "speak": templates.link_closed(_name(link.elder_id), "confirm_expired"),
            })
            await hub.send(link.elder_id, "link_closed", {"link_id": link.id, "reason": "confirm_expired", "speak": None})
