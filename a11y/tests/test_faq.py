"""功能 A 後端：整理官方資料、同步進資料庫、下載與回饋 API。測試不連官方網站。"""

import json

import pytest

from backend import db, faq, faq_sync
from backend.faq_sync import OfficialFaq, SyncError, clean_answer, clean_question

# ---- 整理官方資料（格式照官方 API：中文在前、英文在後） ----


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("一定需要實名認證？ Does signing up require verification?", "一定需要實名認證？"),
        ("如何修改台北通會員資料?How to modify membership information?", "如何修改台北通會員資料？"),
        ("為什麼我登入後只有看到一個QR Code? Why do I see only one QR code?", "為什麼我登入後只有看到一個QR Code？"),
        ("如何處理？為什麼會出現傳送失敗？ I didn't receive my email？", "如何處理？為什麼會出現傳送失敗？"),
        ("什麼是快速登入？如何在台北通APP設定？ What is Fast Login?", "什麼是快速登入？如何在台北通APP設定？"),
        ("這是什麼意思 What does this mean", "這是什麼意思"),
        ("顯示姓名錯誤怎麼辦&nbsp;? What if there's an error?", "顯示姓名錯誤怎麼辦？"),
    ],
)
def test_clean_question(raw, expected):
    assert clean_question(raw) == expected


def test_clean_answer_keeps_chinese_and_urls_and_stops_at_english():
    raw = (
        "<p>只能刪除帳號。<br>​若有需求請致電客服1999。<br>網址如下:<br>"
        '<a href="https://service.taipei/case-detail/AW004">https://service.taipei/case-detail/AW004</a><br>&nbsp;</p>'
        "<p>You can only delete the account. Please call customer service.</p>"
        "<p>Link to the Taipei Serve:</p>"
    )
    assert clean_answer(raw) == [
        "只能刪除帳號。",
        "若有需求請致電客服1999。",
        "網址如下:",
        "https://service.taipei/case-detail/AW004",
    ]


def test_clean_answer_keeps_link_text():
    raw = '<p>詳請參考<a href="/tpcd/about/faq/tutorial">操作步驟</a>。</p><p>Please refer to the instructions here.</p>'
    assert clean_answer(raw) == ["詳請參考操作步驟。"]


# ---- 分段 ----


def test_to_segments_merges_short_paragraphs():
    assert faq.to_segments(["第一句。", "第二句。"]) == ["第一句。\n第二句。"]


def test_to_segments_splits_long_paragraphs():
    long_a, long_b = "甲" * 60, "乙" * 60
    assert faq.to_segments([long_a, long_b]) == [long_a, long_b]


def test_to_segments_keeps_colon_with_next():
    head, body = "操作步驟如下：", "丙" * 79
    assert faq.to_segments([head, body]) == [head + "\n" + body]


# ---- 同步進資料庫 ----

SAMPLE = [
    OfficialFaq("登入註冊", "帳號輸入錯誤幾次會被鎖定？", ["錯誤 3 次將被鎖定 15 分鐘。"]),
    OfficialFaq("優惠", "如何使用優惠券？", ["出示優惠券畫面即可。"]),
]


def test_store_adds_updates_and_removes(client):
    first = faq_sync.store(SAMPLE)
    assert (first.total, first.added, first.updated, first.removed) == (2, 2, 0, 0)

    changed = [
        OfficialFaq("登入註冊", "帳號輸入錯誤幾次會被鎖定？", ["錯誤 5 次將被鎖定。"]),
        OfficialFaq("服務", "如何取消訂閱？", ["到設定關閉。"]),
    ]
    second = faq_sync.store(changed)
    assert (second.total, second.added, second.updated, second.removed) == (2, 1, 1, 1)

    with db.transaction() as conn:
        rows = db.fetch_all(conn, "SELECT question, answer_json FROM faqs ORDER BY sort_order")
    assert [r["question"] for r in rows] == ["帳號輸入錯誤幾次會被鎖定？", "如何取消訂閱？"]
    assert json.loads(rows[0]["answer_json"]) == ["錯誤 5 次將被鎖定。"]


def test_store_keeps_popularity(client):
    faq_sync.store(SAMPLE)
    with db.transaction() as conn:
        conn.execute("UPDATE faqs SET popularity = 7 WHERE question = '如何使用優惠券？'")
    faq_sync.store(SAMPLE)
    with db.transaction() as conn:
        row = db.fetch_one(conn, "SELECT popularity FROM faqs WHERE question = '如何使用優惠券？'")
    assert row["popularity"] == 7


def test_store_refuses_empty_result(client):
    faq_sync.store(SAMPLE)
    with pytest.raises(SyncError):
        faq_sync.store([])
    with db.transaction() as conn:
        assert db.fetch_one(conn, "SELECT COUNT(*) AS n FROM faqs")["n"] == 2


def test_needs_sync(client):
    assert faq_sync.needs_sync() is True
    faq_sync.store(SAMPLE)
    assert faq_sync.needs_sync() is False


# ---- API ----


def test_get_all_returns_segments_keywords_synonyms_and_source(client, monkeypatch):
    monkeypatch.setattr(faq, "load_keywords", lambda: {"如何使用優惠券？": ["優惠券", "怎麼用"]})
    faq_sync.store(SAMPLE)

    body = client.get("/api/faq").json()
    assert body["categories"] == ["登入註冊", "優惠"]
    assert body["source"]["url"] == faq_sync.SOURCE_URL
    assert body["source"]["synced_at"]
    assert "登入" in body["synonyms"]

    coupon = next(item for item in body["faqs"] if item["question"] == "如何使用優惠券？")
    assert coupon["segments"] == ["出示優惠券畫面即可。"]
    assert coupon["keywords"] == ["優惠券", "怎麼用"]
    assert coupon["popularity"] == 0


def test_get_all_before_first_sync(client):
    body = client.get("/api/faq").json()
    assert body["faqs"] == []
    assert body["source"]["synced_at"] is None


def test_feedback_logs_query_and_counts_popularity(client):
    faq_sync.store(SAMPLE)
    faq_id = client.get("/api/faq").json()["faqs"][1]["id"]

    assert client.post("/api/faq/feedback", json={"query": "優惠券怎麼用", "matched": True, "chosen_faq_id": faq_id}).json() == {"ok": True}
    client.post("/api/faq/feedback", json={"query": "今天天氣如何", "matched": False})
    client.post("/api/faq/feedback", json={"chosen_faq_id": faq_id})  # 直接點「大家常問」：只加次數、不記錄

    with db.transaction() as conn:
        logs = db.fetch_all(conn, "SELECT query_text, matched, chosen_faq_id FROM faq_logs ORDER BY id")
        popularity = db.fetch_one(conn, "SELECT popularity FROM faqs WHERE id = ?", (faq_id,))["popularity"]
    assert logs == [
        {"query_text": "優惠券怎麼用", "matched": 1, "chosen_faq_id": faq_id},
        {"query_text": "今天天氣如何", "matched": 0, "chosen_faq_id": None},
    ]
    assert popularity == 2


def test_feedback_rejects_long_query(client):
    assert client.post("/api/faq/feedback", json={"query": "長" * 201}).status_code == 422


# ---- 我們整理的資料檔 ----


def test_keyword_and_synonym_files_are_well_formed():
    keywords = faq.load_keywords()
    assert len(keywords) >= 10
    for question, words in keywords.items():
        assert question and words and all(isinstance(w, str) and w for w in words)
    for standard, spoken in faq.load_synonyms().items():
        assert standard and spoken and all(isinstance(s, str) and s for s in spoken)
