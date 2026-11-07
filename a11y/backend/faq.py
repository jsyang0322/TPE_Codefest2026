"""功能 A：常見問題語音查詢的後端。

- 題目與答案：faq_sync.py 從台北通官方網站同步進資料庫（官方原文）。
- 關鍵字與同義詞：我們開發時整理的搜尋設定，放在 data/*.json，方便審閱與修改，改完立即生效。

搜尋在手機上的網頁裡做（frontend/js/faq-search.js）：網頁打開時用 GET /api/faq 一次下載全部，
之後每次查詢都不用連網路，飛航模式也查得到。
"""

import json

from fastapi import APIRouter
from pydantic import BaseModel, Field

from . import config, db, faq_sync

router = APIRouter(prefix="/api/faq", tags=["faq"])

KEYWORDS_PATH = config.DATA_DIR / "faq_keywords.json"
SYNONYMS_PATH = config.DATA_DIR / "faq_synonyms.json"

# 一次念多少字。太短要一直說「下一段」，太長聽不完
SEGMENT_MAX_CHARS = 80


def load_keywords() -> dict[str, list[str]]:
    """{ 完整問題: [關鍵字, …] }"""
    return json.loads(KEYWORDS_PATH.read_text(encoding="utf-8"))


def load_synonyms() -> dict[str, list[str]]:
    """{ 標準詞: [口語說法, …] }"""
    return json.loads(SYNONYMS_PATH.read_text(encoding="utf-8"))


def to_segments(paragraphs: list[str], max_chars: int = SEGMENT_MAX_CHARS) -> list[str]:
    """把官方答案的段落合併成適合一次念完的段，段內用換行分隔。

    以「：」結尾的段落（例如「操作步驟如下：」）一定和下一段放在一起。
    """
    segments: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if not current:
            current = paragraph
        elif current.endswith(("：", ":")) or len(current) + 1 + len(paragraph) <= max_chars:
            current += "\n" + paragraph
        else:
            segments.append(current)
            current = paragraph
    if current:
        segments.append(current)
    return segments


def questions_without_keywords() -> list[str]:
    keywords = load_keywords()
    with db.transaction() as conn:
        rows = db.fetch_all(conn, "SELECT question FROM faqs ORDER BY sort_order")
    return [row["question"] for row in rows if not keywords.get(row["question"])]


@router.get("")
def get_all() -> dict:
    """網頁一次下載全部常見問題、關鍵字與同義詞。"""
    keywords = load_keywords()
    with db.transaction() as conn:
        rows = db.fetch_all(
            conn, "SELECT id, category, question, answer_json, popularity FROM faqs ORDER BY sort_order"
        )
    record = faq_sync.last_sync()

    categories: list[str] = []
    faqs = []
    for row in rows:
        if row["category"] not in categories:
            categories.append(row["category"])
        faqs.append({
            "id": row["id"],
            "category": row["category"],
            "question": row["question"],
            "segments": to_segments(json.loads(row["answer_json"])),
            "keywords": keywords.get(row["question"], []),
            "popularity": row["popularity"],
        })

    return {
        "source": {
            "name": faq_sync.SOURCE_NAME,
            "url": faq_sync.SOURCE_URL,
            "synced_at": record["synced_at"] if record else None,
        },
        "categories": categories,
        "faqs": faqs,
        "synonyms": load_synonyms(),
    }


class Feedback(BaseModel):
    # 使用者說的話或打的字；直接點「大家常問」「全部問題」時沒有查詢文字
    query: str = Field(default="", max_length=200)
    matched: bool = True
    chosen_faq_id: int | None = None


@router.post("/feedback")
def feedback(body: Feedback) -> dict:
    """記錄查詢文字（不存錄音、不存身分），並把被選的題目 popularity 加 1。"""
    query = body.query.strip()
    with db.transaction() as conn:
        if query:
            conn.execute(
                "INSERT INTO faq_logs (query_text, matched, chosen_faq_id, created_at) VALUES (?, ?, ?, ?)",
                (query, int(body.matched), body.chosen_faq_id, db.now()),
            )
        if body.chosen_faq_id is not None:
            conn.execute("UPDATE faqs SET popularity = popularity + 1 WHERE id = ?", (body.chosen_faq_id,))
    return {"ok": True}
