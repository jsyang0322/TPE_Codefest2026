# 把無障礙輔助接進台北通（TownPass）

`a11y-share.patch` 是對 `jsyang0322/TownPass` main（commit `6bb569b`）的修改，共 6 個檔案：

| 檔案 | 改了什麼 |
| --- | --- |
| `lib/service/a11y_share_service.dart`（新增） | 保存分享程式；之後打開的服務網頁都放入它。網址由 `A11Y_URL` 指定 |
| `lib/util/web_message_handler/a11y_share_message_handler.dart`（新增） | `a11y_share_start`、`a11y_share_stop` 兩個 Handler；開始分享只接受無障礙輔助網頁送來的訊息 |
| `lib/util/web_message_handler/tp_web_message_listener.dart` | Handler 清單加 2 行 |
| `lib/util/tp_web_view.dart` | `TPInAppWebView` 加上 `initialUserScripts`（沒有分享時是 null，和原本一樣） |
| `lib/page/city_service/model/my_service_model.dart` | 城市服務加入「無障礙輔助」 |
| `lib/page/city_service/widget/pinned_service_widget_controller.dart` | 預設放在首頁常用服務（排在 AI 語音助手後面） |

沒有新增任何套件，也沒有改 iOS／Android 的原生設定。

## 套用

```bash
cd TownPass
git checkout -b feat/a11y-share
git apply --check ../TPE_Codefest2026/a11y/townpass/a11y-share.patch   # 先檢查，沒有訊息就是可以套
git apply ../TPE_Codefest2026/a11y/townpass/a11y-share.patch
```

## 在 iPhone 上執行

iPhone 的台北通只能連 https，所以後端要先有 https 網址（兩種做法見 `a11y/README.md` 的「部署」），然後：

```bash
fvm flutter run --dart-define=A11Y_URL=https://你的網址/
```

`A11Y_URL` 結尾要有 `/`。沒有指定的話，「無障礙輔助」會打不開；也可以直接改 `a11y_share_service.dart` 裡的預設值。

## 測試步驟（兩支手機）

1. 長輩的手機：台北通 →「無障礙輔助」→ 以王阿伯登入 →「讓家人幫我」，畫面出現 6 位數字和 QR code。
2. 家人的手機（台北通或 Safari 都可以，打開同一個網址）：以王小美登入 → 輸入數字或用台北通掃 QR code。
3. 長輩的手機：說「同意」或按「同意」。
4. 長輩的手機：在「打開要辦的服務」點一個服務（例如「申辦服務」或「模擬服務頁」）。
   畫面下方出現黃色的「王小美 正在看你的畫面」。
5. 家人的手機：按「看 王阿伯 的畫面」，看到同一個網頁。點按鈕、點輸入框幫忙填寫，長輩的手機會跟著動並念出來。
6. 家人按到「送出」「確認」這類按鈕時，長輩的手機會問「王小美 想幫你按『送出申請』，同意嗎？」。
7. 長輩按畫面下方的「停止分享」，家人那邊立刻停止。

## 分享時 App 做了什麼

1. 長輩同意後，無障礙輔助網頁把「rrweb 錄製程式＋分享程式＋這次的 token」組成一段 JavaScript，
   用 `a11y_share_start` 交給 App。App 確認訊息來自 `A11Y_URL` 的網站才保存。
2. 之後每次打開服務網頁（`TPWebView`），App 把這段程式放進網頁（`initialUserScripts`，只放主頁面）。
3. 分享程式記錄網頁的變化送給後端，執行家人的點按與填寫。長輩停止分享或分享結束時，
   分享程式送出 `a11y_share_stop`，App 就不再放入。

已知限制：

- 只分享網頁服務。台北通本身的畫面（首頁、卡證等原生畫面）不會分享。
- 網頁如果用 Content-Security-Policy 擋住對外的 WebSocket 連線，該網頁無法分享。
- App 重開後要重新打開「無障礙輔助」一次（網頁會自動把分享程式再交給 App）。
