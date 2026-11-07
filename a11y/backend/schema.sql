-- 資料表定義。資料庫只存常見問題；照顧者代操作的狀態存在後端記憶體，不進資料庫。
-- 所有時間以 UTC ISO 8601 字串儲存（db.now()）。

-- 常見問題：內容由 faq_sync.py 從台北通官方網站同步，答案保留官方原文（只取中文）
CREATE TABLE IF NOT EXISTS faqs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,                -- 官方分類，例如「登入註冊」
  question    TEXT NOT NULL UNIQUE,         -- 同步時用問題文字對應同一題
  answer_json TEXT NOT NULL,                -- 官方答案，一段一個字串的 JSON 陣列
  sort_order  INTEGER NOT NULL,             -- 官方網站上的順序
  popularity  INTEGER NOT NULL DEFAULT 0,   -- 被選來看答案的次數，用來排「大家常問」
  updated_at  TEXT NOT NULL
);

-- 最後一次同步（只有一列）
CREATE TABLE IF NOT EXISTS faq_sync (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  source_name TEXT NOT NULL,
  source_url  TEXT NOT NULL,
  synced_at   TEXT NOT NULL,
  total       INTEGER NOT NULL
);

-- 查詢紀錄：只存文字，不存錄音、不存使用者身分。用來找出「常問卻找不到答案」的問題
CREATE TABLE IF NOT EXISTS faq_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  query_text    TEXT NOT NULL,
  matched       INTEGER NOT NULL,
  chosen_faq_id INTEGER,
  created_at    TEXT NOT NULL
);
