"""實際操作（模擬）：查停車費、繳停車費（規格第二部分第 5.6 節）。

真正的繳費系統無法串接，這裡是 demo 用的模擬資料，畫面上會標示「模擬」。
重點是付款前的伺服器端確認：照顧者代為付款時，一定要帶被照顧者同意後拿到的 consent_token，
而且車牌、金額要和同意時完全一樣。
"""

import secrets

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from . import auth, consent, store, templates
from .errors import ApiError
from .ws import hub

router = APIRouter(prefix="/api/actions", tags=["actions"])

PLATE = r"^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$"
DEMO_PLATE = "ABC-1234"


def mock_bill(plate: str) -> int:
    """模擬的待繳金額：demo 車牌固定 120 元，其他車牌依車牌算出 60～300 元。"""
    if plate == DEMO_PLATE:
        return 120
    return 60 + (sum(map(ord, plate)) % 9) * 30


@router.get("/parking-bill")
async def parking_bill(
    plate: str = Query(pattern=PLATE),
    _session: store.LoginSession = Depends(auth.current_session),
) -> dict:
    return {"plate": plate, "amount": mock_bill(plate), "mock": True}


class PayParking(BaseModel):
    plate: str = Field(pattern=PLATE)
    amount: int = Field(ge=1, le=100000)
    acting_for: str | None = None     # 代誰付款；本人自己付款時不帶
    session_id: str | None = None
    consent_token: str | None = None


@router.post("/pay-parking")
async def pay_parking(body: PayParking, session: store.LoginSession = Depends(auth.current_session)) -> dict:
    state = store.state
    payload = {"plate": body.plate, "amount": body.amount}

    if body.acting_for is None:
        # 本人自己付款，不需要同意
        payer = session.user_id
        link = None
    else:
        care_session = state.care_sessions.get(body.session_id or "")
        link = state.links.get(care_session.link_id) if care_session else None
        if (not care_session or care_session.ended_at is not None or not link
                or link.caregiver_id != session.user_id or link.elder_id != body.acting_for):
            raise ApiError(403, "not_your_session", "目前沒有在幫這個人操作")
        consent.verify_consent_token(body.consent_token, link.id, "pay_parking", payload)
        payer = link.elder_id

    receipt_id = "R" + secrets.token_hex(4).upper()
    speak = templates.paid(body.amount)
    store.audit(link.id if link else None, session.user_id, "pay_parking", "L2",
                detail=f"{body.plate} {body.amount} 元 {receipt_id}")
    if link:
        await hub.send(payer, "action_completed", {"action_type": "pay_parking", "receipt_id": receipt_id, "speak": speak})
    return {"ok": True, "receipt_id": receipt_id, "speak": speak, "mock": True}
