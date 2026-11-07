# 台北通無障礙輔助（a11y）

給「用不了」台北通的人：視障者、長輩、手不方便或不會打字的人。

| 功能 | 狀態 |
| --- | --- |
| A. 常見問題語音查詢：用講的問、用聽的聽答案 | 完成（電腦瀏覽器可測；台北通 App 內實測待做） |
| B. 讓家人幫忙：家人看到長輩**整個台北通的畫面**，並遠端幫忙點按、打字 | 完成（台北通 App 要套用 `townpass/` 的修改，iPhone 實測待做；電腦瀏覽器用模擬服務頁可測） |
| 示範服務「交通罰單」：家人遠端幫長輩繳罰單（假資料，不會真的付款） | 完成（台北通首頁有「交通罰單」入口；電腦瀏覽器可測，iPhone 實測待做） |

文件：[開發說明](DEVELOPMENT.md)、[iPhone 實機測試手冊](IPHONE_TESTING.md)、[Demo 教學](DEMO.md)。

和 `web/`（AI 語音助手）是分開的服務，不共用程式碼。和台北通 App 溝通的訊息格式與 `web/src/bridge/` 相同。
功能 A 只用 TownPass 已有的 Handler（`voice_listen`、`tts_speak`、`phone_call`）；功能 B 另外需要 `townpass/a11y-share.patch`（App 拍畫面、執行家人的操作，見 [townpass/README.md](townpass/README.md)）。

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
長輩手機：台北通 App                         後端                       家人手機：caregiver.html
  拍下整個 App 的畫面 ── 畫面 /ws/share ──→ 轉送、暫存最近的畫面 ── /ws ──→ 顯示同一個畫面
  在同一個位置點按、打字 ←───── 指令 ───── POST /api/share/{id}/commands ←── 家人點畫面
```

1. 長輩產生 6 位數字碼（**5 分鐘**換一組、只能用一次；同一人輸入錯 5 次要等 1 分鐘），家人輸入後，長輩說或按「同意」。
2. 長輩的頁面把這次分享的 token 交給台北通 App。App 每秒檢查一次，畫面有變化才把**整個 App 的畫面**拍成圖片送出：
   首頁、卡證、服務網頁都看得到（網頁部分用 WebView 的截圖補上）。沒有用 AI，不花 token，只用手機的效能和網路。
3. 家人點畫面上的位置，長輩的手機就在同一個位置按一下，畫一個圈並念出「王小美 按了『下一步』」。
   要填寫時，家人點欄位，框框下方會出現打字框。
4. **送出、付款、確認、申請、刪除**這類按鈕，長輩的手機會先問「王小美 想幫你按『送出申請』，同意嗎？」，同意才按。
   這個問題不在拍下的畫面裡，問的時候家人的操作都不執行，所以家人按不到「同意」。密碼欄位家人不能填。
5. 長輩隨時可以按畫面下方的「停止分享」；登出、閒置 30 分鐘也會結束。
6. 授權與分享狀態存在**後端記憶體**，不進資料庫；後端重開後要重新登入、重新綁定。

電腦瀏覽器沒有台北通 App，改用模擬服務頁（`frontend/demo/service.html`）測試：這一頁自己載入分享程式
（`frontend/js/share-agent.js`，用開源的 rrweb 記錄網頁的變化），家人看到的是這一頁，操作方式相同。

示範服務「交通罰單」（`frontend/demo/fines.html`、`backend/fines.py`）：示範家人幫長輩繳罰單。

- 長輩每次按「同意」讓家人幫忙，後端就重新產生一份假罰單（2 張待繳、1 張已繳），每次示範都從「待繳」開始。
- 罰單屬於示範的長輩帳號王阿伯，存在後端記憶體；後端重開也會重新產生。
- 台北通首頁的常用服務有「交通罰單」（`townpass/a11y-share.patch` 加的入口）；電腦瀏覽器測試時，長輩的分享頁有「交通罰單（示範服務）」。
- 家人點罰單、選付款方式都直接執行；按「確認繳費」時長輩的手機會先問「王小美 想幫你按『確認繳費 600 元』，同意嗎？」。
  畫面上的字有挑過，只有這一顆會問（付款方式不寫「扣款」，罰單卡片不寫「繳費期限」）。

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
（電腦上只能分享模擬服務頁；分享整個台北通的畫面要在手機上測，步驟見 [townpass/README.md](townpass/README.md)。）

## 部署

後端（網頁＋API＋轉送畫面）是同一個程式，**在哪一台電腦都能跑**，換地方只要改 TownPass 的 `A11Y_URL`，程式碼不用改。
iPhone 的台北通只能開 https 網址。

**比賽期間：跑在自己的電腦，用通道讓外面連進來**（入門指引第 07 章：「於比賽期間以 ngrok 對外提供本機服務」）。
程式在自己的電腦上執行，通道只負責轉送，長輩和家人在不同網路也能用，也自動有 https。

```bash
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000   # 終端機 1：後端
cloudflared tunnel --url http://localhost:8000                               # 終端機 2：通道（brew install cloudflared）
```

`cloudflared`（Cloudflare 的開源通道程式，Apache-2.0）免費、不用註冊帳號，會印出 `https://隨機名稱.trycloudflare.com`。
TownPass 用 `--dart-define=A11Y_URL=https://隨機名稱.trycloudflare.com/` 執行。這個網址每次重開 `cloudflared` 都會換，
所以測試和展示期間讓它一直開著；換了網址就要重新 `flutter run`。也可以改用入門指引提到的 ngrok（免費方案有每月流量上限）。

