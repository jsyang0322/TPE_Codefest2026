# 台北通無障礙輔助（a11y）

給「用不了」台北通的人：視障者、長輩、手不方便或不會打字的人。

| 功能 | 狀態 |
| --- | --- |
| A. 常見問題語音查詢：用講的問、用聽的聽答案 | 完成（電腦瀏覽器可測；台北通 App 內實測待做） |
| B. 讓家人幫忙：家人看到長輩在台北通打開的服務畫面，並遠端幫忙點按、填寫 | 完成（電腦瀏覽器用模擬服務頁可測；台北通 App 內需要套用 `townpass/` 的修改） |

和 `web/`（AI 語音助手）是分開的服務，不共用程式碼。和台北通 App 溝通的訊息格式與 `web/src/bridge/` 相同。
功能 A 只用 TownPass 已有的 Handler（`voice_listen`、`tts_speak`、`phone_call`）；功能 B 另外需要 `townpass/a11y-share.patch`（新增 2 個 Handler，見 [townpass/README.md](townpass/README.md)）。

## 架構

```
手機（台北通 App 的 WebView）              後端（FastAPI）               台北通官方網站
frontend/*.html、js/*.js  ── GET /api/faq ──→ SQLite 資料庫 ←── 每 24 小時同步 ── 常見問題 API
  搜尋在手機上做，不用連網路
```

- 前端是純 HTML、CSS、JavaScript，沒有框架，不需要建置。
- 網頁打開時一次下載全部常見問題，之後的查詢都在手機上完成，切成飛航模式也查得到。
- 語音辨識與朗讀都由手機完成（台北通 App 的 `voice_listen`、`tts_speak`），不使用雲端服務。

讓家人幫忙（分享畫面）：

```
長輩手機：台北通打開的服務網頁                後端                       家人手機：caregiver.html
  分享程式（App 放進網頁）── 畫面變化 /ws/share ──→ 轉送、暫存最近的完整畫面 ── /ws ──→ rrweb 重播同一個畫面
  執行點按、填寫  ←────────── 指令 ────────── POST /api/share/{id}/commands ←── 家人點畫面
```

1. 長輩產生 6 位數字碼與 QR code（**5 分鐘**換一組、只能用一次；同一人輸入錯 5 次要等 1 分鐘），家人輸入後，長輩說或按「同意」。
2. 長輩的頁面把「rrweb 錄製程式＋分享程式（`frontend/js/share-agent.js`）＋token」交給 App，
   App 放進之後打開的每個服務網頁。電腦測試時，模擬服務頁（`frontend/demo/service.html`）自己載入分享程式。
3. 分享程式用開源的 rrweb 記錄**頁面的結構與變化**（不是影片），手機與網路負擔都很小；密碼欄位不會被記錄。
4. 家人點畫面上的按鈕，長輩的手機就按同一個按鈕，並標出位置、念出「王小美 按了『下一步』」；點輸入框可以幫忙填寫。
5. **送出、付款、確認、申請、刪除**這類按鈕，長輩的手機會先問「王小美 想幫你按『送出申請』，同意嗎？」，同意才按。
   這個問題顯示在長輩手機的封閉 Shadow DOM 裡，家人的指令點不到它。密碼欄位家人不能填。
6. 長輩隨時可以按畫面下方的「停止分享」或說「停止分享」；登出、閒置 30 分鐘也會結束。
7. 授權與分享狀態存在**後端記憶體**，不進資料庫；後端重開後要重新登入、重新綁定。

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

讓家人幫忙：開兩個瀏覽器視窗（`Ctrl`＋`N`）左右並排，一個「以王阿伯登入」、一個「以王小美登入」（登入存在 sessionStorage，兩個視窗互不影響）。
王阿伯按「讓家人幫我」→ 王小美輸入數字碼 → 王阿伯按「同意」→ 王阿伯按「模擬服務頁（測試用）」→
王小美按「看 王阿伯 的畫面」，點畫面上的欄位與按鈕。按「送出申請」時，王阿伯的視窗會先問他。

## 部署（iPhone 的台北通只能連 https）

**做法一：Cloud Run**（主辦單位建議，免費額度內）。在 `a11y/` 執行：

