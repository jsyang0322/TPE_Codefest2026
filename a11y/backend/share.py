"""分享畫面：被照顧者的畫面同步給照顧者看，照顧者也能遠端點按、填寫。

    被照顧者手機 ──/ws/share──→ 後端 ──/ws──→ 照顧者手機（顯示同一個畫面）
    照顧者點畫面 ──POST /api/share/{link_id}/commands──→ 後端 ──/ws/share──→ 被照顧者手機執行

被照顧者手機有兩種：
- 台北通 App（a11y/townpass/ 的修改）：App 把整個台北通的畫面拍成圖片送來（type: frame），
  首頁、卡證、服務網頁都看得到。照顧者點的是畫面上的位置（tap x, y），App 在同一個位置按。
- 電腦測試的模擬服務頁：網頁裡的分享程式用開源的 rrweb 記錄網頁的變化（type: events），
  照顧者點的是網頁上的元素（click node_id）。

後端只轉送，並暫存最近的畫面，讓照顧者中途打開也看得到。
送出、付款這類重要按鈕，要被照顧者在自己手機上按「同意」才會執行；密碼欄位照顧者不能填。
這些檢查在被照顧者手機上做，因為按鈕是在那支手機上被按下的。
"""

import json
import secrets
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, model_validator

from . import auth, config, store, templates
from .errors import ApiError
from .ws import hub

router = APIRouter(tags=["share"])

# 每個授權目前連著的分享程式。模擬服務頁可能疊著好幾頁，最後打開的就是看得到的那一頁；
# 台北通 App 只會有一個連線。
agents: dict[str, list[WebSocket]] = {}

RRWEB_META = 4  # rrweb 事件類型：Meta（後面接著完整畫面）


def _name(user_id: str) -> str:
    return store.USERS[user_id]


def _active_link(link_id: str, user_id: str, *, as_elder: bool) -> store.CareLink:
    link = store.state.links.get(link_id)
    if link is None or user_id not in (link.elder_id, link.caregiver_id):
        raise ApiError(404, "link_not_found", "找不到這個授權")
    if as_elder and link.elder_id != user_id:
        raise ApiError(403, "elder_only", "只有被照顧者本人可以做這件事")
    if not as_elder and link.caregiver_id != user_id:
        raise ApiError(403, "caregiver_only", "只有照顧者可以做這件事")
    if link.status != "active":
        raise ApiError(403, "link_closed", "授權已結束")
    return link


def share_view(link: store.CareLink) -> dict | None:
    share = store.state.shares.get(link.id)
    if share is None:
        return None
    return {"page": share.page, "on_page": bool(agents.get(link.id))}


# ---- 被照顧者開始分享 ----

class ShareStart(BaseModel):
    link_id: str


