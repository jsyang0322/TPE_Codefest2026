"""所有可調整的時間與數值（規格第二部分第 3.4 節），以及檔案路徑。"""

import os
from pathlib import Path

# ---- 路徑 ----

BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
DATA_DIR = BACKEND_DIR / "data"
SCHEMA_PATH = BACKEND_DIR / "schema.sql"

# SQLite 檔案。測試時改成暫存檔；正式上線可換成 PostgreSQL。
DB_PATH = Path(os.environ.get("A11Y_DB_PATH", BACKEND_DIR / "a11y.db"))

# ---- 常見問題同步（faq_sync.py） ----

FAQ_AUTO_SYNC = os.environ.get("A11Y_FAQ_AUTO_SYNC", "1") != "0"  # 設成 0 就只能手動同步
FAQ_SYNC_INTERVAL_HOURS = 24        # 多久從官方網站同步一次
FAQ_SYNC_RETRY_MINUTES = 10         # 同步失敗（例如沒有網路）時多久後再試
FAQ_SYNC_TIMEOUT_SECONDS = 20       # 呼叫官方 API 的逾時

# ---- 讓家人幫忙：時間與次數 ----

BIND_CODE_TTL_SECONDS = 300         # 綁定碼有效時間：5 分鐘，長輩唸給家人聽不用趕
BIND_CODE_MAX_FAILURES = 5          # 同一人輸入錯誤幾次後要等一下（防止亂猜）
BIND_CODE_LOCK_SECONDS = 60         # 輸入錯誤太多次要等多久
LINK_CONFIRM_TTL_SECONDS = 120      # 照顧者輸入數字碼後，等被照顧者同意的時間
LOGIN_IDLE_MINUTES = 30             # 登入閒置多久自動登出（待團隊確認）
VOICE_LISTEN_SECONDS = 8            # 系統問完問題後自動開麥克風的秒數（前端使用）

# ---- 分享畫面 ----

SHARE_BUFFER_MAX_BYTES = 4_000_000  # 後端最多暫存多少畫面資料；超過就請手機重新送一次完整畫面
SHARE_SNAPSHOT_MIN_SECONDS = 10     # 兩次「請重新送完整畫面」之間至少隔幾秒
SHARE_INPUT_MAX_LENGTH = 500        # 照顧者一次最多填幾個字

HOUSEKEEPING_INTERVAL_SECONDS = 5   # 背景工作多久執行一次
