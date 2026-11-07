"""功能 B：登入、綁定、分享畫面、遠端操作、停止分享。"""

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


def start_share(client, people):
    link_id = active_link(client, people)
    token = client.post("/api/share/start", json={"link_id": link_id}, headers=people["elder"]).json()["token"]
    return link_id, token


def housekeeping(client):
    client.portal.call(main.run_housekeeping_once)


# rrweb 事件：Meta（type 4）後面接完整畫面（type 2），之後是畫面變化（type 3）
META = {"type": 4, "data": {"href": "https://service.example/apply", "width": 390, "height": 844}, "timestamp": 1}
FULL = {"type": 2, "data": {"node": {"type": 0, "childNodes": [], "id": 1}}, "timestamp": 2}


def mutation(n):
    return {"type": 3, "data": {"source": 0, "n": n}, "timestamp": 3 + n}


def next_of(ws, type_):
    """略過其他推播，等到指定類型的訊息。"""
    while True:
        message = ws.receive_json()
        if message.get("type") == type_:
            return message


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
    assert set(res) == {"code", "expires_at", "ttl_seconds", "speak"}  # 只有數字碼，沒有 QR code
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
    old_link, _ = start_share(client, people)
    new_link = active_link(client, people)
    for who in ("elder", "care"):
        links = client.get("/api/care/links", headers=people[who]).json()["links"]
        assert [l["link_id"] for l in links] == [new_link]
    assert store.state.links[old_link].status == "replaced"
    assert old_link not in store.state.shares  # 舊的分享一起結束


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


def test_elder_receives_confirm_request(client, people):
    with client.websocket_connect(f"/ws?token={people['elder_token']}") as elder_ws:
        client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"])
        event = elder_ws.receive_json()
        assert event["type"] == "link_confirm_requested"
        assert event["data"]["caregiver_name"] == "王小美"
        assert event["data"]["speak"].startswith("王小美 想看你的畫面、幫你操作，同意嗎？")


def test_pending_link_expires(client, people, clock):
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    clock.advance(seconds=config.LINK_CONFIRM_TTL_SECONDS)
    housekeeping(client)
    assert store.state.links[link["link_id"]].status == "expired"