@router.post("/api/share/start")
async def start_share(body: ShareStart, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """被照顧者同意後呼叫。回傳分享程式要用的 token；再呼叫一次會拿到同一個（App 重開時用來還原）。"""
    link = _active_link(body.link_id, session.user_id, as_elder=True)
    share = store.state.shares.get(link.id)
    if share is None:
        share = store.ShareSession(link_id=link.id, token=secrets.token_urlsafe(24), created_at=store.now())
        store.state.shares[link.id] = share
        store.audit(link.id, session.user_id, "share_started")
    return {
        "link_id": link.id,
        "token": share.token,
        "caregiver_name": _name(link.caregiver_id),
        "elder_name": _name(link.elder_id),
    }


@router.get("/api/share/{link_id}")
async def get_share(link_id: str, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    """照顧者打開畫面時，先拿到目前的畫面（App 拍下的畫面，或網頁從最近一次完整畫面開始的變化）。"""
    link = _active_link(link_id, session.user_id, as_elder=False)
    share = store.state.shares.get(link.id)
    if share is None:
        return {"active": False, "page": None, "events": [], "frame": None, "message": f"{_name(link.elder_id)} 還沒開始分享。"}
    connected = bool(agents.get(link.id))
    events = share.events if connected else []
    frame = share.frame if connected else None
    if connected and not events and not frame:
        await _request_snapshot_now(share)  # 暫存被清掉了：請手機重送完整畫面
    message = None if share.page else templates.share_waiting(_name(link.elder_id))
    return {"active": True, "page": share.page, "events": events, "frame": frame, "message": message}


# ---- 照顧者遠端操作 ----

class Command(BaseModel):
    """照顧者的操作。
    - 台北通 App：tap（點畫面上的位置 x, y）、type（填入長輩手機上選取的欄位）
    - 模擬服務頁：click、input（node_id 是 rrweb 的元素編號）
    - 兩種都可以：scroll（dy 往下捲多少）、back（上一頁）
    - 台北通 App：home（回到台北通首頁）
    """
    action: Literal["tap", "type", "click", "input", "scroll", "back", "home"]
    node_id: int | None = Field(default=None, ge=1)
    x: float | None = Field(default=None, ge=0, le=10000)
    y: float | None = Field(default=None, ge=0, le=10000)
    value: str | None = Field(default=None, max_length=config.SHARE_INPUT_MAX_LENGTH)
    dy: int | None = Field(default=None, ge=-5000, le=5000)

    @model_validator(mode="after")
    def check_fields(self) -> "Command":
        if self.action in ("click", "input") and self.node_id is None:
            raise ValueError("node_id is required")
        if self.action == "tap" and (self.x is None or self.y is None):
            raise ValueError("x and y are required")
        if self.action in ("input", "type") and self.value is None:
            raise ValueError("value is required")
        if self.action == "scroll" and self.dy is None:
            raise ValueError("dy is required")
        return self


@router.post("/api/share/{link_id}/commands")
async def send_command(link_id: str, body: Command, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    link = _active_link(link_id, session.user_id, as_elder=False)
    current = _current_agent(link.id)
    if link.id not in store.state.shares or current is None:
        raise ApiError(409, "elder_not_on_page", templates.elder_not_on_page(_name(link.elder_id)))

    command_id = uuid.uuid4().hex[:12]
    store.audit(link.id, session.user_id, f"command:{body.action}")
    await _send(current, {"type": "command", "command_id": command_id, **body.model_dump(exclude_none=True)})
    return {"ok": True, "command_id": command_id}


# ---- 被照顧者手機上的分享程式 ----

def _current_agent(link_id: str) -> WebSocket | None:
    connected = agents.get(link_id) or []
    return connected[-1] if connected else None


async def _send(websocket: WebSocket, message: dict) -> None:
    try:
        await websocket.send_json(message)
    except Exception:
        pass


def _share_for_token(token: str) -> tuple[store.ShareSession, store.CareLink] | None:
    for share in store.state.shares.values():
        if secrets.compare_digest(share.token, token):
            link = store.state.links.get(share.link_id)
            if link and link.status == "active":
                return share, link
    return None


async def _store_events(share: store.ShareSession, link: store.CareLink, events: list, size: int) -> None:
    """暫存並轉送。收到 Meta（新的完整畫面）就從頭暫存；暫存太大就請手機重送完整畫面。"""
    for event in events:
        if isinstance(event, dict) and event.get("type") == RRWEB_META:
            share.events, share.events_bytes = [], 0
            break
    share.events.extend(events)
    share.events_bytes += size
    if share.events_bytes > config.SHARE_BUFFER_MAX_BYTES:
        share.events, share.events_bytes = [], 0
        await _request_snapshot(share)
    await hub.send(link.caregiver_id, "share_events", {"link_id": link.id, "events": events})


async def _request_snapshot(share: store.ShareSession) -> None:
    now = store.now()
    recent = share.snapshot_requested_at and now - share.snapshot_requested_at < timedelta(seconds=config.SHARE_SNAPSHOT_MIN_SECONDS)
    current = _current_agent(share.link_id)
    if current is not None and not recent:
        share.snapshot_requested_at = now
        await _send(current, {"type": "snapshot"})


async def _set_page(share: store.ShareSession, link: store.CareLink, page: dict | None) -> None:
    share.page = page
    if page is None:
        share.events, share.events_bytes, share.frame = [], 0, None
    await hub.send(link.caregiver_id, "share_page", {
        "link_id": link.id,
        "page": page,
        "message": None if page else templates.share_waiting(_name(link.elder_id)),
    })


def _clean_page(data: dict) -> dict:
    def text(key: str, limit: int) -> str:
        value = data.get(key)
        return value[:limit] if isinstance(value, str) else ""

    return {"url": text("url", 500), "title": text("title", 120)}


def _number(value: object, low: float, high: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if low <= value <= high else None


def _image(value: object) -> str | None:
    if isinstance(value, str) and value.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")):
        return value
    return None


def _clean_frame(message: dict) -> dict | None:
    """台北通 App 拍下的畫面：整個 App 的圖片＋疊在上面的網頁截圖（座標是畫面上的點）。格式不對就不收。"""
    width = _number(message.get("width"), 1, 10000)
    height = _number(message.get("height"), 1, 10000)
    image = _image(message.get("image"))
    raw_overlays = message.get("overlays", [])
    if width is None or height is None or image is None or not isinstance(raw_overlays, list):
        return None
    overlays = []
    for item in raw_overlays[: config.SHARE_FRAME_MAX_OVERLAYS]:
        if not isinstance(item, dict):
            return None
        box = [_number(item.get(key), 0, 10000) for key in ("x", "y", "width", "height")]
        overlay_image = _image(item.get("image"))
        if None in box or overlay_image is None:
            return None
        overlays.append({"x": box[0], "y": box[1], "width": box[2], "height": box[3], "image": overlay_image})
    title = message.get("title")
    return {
        "width": width,
        "height": height,
        "image": image,
        "overlays": overlays,
        "title": title[:120] if isinstance(title, str) and title else "台北通",
    }


async def _store_frame(share: store.ShareSession, link: store.CareLink, frame: dict) -> None:
    """暫存並轉送 App 拍下的畫面。換到別的畫面（標題不同）時也通知照顧者。"""
    share.events, share.events_bytes = [], 0
    page = {"url": "", "title": frame["title"]}
    if share.page != page:
        await _set_page(share, link, page)
    share.frame = frame
    await hub.send(link.caregiver_id, "share_frame", {"link_id": link.id, "frame": frame})


@router.websocket("/ws/share")
async def share_socket(websocket: WebSocket, token: str = "") -> None:
    found = _share_for_token(token)
    if found is None:
        await websocket.close(code=4401)  # token 無效或分享已結束：分享程式會自己停止
        return
    share, link = found
    await websocket.accept()
    agents.setdefault(link.id, []).append(websocket)  # 新打開的網頁就是看得到的那一頁
    elder_login = store.state.sessions.get(link.elder_token)
    await _send(websocket, {"type": "hello", "caregiver_name": _name(link.caregiver_id)})

    try:
        while True:
            raw = await websocket.receive_text()
            if elder_login:
                elder_login.last_seen_at = store.now()  # 分享中就算有在使用，不會被當成閒置登出
            message = json.loads(raw)
            kind = message.get("type") if isinstance(message, dict) else None
            is_current = _current_agent(link.id) is websocket

            if kind == "ping":
                await _send(websocket, {"type": "pong"})
            elif kind == "page" and is_current:
                await _set_page(share, link, _clean_page(message))
            elif kind == "events" and is_current and isinstance(message.get("events"), list):
                await _store_events(share, link, message["events"], len(raw))
            elif kind == "frame" and is_current and len(raw) <= config.SHARE_FRAME_MAX_BYTES:
                frame = _clean_frame(message)
                if frame is not None:
                    await _store_frame(share, link, frame)
            elif kind == "result":
                text = message.get("message")
                await hub.send(link.caregiver_id, "share_result", {
                    "link_id": link.id,
                    "command_id": str(message.get("command_id", ""))[:20],
                    "ok": bool(message.get("ok")),
                    "message": text[:200] if isinstance(text, str) else "",
                })
            elif kind == "stop":
                from .care import close_link  # care 也 import share，放在這裡避免循環 import
                await close_link(link, "revoked", link.elder_id)
                return
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        await _agent_left(link, websocket)


async def _agent_left(link: store.CareLink, websocket: WebSocket) -> None:
    connected = agents.get(link.id, [])
    was_current = bool(connected) and connected[-1] is websocket
    if websocket in connected:
        connected.remove(websocket)
    if not connected:
        agents.pop(link.id, None)
    share = store.state.shares.get(link.id)
    if share is None or not was_current:
        return
    if connected:
        await _request_snapshot_now(share)  # 上面那一頁關掉了，下面那一頁重新送完整畫面
    else:
        await _set_page(share, link, None)  # 網頁關掉了，或台北通 App 斷線


async def _request_snapshot_now(share: store.ShareSession) -> None:
    share.snapshot_requested_at = None
    await _request_snapshot(share)


async def close_share(link: store.CareLink) -> None:
    """授權結束：通知分享程式停止，並清掉暫存的畫面。"""
    store.state.shares.pop(link.id, None)
    for websocket in agents.pop(link.id, []):
        await _send(websocket, {"type": "closed"})
        try:
            await websocket.close(code=4000)
        except Exception:
            pass
