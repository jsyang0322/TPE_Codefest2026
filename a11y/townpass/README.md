# 把無障礙輔助接進台北通（TownPass）

`a11y-share.patch` 是對 `jsyang0322/TownPass` main（commit `6bb569b`）的修改。
長輩在「無障礙輔助」同意後，家人看得到長輩**整個台北通的畫面**（首頁、卡證、服務網頁都看得到），也能遠端幫忙點按、打字。

| 檔案 | 改了什麼 |
| --- | --- |
| `lib/service/a11y_share_service.dart`（新增） | 拍畫面、送到後端；執行家人的點按、打字、捲動、上一頁；重要按鈕先問長輩 |
| `lib/util/a11y_share_scope.dart`（新增） | 包住整個 App：畫面下方的「正在看你的畫面／停止分享」、問長輩「同意嗎？」的畫面 |
| `lib/util/web_message_handler/a11y_share_message_handler.dart`（新增） | `a11y_share_start`、`a11y_share_stop` 兩個 Handler；開始分享只接受無障礙輔助網頁送來的訊息 |
| `test/a11y_share_test.dart`（新增） | 8 個測試：拍畫面、點按、重要按鈕要同意、打字、密碼擋下、捲動、上一頁、停止分享 |
| `lib/main.dart` | `GetMaterialApp` 加上 `builder`，用 `A11yShareScope` 包住 App（+3 行） |
| `lib/util/tp_web_view.dart` | `TPInAppWebView` 建立時登記給分享功能（+3 行） |
| `lib/util/web_message_handler/tp_web_message_listener.dart` | Handler 清單加 2 個（+4 行） |
| `lib/page/city_service/model/my_service_model.dart` | 城市服務加入「無障礙輔助」（+11 行） |
| `lib/page/city_service/widget/pinned_service_widget_controller.dart` | 預設放在首頁常用服務，排在 AI 語音助手後面（+1 行） |

沒有新增任何套件，也沒有改 iOS／Android 的原生設定。沒有在分享時，App 和原本一樣（只多一層 `RepaintBoundary`）。

## 套用

```bash
cd TownPass
git checkout -b feat/a11y-share
git apply --check ../TPE_Codefest2026/a11y/townpass/a11y-share.patch   # 先檢查，沒有訊息就是可以套
git apply ../TPE_Codefest2026/a11y/townpass/a11y-share.patch
fvm flutter test test/a11y_share_test.dart                             # 8 個測試應該全部通過
```

## 在 iPhone 上執行

後端要先有 **https** 網址（做法見 `a11y/README.md` 的「部署」）。比賽期間後端跑在自己的電腦，用 `cloudflared` 通道對外：

```bash
fvm flutter run --dart-define=A11Y_URL=https://隨機名稱.trycloudflare.com/
```

只在同一個 Wi-Fi、用 mkcert 自己產生的憑證時，多加一個參數：

```bash
fvm flutter run --dart-define=A11Y_URL=https://192.168.1.23:8443/ --dart-define=A11Y_ALLOW_SELF_SIGNED=true
```

`A11Y_URL` 結尾要有 `/`。沒有指定的話，「無障礙輔助」會打不開。交給資訊局時，`A11Y_URL` 改成他們伺服器的正式網址。

## 測試步驟（兩支手機）

1. 長輩的手機：台北通 →「無障礙輔助」→ 以王阿伯登入 →「讓家人幫我」，畫面出現 6 位數字。
2. 家人的手機（台北通或 Safari 都可以，打開同一個網址）：以王小美登入 → 輸入那 6 位數字。
3. 長輩的手機：說「同意」或按「同意」。畫面下方出現黃色的「王小美 正在看你的畫面」和「停止分享」。
4. 家人的手機：按「看 王阿伯 的畫面」，看到長輩台北通的畫面。
5. 長輩的手機：關掉無障礙輔助，到首頁、卡證，或打開任何服務網頁，家人那邊都會跟著變。
6. 家人點畫面上的按鈕，長輩的手機會在同一個位置按一下、畫一個黃色的圈，並念出「王小美 按了『下一步』」。
   要填寫時，家人點欄位，框框下方會出現打字框。捲動直接在框框裡拖曳；框框下方有「上一頁」「首頁」「打字」。
7. 家人按到「送出」「確認」「付款」這類按鈕時，長輩的手機會問「王小美 想幫你按『送出申請』，同意嗎？」，
   長輩按或說「同意」才會按下去。密碼欄位家人不能填。
8. 長輩按畫面下方的「停止分享」→「確定停止」，家人那邊立刻看不到。

## 分享時 App 做了什麼

1. 長輩同意後，無障礙輔助網頁用 `a11y_share_start` 把這次分享的 token 交給 App。App 確認訊息來自 `A11Y_URL` 的網站才開始。
2. App 用 WebSocket 連到後端的 `/ws/share`。每秒檢查一次，畫面有變化才把整個 App 的畫面拍成 PNG 送出
   （拍的範圍是 `A11yShareScope` 裡的 `RepaintBoundary`，不包含下方的提示列和「同意嗎？」的畫面）。
3. 網頁（WebView）不是 Flutter 畫的，拍 App 畫面時那一塊是空白，所以另外用 WebView 的 `takeScreenshot` 拍下來，
   和位置一起送出，家人的頁面把它疊在正確的位置。
4. 家人點畫面時，後端把位置（x, y）傳回 App：
   - 一般畫面：App 在同一個位置送出手指按下、放開的事件（和真的手指一樣）。
   - 網頁：用 JavaScript 找到那個位置的按鈕並按下。
   - 按鈕上的字有「送出、付款、確認、申請、刪除」這類字時，先問長輩，同意才按；問的時候家人的其他操作都不執行。
5. 打字框填入長輩手機上目前選取的欄位；密碼欄位（`obscureText` 或 `type="password"`）不填。
6. 長輩按「停止分享」、在無障礙輔助網頁停止、登出或閒置 30 分鐘，後端結束授權並通知 App 停止。

已知限制：

- 一秒最多送一張畫面，所以動畫看起來會一格一格的；家人看到的畫面會慢大約一秒。
- 系統跳出來的畫面（鍵盤、權限詢問、分享選單）不是台北通畫的，家人看不到。
- 按鈕上只有圖示、沒有字時，App 不知道它是不是重要按鈕，會直接按。
- App 重開後分享會停止，長輩要再打開「無障礙輔助」一次（網頁會自動把 token 再交給 App）。
