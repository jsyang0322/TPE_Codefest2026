"""demo 用的登入、登出、登入逾時（規格第二部分第 5.1 節）。

台北通正式的身分驗證不對外開放，所以 demo 用兩個假帳號（王阿伯、王小美）選一個登入。
登入 token 由 secrets 產生，網頁存在 sessionStorage：同一台電腦開兩個分頁就能模擬兩支手機。
"""

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel

from . import config, store
from .errors import ApiError

router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_view(user_id: str) -> dict:
    return {"id": user_id, "name": store.USERS[user_id]}


async def current_session(authorization: str | None = Header(default=None)) -> store.LoginSession:
    """所有需要登入的 API 都帶 Authorization: Bearer <token>。"""
    token = (authorization or "").removeprefix("Bearer ").strip()
    session = store.state.sessions.get(token)
    if session is None or session.ended_at is not None:
        raise ApiError(401, "not_logged_in", "請重新登入")
    session.last_seen_at = store.now()
    return session


class LoginBody(BaseModel):
    user_id: str


@router.post("/login")
async def login(body: LoginBody) -> dict:
    if body.user_id not in store.USERS:
        raise ApiError(404, "user_not_found", "找不到這個帳號")
    now = store.now()
    session = store.LoginSession(token=secrets.token_urlsafe(24), user_id=body.user_id, created_at=now, last_seen_at=now)
    store.state.sessions[session.token] = session
    return {"token": session.token, "user": user_view(body.user_id)}


@router.post("/logout")
async def logout(session: store.LoginSession = Depends(current_session)) -> dict:
    await end_login(session, "logout")
    return {"ok": True}


@router.get("/me")
async def me(session: store.LoginSession = Depends(current_session)) -> dict:
    return {"user": user_view(session.user_id)}


async def end_login(session: store.LoginSession, reason: str) -> None:
    """登出或逾時：這次登入下的授權一起結束（規格第一部分第 4.2 節）。"""
    from . import care  # care 也 import auth，放在這裡避免循環 import
    from .ws import hub

    session.ended_at = store.now()
    session.end_reason = reason
    await care.close_links_for_session(session.token, "ended" if reason == "logout" else "expired")
    await hub.close_token(session.user_id, session.token)


async def expire_idle_logins() -> None:
    """背景工作：閒置太久的登入自動登出。頁面開著時 WebSocket 會一直 ping，不算閒置。"""
    limit = store.now() - timedelta(minutes=config.LOGIN_IDLE_MINUTES)
    for session in list(store.state.sessions.values()):
        if session.ended_at is None and session.last_seen_at < limit:
            await end_login(session, "idle_timeout")
