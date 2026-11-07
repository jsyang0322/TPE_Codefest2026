"""讓家人幫忙（綁定、授權、分享畫面）的狀態：全部存在後端記憶體，不進資料庫。

後端重開後，登入、授權、分享都會消失，要重新登入、重新產生數字碼。
授權本來就只在被照顧者這一次登入期間有效（規格第一部分第 4.2 節），所以不需要長期保存。

後端只有一個程序，API 都是 async，在同一個事件迴圈裡依序執行，所以不需要加鎖。
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone


def clock() -> datetime:
    return datetime.now(timezone.utc)


def now() -> datetime:
    """目前時間。測試時把 clock 換掉，就能模擬「5 分鐘後」。"""
    return clock()


def iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="milliseconds") if value else None


# demo 用的兩位使用者（規格第二部分第 4.2 節最後）
USERS = {
    "elder-1": "王阿伯",
    "caregiver-1": "王小美",
}


@dataclass
class LoginSession:
    token: str
    user_id: str
    created_at: datetime
    last_seen_at: datetime
    ended_at: datetime | None = None
    end_reason: str | None = None  # logout / idle_timeout


@dataclass
class BindCode:
    code: str
    elder_id: str
    elder_token: str  # 被照顧者這一次登入
    expires_at: datetime


@dataclass
class CareLink:
    id: str
    elder_id: str
    caregiver_id: str
    elder_token: str
    status: str  # pending / active / revoked / ended / expired / rejected
    created_at: datetime
    confirm_expires_at: datetime
    activated_at: datetime | None = None
    closed_at: datetime | None = None


@dataclass
class ShareSession:
    """被照顧者正在分享畫面。page 是目前的畫面（網頁或台北通 App）。
    - 台北通 App：frame 是最近一次拍下的整個 App 畫面
    - 電腦測試的模擬服務頁：events 是從最近一次完整畫面開始的 rrweb 變化
    照顧者中途打開或重新整理時，用它們把畫面補齊。"""
    link_id: str
    token: str  # 被照顧者手機上的分享程式用這個連線
    created_at: datetime
    page: dict | None = None
    events: list = field(default_factory=list)
    events_bytes: int = 0
    snapshot_requested_at: datetime | None = None
    frame: dict | None = None


@dataclass
class AuditEntry:
    created_at: datetime
    link_id: str | None
    actor_id: str
    action: str
    method: str | None = None
    detail: str | None = None


@dataclass
class State:
    sessions: dict[str, LoginSession] = field(default_factory=dict)
    bind_codes: dict[str, BindCode] = field(default_factory=dict)
    links: dict[str, CareLink] = field(default_factory=dict)
    shares: dict[str, ShareSession] = field(default_factory=dict)  # link_id → 分享
    audit: list[AuditEntry] = field(default_factory=list)
    code_failures: dict[str, list[datetime]] = field(default_factory=dict)  # 照顧者 id → 輸入錯誤的時間
    fines: dict[str, list] = field(default_factory=dict)  # 示範服務「交通罰單」：長輩 id → 假罰單（fines.py）


state = State()


def reset() -> None:
    """清空所有狀態（測試用）。"""
    global state
    state = State()


def audit(link_id: str | None, actor_id: str, action: str, **extra) -> None:
    state.audit.append(AuditEntry(now(), link_id, actor_id, action, **extra))
