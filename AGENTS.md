# AGENTS.md

給 AI 開發工具（Claude Code、Cursor、Copilot、Codex 等）的專案說明。修改程式前請先讀完本檔。

## 專案背景

- 2026 臺北秋季程式設計節 · 城市通微服務大黑客松參賽作品（競賽期間 2026/11/7–11/8）。
- 作品是一個在城市通 App（台北通）WebView 中執行的**微服務網頁**，視需求搭配後端。
- App 端修改放在另一個 repo：`jsyang0322/TownPass`（fork 自 `taipei-doit/TownPass`）。
- 得獎作品會由臺北市政府資訊局整併進城市通，程式碼要能讓別人接手：可移轉、可維運、可上架。

## 競賽規則（違反可能扣分或取消資格）

1. **只用開源、免費的套件與服務。** 新增依賴前先確認 LICENSE：MIT、BSD、Apache-2.0 可以；「僅供個人使用」「不得再散布」、需付費或訂閱的不行。
2. **地圖不得使用 Google Maps 或 Mapbox 等商用方案。** 請用 Leaflet 或 MapLibre，搭配 OpenStreetMap 或國土測繪中心圖資。Flutter 端不要用 `google_maps_flutter`。
3. **執行時的 LLM 推論必須在裝置端完成。** 不得呼叫雲端模型 API、自建遠端模型伺服器，也不得把使用者輸入或作品資料送到後端做 LLM 推論。評審可能在關閉網路的狀態下現場出題驗證。
4. 不得使用「危害國家資通安全產品」清單上的 AI 工具與模型（含大陸廠牌）。
5. 開發階段用雲端 AI 預先產生的固定內容可以使用，但不得宣稱為執行時的即時 AI 功能。
6. **核心資料須為合法開放資料，並註明出處**；非核心資料可用模擬資料，但要標示。
7. 一般後端（登入、資料庫、檔案、排行榜、同步）不受 AI 規則限制。
8. 本 repo 以 AGPL-3.0 授權，LICENSE 開頭的授權聲明是主辦指定的，不要刪改。

## 文件同步

README.md 是繳交項目之一，資訊局會依它接手。改動時請同步更新：

- 新增或移除套件 → 更新「第三方套件」表（名稱、版本、授權、用途）。
- 新增或移除資料集 → 更新「資料來源」表（名稱、機關、連結、開放資料或模擬）。
- 新增環境變數 → 更新「環境變數」表，並在 `.env.example` 補上。
- 加入裝置端模型 → 填寫「執行階段（裝置端模型揭露）」：模型名稱、版本、量化格式、推論框架、來源。

## 城市通技術資訊（2026/10）

| 項目 | 版本 |
| --- | --- |
| Flutter | 3.47.6（`.fvmrc`，用 FVM） |
| Dart SDK | 3.13 以上 |
| iOS | 最低 iOS 15，UIScene lifecycle，Swift Package Manager |
| Android | AGP 9.1.0、Kotlin 2.4.0、Gradle 9.3.1，需 Java 17 |

你的訓練資料可能比這些版本舊。寫 Flutter／Android 相關程式前，先讀 TownPass 的 `pubspec.yaml` 與官方文件，不要套用舊版寫法。去年的 `CPWebMessageHandler` 今年已改名為 `TPWebMessageHandler`。

### 網頁與 App 的雙向溝通

網頁透過 `window.flutterObject` 和 App 溝通，訊息格式為 `{ name, data }`，**以 JSON 字串傳送**。

```js
// 送出
window.flutterObject.postMessage(JSON.stringify({ name: 'location', data: null }));

// 接收
const onReply = (event) => {
  const { name, data } = JSON.parse(event.data);
  if (name === 'location') console.log(data.latitude, data.longitude);
};
window.flutterObject.addEventListener('message', onReply);
// 用完要 removeEventListener，避免重複觸發
```

- 一般瀏覽器沒有 `flutterObject`，先判斷是否存在，不存在時改用模擬資料，方便在桌機開發。
- 內建 name：定位（`location`）、QR Code 掃描、手機通知（`notify`）、裝置資訊、撥電話／1999、開地圖／開連結。
- 需要其他原生能力（NFC、藍牙、裝置端 AI 等）時，在 TownPass fork 新增繼承 `TPWebMessageHandler` 的 Handler，加入 `TPWebMessageListener` 的 `_cachedMessageHandlers`，name 不可與內建名稱重複。原始碼在 `lib/util/web_message_handler/`。
- 雙向溝通只能在 App 內測試；彈出視窗在 iOS 預設會被阻擋，兩個平台都要測。

### 把服務加入城市通（TownPass fork）

1. SVG 圖示放入 `assets/svg/`，檔名 snake_case，執行 `fvm dart run build_runner build --delete-conflicting-outputs`，以 `Assets.svg.iconXxx.svg()` 取用。
2. 在 `lib/page/city_service/model/my_service_model.dart` 的 `MyServiceItemId` 新增 id，並在 `MyServiceIdExt` 補上 `MyServiceItem`（`title`、`description`、`icon`、`category`、`destinationUrl`）。
3. 需要出現在「熱門」時，改 `model/trending_service_model.dart`。
4. 測試帳號資料在 `assets/mock_data/account.json`（改 `citizen`、`birthday` 可切換身分）。

## 設計規範

- 色票：Primary 500 `#5AB4C5`、Secondary 500 `#F5BA4B`、Grayscale 500 `#738995`（各有 50–950 階）。
- 字體：中文 PingFang TC，英數 Roboto。
- 字級：h1 36、h2 24、title 18、h3 16、body 14、caption 12。
- 盡量依 Figma 上的 Town Pass UI Kit 組畫面，風格與城市通一致。
- 無障礙：觸控目標至少 48×48、文字放大 200% 仍可閱讀、圖示要有替代文字（裝飾圖隱藏）、不使用閃爍內容、每頁一個標題、焦點順序由上至下由左至右。
- 介面文字用繁體中文，用語淺白。

## 部署

- 前端：Firebase Hosting（`firebase deploy --only hosting`），Vite 輸出目錄為 `dist`，single-page app 選 Yes。須為 HTTPS。
- 後端：Cloud Run（`gcloud run deploy <name> --source . --region asia-east1`）。附 Dockerfile，埠號讀環境變數 `PORT`。網頁（web.app）與 API（run.app）不同網域，要設定 CORS。
- 不要用 `gcr.io`，Container Registry 已關閉，改用 Artifact Registry。

## 其他

- 不要 commit 金鑰（TDX、Firebase 等）或 `.env`；也不要 commit 數 GB 的模型檔（`.gguf`、`.litertlm`、`.task`）。
- 決選有評審問答，隊員要能說明每段程式的設計考量，產生的程式碼請保持簡單易讀。

## 參考資源

- TownPass 原始碼：https://github.com/taipei-doit/TownPass
- 開發文件：https://tpe-guideline.web.app
- 競賽須知：https://codefest.taipei/2026-fall
- 開放資料：https://data.taipei 、https://data.gov.tw 、https://tdx.transportdata.tw
- 往屆整併作品：`taipei-doit/townpass2024-parking`、`taipei-doit/townpass2025-RideFlow`、`taipei-doit/townpass2024-weather`