def test_websocket_rejects_bad_token(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws?token=wrong") as ws:
            ws.receive_json()


# ---- 分享畫面 ----


def test_only_elder_with_active_link_can_start_share(client, people):
    link = client.post("/api/care/links", json={"code": new_code(client, people)}, headers=people["care"]).json()
    res = client.post("/api/share/start", json={"link_id": link["link_id"]}, headers=people["elder"])
    assert res.status_code == 403  # 還沒同意
    client.post(f"/api/care/links/{link['link_id']}/confirm", json={"accept": True}, headers=people["elder"])
    assert client.post("/api/share/start", json={"link_id": link["link_id"]}, headers=people["care"]).status_code == 403

    first = client.post("/api/share/start", json={"link_id": link["link_id"]}, headers=people["elder"]).json()
    again = client.post("/api/share/start", json={"link_id": link["link_id"]}, headers=people["elder"]).json()
    assert first["token"] == again["token"]  # App 重開時可以再要一次
    assert first["caregiver_name"] == "王小美"


def test_elder_page_reaches_caregiver(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws, \
            client.websocket_connect(f"/ws/share?token={token}") as agent:
        assert agent.receive_json() == {"type": "hello", "caregiver_name": "王小美"}

        agent.send_json({"type": "page", "url": "https://service.example/apply", "title": "申辦服務"})
        page = next_of(care_ws, "share_page")["data"]
        assert page["page"] == {"url": "https://service.example/apply", "title": "申辦服務"}

        agent.send_json({"type": "events", "events": [META, FULL]})
        assert next_of(care_ws, "share_events")["data"]["events"] == [META, FULL]
        agent.send_json({"type": "events", "events": [mutation(1)]})
        next_of(care_ws, "share_events")

        view = client.get(f"/api/share/{link_id}", headers=people["care"]).json()
        assert view["page"]["title"] == "申辦服務"
        assert view["events"] == [META, FULL, mutation(1)]

        agent.send_json({"type": "events", "events": [META, FULL]})  # 新的完整畫面：暫存從頭開始
        next_of(care_ws, "share_events")
        assert client.get(f"/api/share/{link_id}", headers=people["care"]).json()["events"] == [META, FULL]
        assert client.get(f"/api/share/{link_id}", headers=people["elder"]).status_code == 403


def test_caregiver_command_reaches_elder_page(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws, \
            client.websocket_connect(f"/ws/share?token={token}") as agent:
        agent.receive_json()
        res = client.post(f"/api/share/{link_id}/commands", json={"action": "click", "node_id": 12}, headers=people["care"])
        assert res.status_code == 200
        command = agent.receive_json()
        assert command == {"type": "command", "command_id": res.json()["command_id"], "action": "click", "node_id": 12}

        agent.send_json({"type": "result", "command_id": command["command_id"], "ok": False, "message": "王阿伯 不同意按「送出」"})
        result = next_of(care_ws, "share_result")["data"]
        assert result["ok"] is False and result["message"] == "王阿伯 不同意按「送出」"

        client.post(f"/api/share/{link_id}/commands", json={"action": "input", "node_id": 7, "value": "王阿伯"}, headers=people["care"])
        assert agent.receive_json()["value"] == "王阿伯"


@pytest.mark.parametrize("body", [
    {"action": "tap", "x": 10},
    {"action": "tap", "x": 10, "y": 20000},
    {"action": "tap", "x": -1, "y": 10},
    {"action": "type"},
    {"action": "type", "value": "字" * 501},
    {"action": "click"},
    {"action": "input", "node_id": 3},
    {"action": "input", "node_id": 3, "value": "字" * 501},
    {"action": "scroll"},
    {"action": "run_js", "node_id": 3},
])
def test_commands_are_validated(client, people, body):
    link_id, _ = start_share(client, people)
    assert client.post(f"/api/share/{link_id}/commands", json=body, headers=people["care"]).status_code == 422


def test_only_caregiver_sends_commands_and_elder_must_be_on_page(client, people):
    link_id, token = start_share(client, people)
    body = {"action": "click", "node_id": 1}
    res = client.post(f"/api/share/{link_id}/commands", json=body, headers=people["care"])
    assert res.status_code == 409 and res.json()["message"] == "還看不到 王阿伯 的畫面，沒辦法操作。"
    with client.websocket_connect(f"/ws/share?token={token}") as agent:
        agent.receive_json()
        assert client.post(f"/api/share/{link_id}/commands", json=body, headers=people["elder"]).status_code == 403


def test_share_socket_rejects_bad_token(client, people):
    start_share(client, people)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/share?token=wrong") as agent:
            agent.receive_json()


def test_latest_page_is_the_one_shared(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws, \
            client.websocket_connect(f"/ws/share?token={token}") as below:
        below.receive_json()
        with client.websocket_connect(f"/ws/share?token={token}") as top:
            top.receive_json()
            below.send_json({"type": "events", "events": [META, FULL]})  # 被蓋住的頁面不轉送
            top.send_json({"type": "events", "events": [META, FULL, mutation(1)]})
            assert next_of(care_ws, "share_events")["data"]["events"][-1] == mutation(1)
            client.post(f"/api/share/{link_id}/commands", json={"action": "back"}, headers=people["care"])
            assert top.receive_json()["action"] == "back"
        assert below.receive_json() == {"type": "snapshot"}  # 上面那頁關掉了，下面那頁重送完整畫面


def test_leaving_the_page_tells_caregiver(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws:
        with client.websocket_connect(f"/ws/share?token={token}") as agent:
            agent.receive_json()
            agent.send_json({"type": "page", "url": "https://service.example/", "title": "服務"})
            next_of(care_ws, "share_page")
        left = next_of(care_ws, "share_page")["data"]
        assert left["page"] is None
        assert left["message"] == "還看不到 王阿伯 的畫面。請他打開台北通的「無障礙輔助」，畫面就會出現。"
    assert client.get(f"/api/share/{link_id}", headers=people["care"]).json()["events"] == []


def test_big_page_asks_for_new_snapshot(client, people, monkeypatch):
    monkeypatch.setattr(config, "SHARE_BUFFER_MAX_BYTES", 300)
    _, token = start_share(client, people)
    with client.websocket_connect(f"/ws/share?token={token}") as agent:
        agent.receive_json()
        agent.send_json({"type": "events", "events": [META, FULL] + [mutation(i) for i in range(10)]})
        assert agent.receive_json() == {"type": "snapshot"}


def test_stop_from_elder_page_revokes_link(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws, \
            client.websocket_connect(f"/ws/share?token={token}") as agent:
        agent.receive_json()
        agent.send_json({"type": "stop"})
        assert agent.receive_json() == {"type": "closed"}
        closed = next_of(care_ws, "link_closed")["data"]
        assert closed["reason"] == "revoked" and closed["speak"] == "王阿伯 已停止分享。"
    assert store.state.links[link_id].status == "revoked"


def test_link_shows_share_state(client, people):
    _, token = start_share(client, people)
    view = client.get("/api/care/links", headers=people["elder"]).json()["links"][0]
    assert view["share"] == {"page": None, "on_page": False}
    with client.websocket_connect(f"/ws/share?token={token}") as agent:
        agent.receive_json()
        view = client.get("/api/care/links", headers=people["care"]).json()["links"][0]
        assert view["share"]["on_page"] is True


def test_sharing_keeps_elder_login_alive(client, people, clock):
    _, token = start_share(client, people)
    with client.websocket_connect(f"/ws/share?token={token}") as agent:
        agent.receive_json()
        clock.advance(minutes=config.LOGIN_IDLE_MINUTES - 1)
        agent.send_json({"type": "ping"})
        assert agent.receive_json() == {"type": "pong"}
        clock.advance(minutes=2)
        housekeeping(client)
    assert store.state.sessions[people["elder_token"]].ended_at is None


# ---- 停止分享 ----



# ---- 台北通 App 分享整個畫面 ----

PNG = "data:image/png;base64,iVBORw0KGgo="
JPEG = "data:image/jpeg;base64,/9j/4AAQ"


def app_frame(title="台北通", overlays=()):
    return {"type": "frame", "width": 390, "height": 760, "image": PNG, "overlays": list(overlays), "title": title}


def test_app_screen_reaches_caregiver(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws, \
            client.websocket_connect(f"/ws/share?token={token}") as app:
        app.receive_json()
        web = {"x": 0, "y": 56, "width": 390, "height": 704, "image": JPEG}
        app.send_json(app_frame("申辦服務", [web]))

        page = next_of(care_ws, "share_page")["data"]
        assert page["page"] == {"url": "", "title": "申辦服務"}
        frame = next_of(care_ws, "share_frame")["data"]["frame"]
        assert frame == {"width": 390, "height": 760, "image": PNG, "overlays": [web], "title": "申辦服務"}

        # 中途打開也拿得到最近的畫面
        res = client.get(f"/api/share/{link_id}", headers=people["care"]).json()
        assert res["frame"] == frame and res["events"] == []

        # 照顧者點畫面上的位置
        body = {"action": "tap", "x": 120.5, "y": 300}
        assert client.post(f"/api/share/{link_id}/commands", json=body, headers=people["care"]).status_code == 200
        command = next_of(app, "command")
        assert command["action"] == "tap" and command["x"] == 120.5 and command["y"] == 300

        assert client.post(f"/api/share/{link_id}/commands", json={"action": "home"}, headers=people["care"]).status_code == 200
        assert next_of(app, "command")["action"] == "home"

        body = {"action": "type", "value": "王大明"}
        assert client.post(f"/api/share/{link_id}/commands", json=body, headers=people["care"]).status_code == 200
        assert next_of(app, "command")["value"] == "王大明"

        app.send_json({"type": "result", "command_id": command["command_id"], "ok": True, "message": "已按下「下一步」。"})
        assert next_of(care_ws, "share_result")["data"]["message"] == "已按下「下一步」。"


@pytest.mark.parametrize("frame", [
    {"type": "frame", "width": 390, "height": 760, "title": "沒有圖片"},
    {**app_frame(), "image": "javascript:alert(1)"},
    {**app_frame(), "image": "https://evil.example/a.png"},
    {**app_frame(), "width": 0},
    {**app_frame(), "overlays": [{"x": 0, "y": 0, "width": 10, "height": 10, "image": "data:text/html;base64,PGgxPg=="}]},
    {**app_frame(), "overlays": "不是清單"},
])
def test_bad_app_screens_are_ignored(client, people, frame):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws/share?token={token}") as app:
        app.receive_json()
        app.send_json(frame)
        app.send_json({"type": "ping"})
        assert next_of(app, "pong")
        res = client.get(f"/api/share/{link_id}", headers=people["care"]).json()
        assert res["frame"] is None


def test_app_screen_too_big_is_ignored(client, people, monkeypatch):
    monkeypatch.setattr(config, "SHARE_FRAME_MAX_BYTES", 1000)
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws/share?token={token}") as app:
        app.receive_json()
        app.send_json({**app_frame(), "image": PNG + "A" * 2000})
        app.send_json({"type": "ping"})
        assert next_of(app, "pong")
        assert client.get(f"/api/share/{link_id}", headers=people["care"]).json()["frame"] is None


def test_app_disconnect_clears_screen(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws:
        with client.websocket_connect(f"/ws/share?token={token}") as app:
            app.receive_json()
            app.send_json(app_frame())
            next_of(care_ws, "share_frame")
        left = next_of(care_ws, "share_page")["data"]
        assert left["page"] is None
    res = client.get(f"/api/share/{link_id}", headers=people["care"]).json()
    assert res["frame"] is None and res["page"] is None


@pytest.mark.parametrize("how", ["revoke", "logout", "idle"])
def test_link_ends_on_revoke_logout_or_idle(client, people, clock, how):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws?token={people['care_token']}") as care_ws:
        if how == "revoke":
            client.delete(f"/api/care/links/{link_id}", headers=people["elder"])
        elif how == "logout":
            client.post("/api/auth/logout", headers=people["elder"])
        else:
            clock.advance(minutes=config.LOGIN_IDLE_MINUTES, seconds=1)
            client.get("/api/auth/me", headers=people["care"])  # 照顧者還在使用
            housekeeping(client)
        event = next_of(care_ws, "link_closed")
        assert event["data"]["reason"] == {"revoke": "revoked", "logout": "ended", "idle": "expired"}[how]

    assert link_id not in store.state.shares
    assert client.post(f"/api/share/{link_id}/commands", json={"action": "back"}, headers=people["care"]).status_code == 403
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/share?token={token}") as agent:
            agent.receive_json()


def test_revoke_stops_elder_page(client, people):
    link_id, token = start_share(client, people)
    with client.websocket_connect(f"/ws/share?token={token}") as agent:
        agent.receive_json()
        res = client.delete(f"/api/care/links/{link_id}", headers=people["elder"]).json()
        assert res["speak"] == "已停止分享，王小美 看不到你的畫面了。"
        assert agent.receive_json() == {"type": "closed"}


# ---- 語音回答判斷 ----


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