**只在同一個 Wi-Fi 測試**（不用通道；手機和電腦要連同一個 Wi-Fi）：用開源的 mkcert 產生憑證。

```bash
brew install mkcert && mkcert -install
mkdir -p certs && mkcert -cert-file certs/a11y.pem -key-file certs/a11y-key.pem 192.168.1.23   # 換成電腦的區網 IP
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8443 \
  --ssl-certfile certs/a11y.pem --ssl-keyfile certs/a11y-key.pem
```

把 `$(mkcert -CAROOT)/rootCA.pem` 用 AirDrop 傳到 iPhone 安裝，再到「設定 → 一般 → 關於本機 → 憑證信任設定」打開它。
TownPass 用 `--dart-define=A11Y_URL=https://192.168.1.23:8443/ --dart-define=A11Y_ALLOW_SELF_SIGNED=true` 執行
（第二個參數讓 App 傳畫面的連線接受這張自己產生的憑證，只限這台電腦）。`certs/` 不會被 commit。

**交給資訊局：跑在他們的伺服器**。用 `a11y/Dockerfile`：

```bash
docker build -t a11y .
docker run -d -p 8080:8080 --name a11y a11y      # 埠號可用環境變數 PORT 改
```

前面接上他們的 https（正式憑證），TownPass 的 `A11Y_URL` 改成正式網址，不要加 `A11Y_ALLOW_SELF_SIGNED`。
登入與分享的狀態存在記憶體，只能跑一份（不能同時開好幾台分流）。

## 測試

```bash
.venv/Scripts/python -m pytest          # 後端（綁定、分享畫面、遠端操作、停止分享、常見問題、交通罰單）
# 台北通 App 的部分：套用 townpass/a11y-share.patch 後，在 TownPass 執行 fvm flutter test test/a11y_share_test.dart
node --test "tests/js/*.test.js"        # 前端的搜尋、語音指令、朗讀文字（Node.js 22）
```

## 環境變數

| 名稱 | 用途 | 預設 |
| --- | --- | --- |
| `A11Y_DB_PATH` | SQLite 檔案位置 | `backend/a11y.db`（Docker 裡是 `/tmp/a11y.db`） |
| `A11Y_FAQ_AUTO_SYNC` | 設成 `0` 就不自動同步常見問題 | `1` |
| `PORT` | Docker 的連接埠 | `8080` |

其他可調整的時間與次數在 `backend/config.py`。TownPass 端用 `--dart-define=A11Y_URL=...` 指定網址，測試用自己產生的憑證時再加 `--dart-define=A11Y_ALLOW_SELF_SIGNED=true`。

## 資料來源

| 資料 | 來源 | 類型 |
| --- | --- | --- |
| 常見問題（51 題，只取中文） | [台北通官方網站｜功能教學與Q&A](https://id.taipei/tpcd/about/faq)，透過網站本身使用的公開 API 同步 | 官方公開資料，答案保留原文 |
| 搜尋用的關鍵字、同義詞 | `backend/data/faq_keywords.json`、`faq_synonyms.json` | 團隊整理（見 AI 使用聲明） |
| 王阿伯、王小美帳號 | `backend/store.py` | 模擬 |
| 模擬服務頁（市民服務申辦） | `frontend/demo/service.html` | 模擬（電腦測試用，不會真的送出） |
| 交通罰單、付款方式 | `backend/fines.py` | 模擬（示範用的假罰單，不會真的付款） |

官方新增題目時，同步程式會列出「還沒有關鍵字」的題目，請補進 `faq_keywords.json`，存檔後立即生效。

## 第三方套件

| 套件 | 版本 | 授權 | 用途 |
| --- | --- | --- | --- |
| FastAPI | 0.162.0 | MIT | 後端 API |
| Uvicorn | 0.54.0 | BSD-3-Clause | 執行後端（含 WebSocket） |
| rrweb（`@rrweb/record`、`@rrweb/replay`） | 2.1.7 | MIT | 分享畫面：記錄與重播網頁的變化。檔案放在 `frontend/vendor/rrweb/`（未修改，附 LICENSE） |
| SQLite | Python 內建 | 公共領域 | 資料庫 |
| pytest | 9.2.0 | MIT | 測試（不部署） |
| httpx | 0.28.1 | BSD-3-Clause | 測試（不部署） |
| cloudflared | 最新版 | Apache-2.0 | 選用：比賽期間讓外面連到自己電腦上的後端（不部署） |
| mkcert | 1.4 以上 | BSD-3-Clause | 選用：同一個 Wi-Fi 測試時產生 https 憑證（不部署） |

## AI 使用聲明

- 開發階段使用 Claude Code 協助撰寫程式，並起草搜尋用的關鍵字與同義詞，經團隊確認。
- 執行時不使用任何 AI 或 LLM：搜尋用關鍵字比對、同意用固定規則判斷，提示語音都是固定模板。
