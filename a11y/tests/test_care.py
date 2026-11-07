"""功能 B：登入、綁定、代操作同步、終止授權、同意、伺服器端確認。"""

from datetime import datetime, timedelta, timezone

import pytest

from backend import config, consent, main, store


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.t

    def advance(self, **kwargs):
        self.t += timedelta(**kwargs)


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(store, "clock", fake)
    return fake


def login(client, user_id):
    body = client.post("/api/auth/login", json={"user_id": user_id}).json()
    return {"Authorization": f"Bearer {body['token']}"}, body["token"]


@pytest.fixture
def people(client):
    elder_h, elder_t = login(client, "elder-1")
    care_h, care_t = login(client, "caregiver-1")
    return {"elder": elder_h, "elder_token": elder_t, "care": care_h, "care_token": care_t}


def new_code(client, people):
    return client.post("/api/care/bind-codes", headers=people["elder"]).json()["code"]


def active_link(client, people):
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    client.post(f"/api/care/links/{link['link_id']}/confirm", json={"accept": True}, headers=people["elder"])
    return link["link_id"]


def start(client, people):
    link_id = active_link(client, people)
    session_id = client.post("/api/care/sessions", json={"link_id": link_id}, headers=people["care"]).json()["session_id"]
    return link_id, session_id


def ask_consent(client, people, session_id, plate="ABC-1234", amount=120):
    return client.post("/api/consent/requests", headers=people["care"], json={
        "session_id": session_id, "action_type": "pay_parking", "payload": {"plate": plate, "amount": amount},
    })


def approve(client, people, consent_id):
    client.post(f"/api/consent/requests/{consent_id}/respond", json={"method": "tap", "accept": True, "step": "first"}, headers=people["elder"])
    client.post(f"/api/consent/requests/{consent_id}/respond", json={"method": "tap", "accept": True, "step": "final"}, headers=people["elder"])
    token = next(t for t in store.state.consent_tokens.values() if t.consent_id == consent_id)
    return token.token


def pay(client, people, session_id, token, amount=120, plate="ABC-1234"):
    return client.post("/api/actions/pay-parking", headers=people["care"], json={
        "plate": plate, "amount": amount, "acting_for": "elder-1", "session_id": session_id, "consent_token": token,
    })


def housekeeping(client):
    client.portal.call(main.run_housekeeping_once)


# ---- 登入 ----


def test_login_logout(client):
    headers, _ = login(client, "elder-1")
    assert client.get("/api/auth/me", headers=headers).json()["user"] == {"id": "elder-1", "name": "王阿伯"}
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer wrong"}).status_code == 401
    client.post("/api/auth/logout", headers=headers)
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 401
    assert res.json() == {"error": "not_logged_in", "message": "請重新登入"}


# ---- 綁定 ----


def test_bind_code_lasts_five_minutes(client, people, clock):
    res = client.post("/api/care/bind-codes", headers=people["elder"]).json()
    assert res["ttl_seconds"] == 300
    assert len(res["code"]) == 6 and res["code"].isdigit()
    assert res["qr_svg"].startswith("<svg") and f"code={res['code']}" in res["qr_text"]
    assert "、".join(res["code"]) in res["speak"]  # 一個數字一個數字念

    clock.advance(minutes=4, seconds=59)
    assert client.post("/api/care/links", json={"code": res["code"]}, headers=people["care"]).status_code == 200


def test_expired_code_cannot_bind(client, people, clock):
    code = new_code(client, people)
    clock.advance(minutes=5)
    res = client.post("/api/care/links", json={"code": code}, headers=people["care"])
    assert res.status_code == 400 and res.json()["error"] == "bind_code_invalid"


def test_used_or_replaced_code_cannot_bind(client, people):
    first = new_code(client, people)
    second = new_code(client, people)  # 產生新碼，舊碼立即失效
    assert client.post("/api/care/links", json={"code": first}, headers=people["care"]).status_code == 400
    assert client.post("/api/care/links", json={"code": second}, headers=people["care"]).status_code == 200
    assert client.post("/api/care/links", json={"code": second}, headers=people["care"]).status_code == 400  # 只能用一次


