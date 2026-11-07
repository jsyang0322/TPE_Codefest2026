"""從台北通官方網站同步常見問題到資料庫。

資料來源：台北通官方網站「功能教學與Q&A › Q & A・常見問題」 https://id.taipei/tpcd/about/faq
這個頁面本身就是用下面兩個公開 API 載入問答，我們呼叫同樣的 API：
    分類  GET https://id.taipei/tpcd/api/latest/faq/qa/category
    問答  GET https://id.taipei/tpcd/api/latest/faq/qa/list?category=<分類 id>&page=<頁>&size=<筆數>

官方問答是中英對照，這裡只保留中文；答案保留官方原文，不改寫。

手動同步（在 a11y/ 資料夾執行）：
    .venv/Scripts/python -m backend.faq_sync
後端啟動後也會自動同步（見 main.py 的 faq_sync_loop）。
"""

import html
import json
import logging
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import config, db

log = logging.getLogger("a11y.faq_sync")

SOURCE_NAME = "台北通官方網站｜功能教學與Q&A"
SOURCE_URL = "https://id.taipei/tpcd/about/faq"
API_BASE = "https://id.taipei/tpcd/api/latest/faq/qa"
USER_AGENT = "TaipeiPass-a11y-faq-sync/0.1 (TPE_Codefest2026)"
PAGE_SIZE = 50
MAX_PAGES = 20  # API 異常時不會無限翻頁

# 中文字與全形標點
CJK = re.compile(r"[　-〿㐀-鿿＀-￯]")
URL_ONLY = re.compile(r"^https?://\S+$")
# 問題格式是「中文問題？ English question?」：找「問號或句號後面接英文句子」的地方切開。
# 英文句子開頭是大寫字母接小寫（What、How）或「I 」「I'」；
# 「APP」「QR Code」這類中文問題裡的英文是大寫連在一起或前面沒有問號，不會被切到。
ZH_EN_BOUNDARY = re.compile(r"[？?。](?=\s*[A-Z](?:[a-z]|['’ ]))")


class SyncError(Exception):
    pass


@dataclass
class OfficialFaq:
    category: str
    question: str
    paragraphs: list[str]


@dataclass
class SyncResult:
    total: int
    added: int
    updated: int
    removed: int


# ---- 整理官方資料 ----

def _plain(fragment: str) -> str:
    """HTML 片段轉成純文字。"""
    text = re.sub(r"<[^>]+>", "", fragment)
    text = html.unescape(text).replace("\xa0", " ").replace("​", "")
    return re.sub(r"\s+", " ", text).strip()


def _is_chinese(text: str) -> bool:
    return len(CJK.findall(text)) >= 2 and len(CJK.findall(text)) / len(text) >= 0.15


def clean_question(raw: str) -> str:
    """「中文問題？ English question?」只留中文問題。"""
    text = _plain(raw)
    boundary = ZH_EN_BOUNDARY.search(text)
    if boundary:
        text = text[: boundary.end()]
    else:
        # 沒有問號，例如「這是什麼意思 What does…」：從最後一個中文字之後切掉
        last = max((m.end() for m in CJK.finditer(text)), default=len(text))
        text = text[:last]
    text = re.sub(r"\s+([？?。])$", r"\1", text.strip())
    return text[:-1] + "？" if text.endswith("?") else text


def clean_answer(raw_html: str) -> list[str]:
    """官方答案的中文段落。中文段落之間的網址（例如「網址如下：」的下一行）會保留；遇到英文段落就停。"""
    paragraphs: list[str] = []
    for part in re.split(r"(?i)</p\s*>|<br\s*/?>", raw_html):
        text = _plain(part)
        if not text:
            continue
        if _is_chinese(text):
            paragraphs.append(text)
        elif URL_ONLY.match(text):
            if paragraphs:
                paragraphs.append(text)
        elif paragraphs and len(re.findall(r"[A-Za-z]{2,}", text)) >= 3:
            break  # 英文段落開始
    return paragraphs


# ---- 呼叫官方 API ----

