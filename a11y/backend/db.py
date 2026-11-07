"""SQLite 連線、初始化與共用查詢工具。

用 Python 內建的 sqlite3，不需要另外安裝資料庫。每次操作開一個新連線，
用 `with db.transaction() as conn:` 包起來，成功自動 commit、失敗自動 rollback。
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config


def now() -> str:
    """目前時間，UTC ISO 8601 字串。格式固定，所以字串可以直接比大小。"""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    """建立資料表。重複執行不會出錯，也不會清掉既有資料。"""
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with transaction() as conn:
        # WAL：背景同步和 API 同時讀寫時比較不會互相卡住
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(config.SCHEMA_PATH.read_text(encoding="utf-8"))


def fetch_one(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> dict | None:
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def fetch_all(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(row) for row in conn.execute(sql, params).fetchall()]