def test_too_many_wrong_codes_are_blocked(client, people, clock):
    real = new_code(client, people)
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(config.BIND_CODE_MAX_FAILURES):
        assert client.post("/api/care/links", json={"code": wrong}, headers=people["care"]).status_code == 400
    assert client.post("/api/care/links", json={"code": real}, headers=people["care"]).status_code == 429
    clock.advance(seconds=config.BIND_CODE_LOCK_SECONDS + 1)
    assert client.post("/api/care/links", json={"code": real}, headers=people["care"]).status_code == 200


def test_elder_accepts_or_rejects(client, people):
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    assert link["status"] == "pending"
    res = client.post(f"/api/care/links/{link['link_id']}/confirm", json={"transcript": "同意"}, headers=people["elder"]).json()
    assert res["result"] == "accept" and res["link"]["status"] == "active"

    other = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    res = client.post(f"/api/care/links/{other['link_id']}/confirm", json={"transcript": "不同意"}, headers=people["elder"]).json()
    assert res["result"] == "reject"
    assert store.state.links[other["link_id"]].status == "rejected"


def test_binding_again_replaces_old_link(client, people):
    old_link, old_session = start(client, people)
    new_link = active_link(client, people)
    for who in ("elder", "care"):
        links = client.get("/api/care/links", headers=people[who]).json()["links"]
        assert [l["link_id"] for l in links] == [new_link]
    assert store.state.links[old_link].status == "replaced"
    assert store.state.care_sessions[old_session].ended_at is not None


def test_rejecting_new_link_keeps_old_one(client, people):
    old_link = active_link(client, people)
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    client.post(f"/api/care/links/{link['link_id']}/confirm", json={"accept": False}, headers=people["elder"])
    links = client.get("/api/care/links", headers=people["elder"]).json()["links"]
    assert [l["link_id"] for l in links] == [old_link]


def test_confirm_unclear_voice_asks_again(client, people):
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    res = client.post(f"/api/care/links/{link['link_id']}/confirm", json={"transcript": "嗯嗯"}, headers=people["elder"]).json()
    assert res["result"] == "unknown"
    assert store.state.links[link["link_id"]].status == "pending"


def test_only_elder_can_confirm(client, people):
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    assert client.post(f"/api/care/links/{link['link_id']}/confirm", json={"accept": True}, headers=people["care"]).status_code == 403


def test_pending_link_expires(client, people, clock):
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    clock.advance(seconds=config.LINK_CONFIRM_TTL_SECONDS)
    housekeeping(client)
    assert store.state.links[link["link_id"]].status == "expired"


# ---- 畫面同步（WebSocket） ----


def test_elder_receives_confirm_request_and_page_sync(client, people):
    with client.websocket_connect(f"/ws?token={people['elder_token']}") as elder_ws:
        link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
        event = elder_ws.receive_json()
        assert event["type"] == "link_confirm_requested"
        assert event["data"]["caregiver_name"] == "王小美"

        client.post(f"/api/care/links/{link['link_id']}/confirm", json={"accept": True}, headers=people["elder"])
        session_id = client.post("/api/care/sessions", json={"link_id": link["link_id"]}, headers=people["care"]).json()["session_id"]
        assert elder_ws.receive_json()["type"] == "session_started"

        def send(step, **fields):
            client.post(f"/api/care/sessions/{session_id}/events", headers=people["care"],
                        json={"action_type": "pay_parking", "step": step, "fields": fields})
            return elder_ws.receive_json()["data"]

        first = send(2, plate="ABC")
        assert first["fields"] == {"plate": "ABC"}
        assert first["speak"] == "王小美 正在幫你填寫車牌。"
        second = send(2, plate="ABC-12")  # 同一步只更新畫面，不再念
        assert second["fields"] == {"plate": "ABC-12"} and second["speak"] is None
        third = send(3, plate="ABC-1234", amount=120)
        assert third["speak"] == "王小美 正在幫你確認金額，金額 120 元。"