def _get(path: str, **params) -> dict:
    url = API_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=config.FAQ_SYNC_TIMEOUT_SECONDS) as response:
        body = json.load(response)
    if body.get("status") != 0:
        raise SyncError(f"官方 API 回應錯誤：{body.get('name')}")
    return body


def fetch_official() -> list[OfficialFaq]:
    """依官方網站上的分類與順序抓回全部問答。"""
    faqs: list[OfficialFaq] = []
    for category in sorted(_get("/category")["data"], key=lambda c: c.get("seq", 0)):
        for page in range(1, MAX_PAGES + 1):
            body = _get("/list", category=category["id"], page=page, size=PAGE_SIZE)
            for item in body.get("data") or []:
                question = clean_question(item.get("question", ""))
                paragraphs = clean_answer(item.get("answer", ""))
                if question and paragraphs:
                    faqs.append(OfficialFaq(category["name"], question, paragraphs))
            if page >= body.get("maxPages", 1):
                break
    return faqs


# ---- 存進資料庫 ----

def store(faqs: list[OfficialFaq]) -> SyncResult:
    """新增、更新、移除，讓資料庫和官方一致。被點選次數（popularity）會保留。"""
    if not faqs:
        raise SyncError("官方網站沒有回傳任何常見問題，保留原本的資料")

    timestamp = db.now()
    added = updated = 0
    with db.transaction() as conn:
        existing = {
            row["question"]: row
            for row in db.fetch_all(conn, "SELECT id, question, category, answer_json, sort_order FROM faqs")
        }
        seen: set[str] = set()
        for faq in faqs:
            if faq.question in seen:  # 同一題出現在兩個分類時只留第一個
                continue
            order = len(seen)
            seen.add(faq.question)
            answer_json = json.dumps(faq.paragraphs, ensure_ascii=False)
            old = existing.get(faq.question)
            if old is None:
                conn.execute(
                    "INSERT INTO faqs (category, question, answer_json, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (faq.category, faq.question, answer_json, order, timestamp),
                )
                added += 1
            elif (old["category"], old["answer_json"], old["sort_order"]) != (faq.category, answer_json, order):
                conn.execute(
                    "UPDATE faqs SET category = ?, answer_json = ?, sort_order = ?, updated_at = ? WHERE id = ?",
                    (faq.category, answer_json, order, timestamp, old["id"]),
                )
                updated += 1

        removed = [question for question in existing if question not in seen]
        conn.executemany("DELETE FROM faqs WHERE question = ?", [(q,) for q in removed])

        conn.execute(
            """INSERT INTO faq_sync (id, source_name, source_url, synced_at, total) VALUES (1, ?, ?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET source_name = excluded.source_name, source_url = excluded.source_url,
               synced_at = excluded.synced_at, total = excluded.total""",
            (SOURCE_NAME, SOURCE_URL, timestamp, len(seen)),
        )
    return SyncResult(total=len(seen), added=added, updated=updated, removed=len(removed))


def sync() -> SyncResult:
    result = store(fetch_official())
    log.info("FAQ 同步完成：共 %d 題（新增 %d、更新 %d、移除 %d）", result.total, result.added, result.updated, result.removed)
    return result


def last_sync() -> dict | None:
    with db.transaction() as conn:
        return db.fetch_one(conn, "SELECT source_name, source_url, synced_at, total FROM faq_sync WHERE id = 1")


def needs_sync() -> bool:
    record = last_sync()
    if record is None:
        return True
    synced_at = datetime.fromisoformat(record["synced_at"])
    return datetime.now(timezone.utc) - synced_at >= timedelta(hours=config.FAQ_SYNC_INTERVAL_HOURS)


if __name__ == "__main__":
    # Windows 終端機預設是 cp950，遇到印不出來的字改成「?」，不要整個中斷
    sys.stdout.reconfigure(errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    from . import faq  # 避免循環 import

    db.init()
    result = sync()
    print(f"同步完成：共 {result.total} 題（新增 {result.added}、更新 {result.updated}、移除 {result.removed}）")
    missing = faq.questions_without_keywords()
    if missing:
        print(f"下列 {len(missing)} 題還沒有關鍵字，用講的問時找不到它們，請補進 backend/data/faq_keywords.json：")
        for question in missing:
            print("  -", question)
