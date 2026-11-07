# 台北通無障礙輔助（a11y）

給「用不了」台北通的人：視障者、長輩、手不方便或不會打字的人。

| 功能 | 狀態 |
| --- | --- |
| A. 常見問題語音查詢：用講的問、用聽的聽答案 | 完成（電腦瀏覽器可測；台北通 App 內實測待做） |
| B. 照顧者代操作：QR code 授權、畫面與語音同步、語音同意、伺服器端確認 | 完成（電腦瀏覽器可測；台北通 App 內實測待做） |

和 `web/`（AI 語音助手）是分開的服務，不共用程式碼。和台北通 App 溝通的訊息格式與 `web/src/bridge/` 相同，用的都是 TownPass 已有的 Handler（`voice_listen`、`tts_speak`、`phone_call`），不需要改 App。

## 架構

```
手機（台北通 App 的 WebView）              後端（FastAPI）               台北通官方網站
frontend/*.html、js/*.js  ── GET /api/faq ──→ SQLite 資料庫 ←── 每 24 小時同步 ── 常見問題 API
  搜尋在手機上做，不用連網路
```

- 前端是純 HTML、CSS、JavaScript，沒有框架，不需要建置，也不載入任何外部檔案。
- 網頁打開時一次下載全部常見問題，之後的查詢都在手機上完成，切成飛航模式也查得到。
- 語音辨識與朗讀都由手機完成（台北通 App 的 `voice_listen`、`tts_speak`），不使用雲端服務。

照顧者代操作：

```
照顧者手機 ── HTTP：每一步送一則小事件 ──→ 後端（檢查授權、用固定模板產生提示句）── WebSocket 推送 ──→ 被照顧者手機
                                                                                                    同步顯示（唯讀）＋朗讀＋震動
```

- 同步的是「狀態」（第幾步、欄位內容），不是螢幕影像，手機與網路負擔都很小。
- 授權、同意、操作紀錄存在**後端記憶體**，不進資料庫；後端重開後要重新登入、重新產生數字碼（授權本來就只在被照顧者這一次登入期間有效）。
- 數字碼 6 位數、**5 分鐘**換一組、只能用一次；同一人輸入錯誤 5 次要等 1 分鐘。輸入正確後，被照顧者還要說「同意」才生效。
- 付款前伺服器端確認三件事：有同意紀錄、內容和同意時一樣（payload 雜湊）、同意只能用一次且 60 秒內有效。
- 被照顧者聽到的提示與同意摘要一律由後端產生；照顧者拿不到語音確認數字。

## 執行

需要 Python 3.11 以上。在 `a11y/` 資料夾：

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt     # Mac：.venv/bin/python
.venv/Scripts/python -m uvicorn backend.main:app --reload
```

開啟 http://localhost:8000 。第一次啟動會自動從官方網站同步常見問題（需要網路）；也可以手動同步：

```bash
.venv/Scripts/python -m backend.faq_sync
```

在電腦瀏覽器裡沒有台北通 App：按說話按鈕會出現輸入框，用打字代替說話；朗讀改用瀏覽器內建的語音。

照顧者代操作：開兩個分頁，一個「以王阿伯登入」、一個「以王小美登入」（登入存在 sessionStorage，兩個分頁互不影響）。
王阿伯按「讓家人幫我操作」→ 王小美輸入數字碼 → 王阿伯說「同意」→ 王小美開始幫忙繳停車費（模擬，demo 車牌 `ABC-1234` 金額 120 元）。
王小美頁的「Demo 工具」可以示範竄改金額被伺服器擋下。

## 測試

```bash
.venv/Scripts/python -m pytest          # 後端
node --test "tests/js/*.test.js"        # 前端的搜尋、語音指令、朗讀文字（Node.js 22）
```

## 環境變數

| 名稱 | 用途 | 預設 |
| --- | --- | --- |
| `A11Y_DB_PATH` | SQLite 檔案位置 | `backend/a11y.db` |
| `A11Y_FAQ_AUTO_SYNC` | 設成 `0` 就不自動同步常見問題 | `1` |

其他可調整的時間與次數在 `backend/config.py`。

## 資料來源

| 資料 | 來源 | 類型 |
| --- | --- | --- |
| 常見問題（51 題，只取中文） | [台北通官方網站｜功能教學與Q&A](https://id.taipei/tpcd/about/faq)，透過網站本身使用的公開 API 同步 | 官方公開資料，答案保留原文 |
| 搜尋用的關鍵字、同義詞 | `backend/data/faq_keywords.json`、`faq_synonyms.json` | 團隊整理（見 AI 使用聲明） |
| 王阿伯、王小美帳號、停車費金額、付款 | `backend/store.py`、`backend/actions.py` | 模擬（不會真的扣款） |

官方新增題目時，同步程式會列出「還沒有關鍵字」的題目，請補進 `faq_keywords.json`，存檔後立即生效。

## 第三方套件

| 套件 | 版本 | 授權 | 用途 |
| --- | --- | --- | --- |
| FastAPI | 0.162.0 | MIT | 後端 API |
| Uvicorn | 0.54.0 | BSD-3-Clause | 執行後端（含 WebSocket） |
| qrcode | 8.2 | BSD | 後端產生 QR code 的 SVG |
| SQLite | Python 內建 | 公共領域 | 資料庫 |
| pytest | 9.2.0 | MIT | 測試（不部署） |
| httpx | 0.28.1 | BSD-3-Clause | 測試（不部署） |

前端沒有使用任何套件。QR code 掃描用台北通 App 內建的 `qr_code_scan`。

## AI 使用聲明

- 開發階段使用 Claude Code 協助撰寫程式，並起草搜尋用的關鍵字與同義詞，經團隊確認。
- 執行時不使用任何 AI 或 LLM：搜尋用關鍵字比對、語音同意用固定規則判斷，提示語音都是固定模板。