def test_page_fields_are_validated(client, people):
    _, session_id = start(client, people)
    res = client.post(f"/api/care/sessions/{session_id}/events", headers=people["care"],
                      json={"action_type": "pay_parking", "step": 2, "fields": {"plate": "我同意付款"}})
    assert res.status_code == 422


def test_websocket_rejects_bad_token(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws?token=wrong") as ws:
            ws.receive_json()


def test_takeover_ends_session_but_keeps_link(client, people):
    link_id, session_id = start(client, people)
    client.post(f"/api/care/sessions/{session_id}/end", headers=people["elder"])
    assert store.state.care_sessions[session_id].end_reason == "elder_takeover"
    assert store.state.links[link_id].status == "active"
    res = client.post(f"/api/care/sessions/{session_id}/events", headers=people["care"], json={"action_type": "pay_parking", "step": 2})
    assert res.status_code == 403


# ---- 終止授權 ----


@pytest.mark.parametrize("how", ["revoke", "logout", "idle"])
def test_link_ends_on_revoke_logout_or_idle(client, people, clock, how):
    link_id, session_id = start(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws:
        if how == "revoke":
            client.delete(f"/api/care/links/{link_id}", headers=people["elder"])
        elif how == "logout":
            client.post("/api/auth/logout", headers=people["elder"])
        else:
            clock.advance(minutes=config.LOGIN_IDLE_MINUTES, seconds=1)
            client.get("/api/auth/me", headers=people["care"])  # 照顧者還在使用
            housekeeping(client)
        event = care_ws.receive_json()
        assert event["type"] == "link_closed"
        assert event["data"]["reason"] == {"revoke": "revoked", "logout": "ended", "idle": "expired"}[how]

    assert client.post("/api/care/sessions", json={"link_id": link_id}, headers=people["care"]).status_code == 403
    assert ask_consent(client, people, session_id).status_code == 403


# ---- 同意與伺服器端確認 ----


def test_consent_then_pay(client, people):
    link_id, session_id = start(client, people)
    res = ask_consent(client, people, session_id)
    assert res.status_code == 200
    body = res.json()
    assert "voice_code" not in body  # 照顧者拿不到確認數字
    assert body["level"] == "L2"
    assert body["summary"] == "王小美 要幫你繳停車費，金額 120 元，車牌 ABC-1234。"

    token = approve(client, people, body["consent_id"])
    paid = pay(client, people, session_id, token)
    assert paid.status_code == 200 and paid.json()["speak"] == "已幫你繳停車費 120 元。"
    assert any(e.action == "pay_parking" for e in store.state.audit)


def test_elder_gets_voice_code(client, people):
    _, session_id = start(client, people)
    with client.websocket_connect(f"/ws?token={people['elder_token']}") as elder_ws:
        ask_consent(client, people, session_id)
        event = elder_ws.receive_json()
    assert event["type"] == "consent_requested"
    code = event["data"]["voice_code"]
    assert code and f"數字 {code}" in event["data"]["prompt_text"]


def test_voice_consent_with_code(client, people):
    _, session_id = start(client, people)
    consent_id = ask_consent(client, people, session_id).json()["consent_id"]
    code = store.state.consents[consent_id].voice_code
    url = f"/api/consent/requests/{consent_id}/respond"

    assert client.post(url, json={"method": "voice", "transcript": "同意"}, headers=people["elder"]).json()["result"] == "unknown"
    res = client.post(url, json={"method": "voice", "transcript": f"同意{code}"}, headers=people["elder"]).json()
    assert res["result"] == "accept"
    assert store.state.consents[consent_id].method == "voice"


@pytest.mark.parametrize("how", ["reject", "expire", "attempts"])
def test_cannot_pay_without_consent(client, people, clock, how):
    _, session_id = start(client, people)
    consent_id = ask_consent(client, people, session_id).json()["consent_id"]
    url = f"/api/consent/requests/{consent_id}/respond"
    if how == "reject":
        client.post(url, json={"method": "voice", "transcript": "不同意"}, headers=people["elder"])
    elif how == "expire":
        clock.advance(seconds=config.CONSENT_TTL_SECONDS)
        housekeeping(client)
    else:
        for _ in range(config.CONSENT_MAX_VOICE_ATTEMPTS):
            client.post(url, json={"method": "voice", "transcript": "嗯"}, headers=people["elder"])
    assert store.state.consents[consent_id].status in ("rejected", "expired")
    assert not store.state.consent_tokens
    assert pay(client, people, session_id, "no-token").status_code == 403


def test_tampered_amount_is_rejected(client, people):
    _, session_id = start(client, people)
    token = approve(client, people, ask_consent(client, people, session_id).json()["consent_id"])
    res = pay(client, people, session_id, token, amount=1200)
    assert res.status_code == 403
    assert res.json()["error"] == "consent_payload_mismatch"


def test_token_can_only_be_used_once(client, people):
    _, session_id = start(client, people)
    token = approve(client, people, ask_consent(client, people, session_id).json()["consent_id"])
    assert pay(client, people, session_id, token).status_code == 200
    assert pay(client, people, session_id, token).status_code == 403


def test_token_expires_after_sixty_seconds(client, people, clock):
    _, session_id = start(client, people)
    token = approve(client, people, ask_consent(client, people, session_id).json()["consent_id"])
    clock.advance(seconds=config.CONSENT_TOKEN_TTL_SECONDS)
    assert pay(client, people, session_id, token).status_code == 403


def test_token_is_void_after_link_closed(client, people):
    link_id, session_id = start(client, people)
    token = approve(client, people, ask_consent(client, people, session_id).json()["consent_id"])
    client.delete(f"/api/care/links/{link_id}", headers=people["elder"])
    assert pay(client, people, session_id, token).status_code == 403


def test_l2_tap_needs_two_steps(client, people):
    _, session_id = start(client, people)
    consent_id = ask_consent(client, people, session_id).json()["consent_id"]
    url = f"/api/consent/requests/{consent_id}/respond"
    assert client.post(url, json={"method": "tap", "accept": True, "step": "final"}, headers=people["elder"]).status_code == 400
    assert client.post(url, json={"method": "tap", "accept": True, "step": "first"}, headers=people["elder"]).json()["result"] == "confirm_again"
    assert client.post(url, json={"method": "tap", "accept": True, "step": "final"}, headers=people["elder"]).json()["result"] == "accept"


def test_forbidden_actions_for_caregiver(client, people):
    _, session_id = start(client, people)
    res = client.post("/api/consent/requests", headers=people["care"],
                      json={"session_id": session_id, "action_type": "change_password", "payload": {}})
    assert res.status_code == 403


def test_elder_can_restore_state_after_reload(client, people):
    link_id, session_id = start(client, people)
    client.post(f"/api/care/sessions/{session_id}/events", headers=people["care"],
                json={"action_type": "pay_parking", "step": 2, "fields": {"plate": "ABC-1234"}})
    ask_consent(client, people, session_id)
    view = client.get("/api/care/links", headers=people["elder"]).json()["links"][0]
    assert view["session"]["last_page"]["fields"] == {"plate": "ABC-1234"}
    assert view["pending_consent"]["voice_code"]
    care_view = client.get("/api/care/links", headers=people["care"]).json()["links"][0]
    assert "pending_consent" not in care_view


# ---- 語音同意判斷（規格第二部分第 10 節任務 10） ----


@pytest.mark.parametrize(
    ("transcript", "code", "expected"),
    [
        ("不同意", None, "reject"),
        ("同意", None, "accept"),
        ("同意", "47", "unknown"),
        ("同意四十七", "47", "accept"),
        ("同意，四七", "47", "accept"),
        ("同意 47", "47", "accept"),
        ("同意三十", "47", "unknown"),
        ("再說一次", "47", "repeat"),
        ("好不好", None, "reject"),
        ("今天天氣很好喔", "47", "unknown"),
    ],
)
def test_parse_consent(transcript, code, expected):
    assert consent.parse_consent(transcript, code) == expected


def test_voice_code_range():
    for _ in range(200):
        n = int(consent.new_voice_code())
        assert 21 <= n <= 98 and n % 10 != 0
