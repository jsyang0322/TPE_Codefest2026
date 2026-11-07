"""WebSocket：後端主動推送事件給手機（規格第二部分第 6 節）。

兩支手機打開頁面時各自連上 /ws?token=<登入 token>，連線一直開著。
照顧者每做一步，後端就推一則很小的事件給被照顧者，例如
    { "type": "page_sync", "data": { "step": 2, "fields": { "plate": "ABC-12" }, "speak": "王小美 正在幫你填寫車牌。" } }
傳的是「狀態」不是「畫面影像」，所以手機和網路的負擔都很小。
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import store

router = APIRouter()


class Hub:
    """記錄每位使用者目前的連線（同一人可能開了好幾個視窗）。"""

    def __init__(self) -> None:
        self.connections: dict[str, dict[WebSocket, str]] = {}  # user_id → { 連線: 登入 token }

    def add(self, user_id: str, websocket: WebSocket, token: str) -> None:
        self.connections.setdefault(user_id, {})[websocket] = token

    def remove(self, user_id: str, websocket: WebSocket) -> None:
        self.connections.get(user_id, {}).pop(websocket, None)

    async def send(self, user_id: str, type_: str, data: dict) -> None:
        message = {"type": type_, "data": data}
        for websocket in list(self.connections.get(user_id, {})):
            try:
                await websocket.send_json(message)
            except Exception:
                self.remove(user_id, websocket)

    async def close_token(self, user_id: str, token: str) -> None:
        """登出時關掉這次登入的連線。"""
        for websocket, owner in list(self.connections.get(user_id, {}).items()):
            if owner == token:
                self.remove(user_id, websocket)
                try:
                    await websocket.close(code=4401)
                except Exception:
                    pass


hub = Hub()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = "") -> None:
    session = store.state.sessions.get(token)
    if session is None or session.ended_at is not None:
        await websocket.close(code=4401)  # token 無效或登入已結束
        return

    await websocket.accept()
    hub.add(session.user_id, websocket, token)
    try:
        while True:
            message = await websocket.receive_json()  # 網頁只會送 { "type": "ping" }
            session.last_seen_at = store.now()          # 頁面開著就算有在使用，不會被當成閒置登出
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        hub.remove(session.user_id, websocket)
