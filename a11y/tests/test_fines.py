"""示範服務「交通罰單」：長輩同意時產生假罰單、繳費、重新同意時重置。"""

from test_care import active_link, login, people  # noqa: F401（people 是 fixture）


def unpaid(client, headers=None):
    body = client.get("/api/fines", headers=headers or {}).json()
    return [fine for fine in body["fines"] if fine["status"] == "unpaid"]


def test_without_login_shows_demo_elder(client):
    body = client.get("/api/fines").json()
    assert body["owner"] == {"name": "王阿伯", "plate": "ABC-1234"}
    assert [fine["status"] for fine in body["fines"]] == ["unpaid", "unpaid", "paid"]
    assert [method["id"] for method in body["methods"]] == ["card", "bank"]
    first = body["fines"][0]
    assert first["amount"] == 600 and first["due"] > first["time"]


def test_pay_once(client):
    res = client.post("/api/fines/f1/pay", json={"method": "card"})
    assert res.status_code == 200
    fine = res.json()["fine"]
    assert fine["status"] == "paid" and fine["receipt_no"].startswith("R") and fine["method"].startswith("信用卡")
    assert [fine["id"] for fine in unpaid(client)] == ["f2"]

    again = client.post("/api/fines/f1/pay", json={"method": "card"})
    assert again.status_code == 409 and again.json()["message"] == "這張罰單已經繳過了"
    assert client.post("/api/fines/nope/pay", json={"method": "card"}).status_code == 404
    assert client.post("/api/fines/f2/pay", json={"method": "cash"}).status_code == 422


def test_elder_agreeing_resets_fines(client, people):  # noqa: F811
    client.post("/api/fines/f1/pay", json={"method": "bank"})
    client.post("/api/fines/f2/pay", json={"method": "bank"})
    assert unpaid(client) == []

    active_link(client, people)
    assert [fine["id"] for fine in unpaid(client, people["elder"])] == ["f1", "f2"]


def test_caregiver_login_still_shows_elder_fines(client):
    headers, _ = login(client, "caregiver-1")
    assert client.get("/api/fines", headers=headers).json()["owner"]["name"] == "王阿伯"