```bash
gcloud run deploy a11y --source . --region asia-east1 --allow-unauthenticated --max-instances 1 --timeout 3600
```

`--max-instances 1`：狀態存在記憶體，只能有一台；`--timeout 3600`：分享畫面用的 WebSocket 要能連久一點。
完成後得到 `https://a11y-xxxx.asia-east1.run.app`，TownPass 用 `--dart-define=A11Y_URL=https://a11y-xxxx.asia-east1.run.app/` 執行。

**做法二：在 Mac 上跑，iPhone 連同一個 Wi-Fi**（用開源的 mkcert 產生憑證）：

```bash
brew install mkcert && mkcert -install
mkcert 192.168.1.23          # 換成 Mac 的區網 IP，產生 192.168.1.23.pem 與 192.168.1.23-key.pem
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8443 \
  --ssl-certfile 192.168.1.23.pem --ssl-keyfile 192.168.1.23-key.pem
```

把 `$(mkcert -CAROOT)/rootCA.pem` 用 AirDrop 傳到 iPhone 安裝，再到「設定 → 一般 → 關於本機 → 憑證信任設定」打開它。
TownPass 用 `--dart-define=A11Y_URL=https://192.168.1.23:8443/` 執行。

## 測試

```bash
.venv/Scripts/python -m pytest          # 後端（綁定、分享畫面、遠端操作、停止分享、常見問題）
node --test "tests/js/*.test.js"        # 前端的搜尋、語音指令、朗讀文字（Node.js 22）
```

## 環境變數

| 名稱 | 用途 | 預設 |
| --- | --- | --- |
| `A11Y_DB_PATH` | SQLite 檔案位置 | `backend/a11y.db`（Docker 裡是 `/tmp/a11y.db`） |
| `A11Y_FAQ_AUTO_SYNC` | 設成 `0` 就不自動同步常見問題 | `1` |
| `PORT` | Docker／Cloud Run 的連接埠 | `8080` |

其他可調整的時間與次數在 `backend/config.py`。TownPass 端的網址用 `--dart-define=A11Y_URL=...` 指定。

## 資料來源

| 資料 | 來源 | 類型 |
| --- | --- | --- |
| 常見問題（51 題，只取中文） | [台北通官方網站｜功能教學與Q&A](https://id.taipei/tpcd/about/faq)，透過網站本身使用的公開 API 同步 | 官方公開資料，答案保留原文 |
| 搜尋用的關鍵字、同義詞 | `backend/data/faq_keywords.json`、`faq_synonyms.json` | 團隊整理（見 AI 使用聲明） |
| 王阿伯、王小美帳號 | `backend/store.py` | 模擬 |
| 模擬服務頁（市民服務申辦） | `frontend/demo/service.html` | 模擬（電腦測試用，不會真的送出） |

官方新增題目時，同步程式會列出「還沒有關鍵字」的題目，請補進 `faq_keywords.json`，存檔後立即生效。

## 第三方套件

| 套件 | 版本 | 授權 | 用途 |
| --- | --- | --- | --- |
| FastAPI | 0.162.0 | MIT | 後端 API |
| Uvicorn | 0.54.0 | BSD-3-Clause | 執行後端（含 WebSocket） |
| qrcode | 8.2 | BSD | 後端產生 QR code 的 SVG |
| rrweb（`@rrweb/record`、`@rrweb/replay`） | 2.1.7 | MIT | 分享畫面：記錄與重播網頁的變化。檔案放在 `frontend/vendor/rrweb/`（未修改，附 LICENSE） |
| SQLite | Python 內建 | 公共領域 | 資料庫 |
| pytest | 9.2.0 | MIT | 測試（不部署） |
| httpx | 0.28.1 | BSD-3-Clause | 測試（不部署） |
| mkcert | 1.4 以上 | BSD-3-Clause | 選用：在 Mac 上產生 https 憑證（不部署） |

QR code 掃描用台北通 App 內建的 `qr_code_scan`。

## AI 使用聲明

- 開發階段使用 Claude Code 協助撰寫程式，並起草搜尋用的關鍵字與同義詞，經團隊確認。
- 執行時不使用任何 AI 或 LLM：搜尋用關鍵字比對、同意用固定規則判斷，提示語音都是固定模板。
