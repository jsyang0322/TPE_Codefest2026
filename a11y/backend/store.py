"""照顧者代操作的狀態：全部存在後端記憶體，不進資料庫。

後端重開後，登入、授權、同意紀錄都會消失，要重新登入、重新產生數字碼。
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
class CareSession:
    id: str
    link_id: str
    started_at: datetime
    last_event_at: datetime
    ended_at: datetime | None = None
    end_reason: str | None = None  # caregiver_end / elder_takeover / revoked / elder_logout / login_expired / idle_timeout
    last_step: int | None = None
    last_page: dict | None = None  # 最後一次同步的畫面，被照顧者重新整理時用來還原


@dataclass
class ConsentRequest:
    id: str
    link_id: str
    session_id: str
    level: str  # L1 / L2
    action_type: str
    payload: dict
    payload_hash: str
    summary: str
    prompt_text: str
    voice_code: str | None
    created_at: datetime
    expires_at: datetime
    status: str = "pending"  # pending / approved / rejected / expired / cancelled
    method: str | None = None  # tap / voice / biometric
    voice_attempts: int = 0
    tap_confirmed: bool = False
    responded_at: datetime | None = None


@dataclass
class ConsentToken:
    token: str
    consent_id: str
    expires_at: datetime
    used_at: datetime | None = None
    voided: bool = False


@dataclass
class AuditEntry:
    created_at: datetime
    link_id: str | None
    actor_id: str
    action: str
    level: str
    consent_id: str | None = None
    method: str | None = None
    detail: str | None = None


@dataclass
class State:
    sessions: dict[str, LoginSession] = field(default_factory=dict)
    bind_codes: dict[str, BindCode] = field(default_factory=dict)
    links: dict[str, CareLink] = field(default_factory=dict)
    care_sessions: dict[str, CareSession] = field(default_factory=dict)
    consents: dict[str, ConsentRequest] = field(default_factory=dict)
    consent_tokens: dict[str, ConsentToken] = field(default_factory=dict)
    audit: list[AuditEntry] = field(default_factory=list)
    code_failures: dict[str, list[datetime]] = field(default_factory=dict)  # 照顧者 id → 輸入錯誤的時間


state = State()


def reset() -> None:
    """清空所有狀態（測試用）。"""
    global state
    state = State()


def audit(link_id: str | None, actor_id: str, action: str, level: str = "L0", **extra) -> None:
    state.audit.append(AuditEntry(now(), link_id, actor_id, action, level, **extra))
