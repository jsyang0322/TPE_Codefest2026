"""示範服務「交通罰單」：讓家人幫忙時，示範家人遠端幫長輩查罰單、繳罰單。

資料都是假的，存在後端記憶體（store.state.fines），不會真的付款。
- 長輩按「同意」讓家人幫忙時（care.confirm_link），重新產生一份假罰單，每次示範都從「待繳」開始。
- 罰單屬於示範的長輩帳號王阿伯。台北通裡的示範服務頁沒有無障礙輔助的登入，所以沒帶登入時就用王阿伯。
- 「確認繳費」要長輩在自己手機上同意才會按下（台北通 App 的分享程式檢查，見 a11y/townpass/）。
"""

import secrets
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Header
from pydantic import BaseModel

from . import store
from .errors import ApiError

router = APIRouter(prefix="/api/fines", tags=["fines"])

DEMO_OWNER = "elder-1"
PLATE = "ABC-1234"
TAIPEI = timezone(timedelta(hours=8))

# 付款方式的名稱不要有「扣款」「付款」這類字：家人幫忙選的時候，長輩手機才不會先問「同意嗎？」
# （只有「確認繳費」要問，見 a11y/townpass/ 的 importantWords）
METHODS = {
    "card": "信用卡（末四碼 5678）",
    "bank": "銀行帳戶（末四碼 0123）",
}


@dataclass
class Fine:
    id: str
    no: str            # 舉發單號
    title: str         # 違規事實
    law: str           # 違反條款
    place: str
    time: datetime     # 違規時間
    unit: str          # 舉發單位
    amount: int
    due: datetime      # 應到案日期
    status: str = "unpaid"  # unpaid / paid
    paid_at: datetime | None = None
    receipt_no: str | None = None
    method: str | None = None


def _sample(now: datetime) -> list[Fine]:
    """兩張待繳、一張已繳。日期跟著今天算，期限永遠還沒到。"""
    day = now.astimezone(TAIPEI).replace(second=0, microsecond=0)
    parking = day.replace(hour=14, minute=32) - timedelta(days=18)
    speeding = day.replace(hour=8, minute=15) - timedelta(days=9)
    old = day.replace(hour=17, minute=5) - timedelta(days=64)
    return [
        Fine("f1", "AB1234567", "在禁止臨時停車處所停車", "道路交通管理處罰條例第 56 條第 1 項",
             "臺北市中山區吉林路 69 號前", parking, "臺北市政府警察局中山分局", 600, parking + timedelta(days=30)),
        Fine("f2", "AC7654321", "行車速度超過規定之最高時速 20 公里以內", "道路交通管理處罰條例第 40 條",
             "臺北市信義區信義路五段（測速照相）", speeding, "臺北市政府警察局交通警察大隊", 1600,
             speeding + timedelta(days=30)),
        Fine("f3", "AD1122334", "汽車行駛道路不依規定使用方向燈", "道路交通管理處罰條例第 42 條",
             "臺北市大安區復興南路一段", old, "臺北市政府警察局大安分局", 1200, old + timedelta(days=30),
             status="paid", paid_at=old + timedelta(days=6), receipt_no="R2026090001", method="card"),
    ]


def seed(owner_id: str) -> None:
    """重新產生這個帳號的假罰單（長輩同意讓家人幫忙時呼叫）。"""
    store.state.fines[owner_id] = _sample(store.now())


def _owner(authorization: str | None) -> str:
    token = (authorization or "").removeprefix("Bearer ").strip()
    session = store.state.sessions.get(token)
    if session and session.ended_at is None and session.user_id.startswith("elder-"):
        return session.user_id
    return DEMO_OWNER


def _fines(owner_id: str) -> list[Fine]:
    if owner_id not in store.state.fines:
        seed(owner_id)
    return store.state.fines[owner_id]


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(TAIPEI).isoformat(timespec="minutes") if value else None


def fine_view(fine: Fine) -> dict:
    return {
        "id": fine.id,
        "no": fine.no,
        "title": fine.title,
        "law": fine.law,
        "place": fine.place,
        "time": _iso(fine.time),
        "unit": fine.unit,
        "amount": fine.amount,
        "due": _iso(fine.due),
        "status": fine.status,
        "paid_at": _iso(fine.paid_at),
        "receipt_no": fine.receipt_no,
        "method": METHODS.get(fine.method) if fine.method else None,
    }


@router.get("")
async def list_fines(authorization: str | None = Header(default=None)) -> dict:
    owner_id = _owner(authorization)
    return {
        "owner": {"name": store.USERS[owner_id], "plate": PLATE},
        "fines": [fine_view(fine) for fine in _fines(owner_id)],
        "methods": [{"id": key, "label": label} for key, label in METHODS.items()],
    }


class PayBody(BaseModel):
    method: Literal["card", "bank"]


@router.post("/{fine_id}/pay")
async def pay_fine(fine_id: str, body: PayBody, authorization: str | None = Header(default=None)) -> dict:
    owner_id = _owner(authorization)
    fines = _fines(owner_id)
    index = next((i for i, fine in enumerate(fines) if fine.id == fine_id), None)
    if index is None:
        raise ApiError(404, "fine_not_found", "找不到這張罰單")
    if fines[index].status == "paid":
        raise ApiError(409, "fine_paid", "這張罰單已經繳過了")
    now = store.now()
    fines[index] = replace(
        fines[index], status="paid", paid_at=now, method=body.method,
        receipt_no="R" + now.astimezone(TAIPEI).strftime("%Y%m%d") + f"{secrets.randbelow(10000):04d}",
    )
    store.audit(None, owner_id, "fine_paid", method=body.method, detail=fines[index].no)
    return {"fine": fine_view(fines[index])}
