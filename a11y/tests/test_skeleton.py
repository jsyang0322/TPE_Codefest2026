"""專案骨架：首頁、資料表、背景工作。"""

import asyncio

from backend import db, main


def test_index_page_is_served(client):
    res = client.get("/")
    assert res.status_code == 200
    assert '<html lang="zh-Hant-TW">' in res.text
    assert 'id="announce-polite"' in res.text
    assert 'id="announce-assertive"' in res.text


def test_static_files_are_served(client):
    assert client.get("/css/base.css").status_code == 200
    js = client.get("/js/faq-search.js")
    assert js.status_code == 200
    # <script type="module"> 需要正確的 MIME type
    assert js.headers["content-type"].startswith("text/javascript")


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_database_only_has_faq_tables(client):
    with db.transaction() as conn:
        tables = {row["name"] for row in db.fetch_all(conn, "SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"faqs", "faq_sync", "faq_logs"} <= tables
    assert "users" not in tables  # 讓家人幫忙不用資料庫


def test_init_twice_keeps_data(client):
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO faqs (category, question, answer_json, sort_order, updated_at) VALUES ('c', 'q', '[]', 0, 'now')"
        )
    db.init()
    with db.transaction() as conn:
        assert db.fetch_one(conn, "SELECT COUNT(*) AS n FROM faqs")["n"] == 1


def test_now_is_utc_iso8601():
    value = db.now()
    assert value.endswith("+00:00")
    assert "T" in value


def test_housekeeping_job_failure_does_not_stop_others(monkeypatch):
    ran = []

    def broken():
        raise RuntimeError("boom")

    def ok():
        ran.append("ok")

    async def ok_async():
        ran.append("async")

    monkeypatch.setattr(main, "HOUSEKEEPING_JOBS", [broken, ok, ok_async])
    asyncio.run(main.run_housekeeping_once())
    assert ran == ["ok", "async"]
