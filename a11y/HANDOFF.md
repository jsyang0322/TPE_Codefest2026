# 交接：無障礙輔助「讓家人幫忙」改成框框內操作

整理時間：2026/11/8 凌晨（3 號的 Mac）。給接手繼續開發 `a11y/` 的組員。

## 目標（3 號決定的設計）

1. **框框＝長輩的手機**：家人頁上所有操作長輩手機的按鈕都在框框裡。
   - 拿掉「往上」「往下」：直接在框框裡拖曳或滾滾輪就能捲動。
   - 框框底部一條按鈕列（像手機導覽列）：「上一頁」「首頁」「打字」。
   - 點到文字欄位時，打字框自動出現在框框下方（像手機鍵盤），不用再按「幫忙打字」。
2. **長輩一按「同意」就回到台北通首頁**：家人一看到畫面就是台北通本來的功能，可以直接操作。
   台北通裡不再顯示「打開要辦的服務」清單（那是分享整個 App 之前的舊設計留下來的）。

## 目前狀態

| 項目 | 狀態 |
| --- | --- |
| 分支 | TPE_Codefest2026 的 `feat/a11y-in-frame`，從 `feat/a11y`（ba0bd9d）開出來。**還沒開 PR** |
| 程式 | 都改完了，見下一節 |
| 自動測試 | Flutter `test/a11y_share_test.dart` **9 個全過**（新增 1 個）；後端 `pytest` **85 個全過**；改過的 JS 都過 `node --check` |
| `a11y-share.patch` | 已重新產生，在乾淨的 TownPass `6bb569b` 上 `git apply --check` 通過 |
| **iPhone 實測** | **還沒做**。新版 App 已經裝到 3 號的 iPhone，但 `flutter run` 的 debug 連線一裝好就斷，沒有看到畫面就交接了 |

## 改了哪些檔案

**家人頁**
- `frontend/caregiver.html`：拿掉框框外的操作按鈕；在 `#stage`（框框）裡加 `#phone-bar` 按鈕列和打字框 `#dlg-input`（原本是蓋住整頁的對話框）；最下面的按鈕改名「不看了，回到我的首頁」（它是家人自己離開，不是叫長輩回首頁）。
- `frontend/js/caregiver-page.js`：
  - 刪掉 `scrollBy` 和 `scroll-up/down` 動作。
  - `setMode` 會一起顯示或隱藏按鈕列。
  - 打字框打開時，只把框框的畫面和按鈕列設成 inert（`typingBackground()`）。
  - `share_result` 收到 App 回的「已點「…」」時，自動打開打字框。
- `frontend/css/care.css`：刪掉 `.watch-controls`，新增 `.phone-bar`、`.phone-btn`、`.type-panel`。

**長輩頁**
- `frontend/elder.html`：「打開要辦的服務」包在 `#services` 裡。
- `frontend/js/elder-page.js`：
  - 在台北通裡隱藏 `#services`。在電腦瀏覽器裡只顯示模擬服務頁，電腦測試還能用。
  - `enterSharing(link, { goHome })`：只有長輩剛按「同意」時 `goHome: true`。
- `frontend/js/share-script.js`：`startSharing(share, { goHome })`，送給 App 的 `a11y_share_start` 多一個 `go_home`。

**台北通 App（改在 `townpass/a11y-share.patch` 裡）**
- `a11y_share_message_handler.dart`：讀 `go_home`。
- `a11y_share_service.dart`：
  - `start(..., goHome)`：新的 token 且 `goHome` 時，等這一格畫完再呼叫 `_home()`（`popUntil(isFirst)`）。
  - 同一個 token 再送一次不會跳走。長輩之後再打開無障礙輔助，也不會被關掉。
  - 點到欄位時回的訊息改成「已點「X」，請在打字框輸入要填的內容。」。家人頁靠「已點「」這個開頭判斷要不要開打字框，**兩邊要一起改**。
- `test/a11y_share_test.dart`：新增「長輩剛按同意：回到台北通首頁；同一個 token 不會再關掉」。

**文件**：`IPHONE_TESTING.md`（第 4、6、9、10 項和說明、測試數量改成 9 個）、`DEMO.md`、`README.md`、`townpass/README.md`、`DEVELOPMENT.md`（「設計變更」表多一列）。

## 接手後先做

1. 實測新設計，照 `IPHONE_TESTING.md` 跑一次，特別看：
   - 第 4 項：長輩按「同意」後，有沒有自動回到台北通首頁。
   - 框框底部的「上一頁」「首頁」「打字」能不能用。
   - 第 10 項：點文字欄位後，框框下方有沒有自動出現打字框。
   - 手機當家人時，框框裡拖曳是捲長輩的手機，框框外拖曳是捲自己這頁。
2. 實測沒問題就開 PR：`feat/a11y-in-frame` → `feat/a11y`。

## 還沒解決的問題

- **「停止分享」按不動？**
  - 家人在框框裡點長輩無障礙輔助頁上的「停止分享」，App log 回了 4 次 `ok：已按下「停止分享」`，但 3 號說畫面沒反應。原因還沒查。
  - 現在同意後會回到首頁，家人比較不會再點到這一頁，但根本原因還在。
- **安全設計待決定：家人能不能遠端按長輩的「同意」「停止分享」？**
  這幾顆是授權用的按鈕，照理應該只有長輩本人能按。可以考慮在 App 的 `_tapWeb` 擋掉無障礙輔助網頁本身的點按。
- ~~**Demo 要找真的服務頁**~~：改用台北通原本的「帳務 › 停車費」（見下一節）。「密碼只能本人輸入」還是要找有密碼欄位的真服務頁。
- 家人頁靠 App 回傳訊息的文字判斷要不要開打字框，比較脆弱。之後可以改成 App 在結果裡帶 `field: true`，這樣後端 `share.py` 轉送的格式也要一起改。

## 3 號 Mac 上的環境（接手時要知道）

- **後端**：`a11y/.venv`（Python **3.12**，系統的 `python3` 是 3.9.6 不能用），`uvicorn` 跑在 `127.0.0.1:8000`。
  - 改前端檔案不用重啟，後端每次都從磁碟讀。
  - 改 `.py` 要重啟；重啟後登入狀態會清掉，兩邊都要重新登入。
- **通道**：`cloudflared tunnel --url http://localhost:8000`，現在的網址是 `https://api-bent-centered-invitation.trycloudflare.com/`。cloudflared 一重開網址就會換，App 也要帶新網址重新 build。
- **防睡眠**：`caffeinate -dims`。
- **TownPass**：在 `~/Developer/TownPass-codefest`（不放 Desktop，因為 iCloud 同步會讓簽名失敗）。
  - 分支 `feat/a11y-share`，修改檔已套上，**沒有 commit**。修改的正本是 TPE repo 裡的 `a11y/townpass/a11y-share.patch`。
  - `ios/Runner.xcodeproj/project.pbxproj`、`ios/Podfile.lock` 有 3 號的簽名設定（Team `33T7LLP75H`、`com.example.townpass.codefest4`），**不要 commit 也不要丟掉**。
- **裝到 iPhone**：要接傳輸線，iPhone 的 Flutter 裝置 ID 是 `00008150-001C501C1A50C01C`。
  - **debug 版（`flutter run`）常常一裝好就斷線**；斷線後 App 一被關掉，就沒辦法從桌面打開。
  - 比較穩的做法：
    ```bash
    fvm flutter build ios --release --dart-define=A11Y_URL=<後端網址>/
    xcrun devicectl device install app --device E9A22B6A-C923-5794-A9A5-A1A1DEC8C8E9 build/ios/iphoneos/Runner.app
    xcrun devicectl device process launch --device E9A22B6A-C923-5794-A9A5-A1A1DEC8C8E9 --terminate-existing --console com.example.townpass.codefest4
    ```
    最後一行會把 App 的輸出（含 `a11y share:`）印出來，拔線就會停。
- 路徑有中文，跑 `fvm`／`pod` 前先 `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`。

## 跟這次無關，但要知道

- 網頁正式版（`tpe-codefest2026.web.app`）已部署 main 1b023bc（#23 停用 AI 繳費），JS 是 `index-BPDe69GT.js`。
- **不要在這個資料夾切換到 main**：main 沒有 `a11y/frontend/`，後端會開始回 404。要部署網頁請另外 clone 一份。
- 還沒處理：網頁的「請問可以幫我查停車費嗎」會被當成發問，不會去查（`web/src/agent/keywords.ts` 的 `ASKING` 擋到「請問」），要請 4 號改。
- Commit 訊息和 PR 說明不要加 AI 共同作者行（AGENTS.md）。

## 後續：用台北通原本的停車費示範、介面改成台北通的樣子（11/8 清晨，接手的組員）

接手後做的事，已經 push 到同一個分支：

1. **示範繳費用台北通原本的「帳務 › 熱門繳費 › 停車費」**
   - 中間曾做過示範服務「交通罰單」（假資料，ef6595f），後來拿掉：原本的停車費頁（主辦方的示範網頁）就能從查詢走到繳費完成，任何車號都查到 4 筆停車單，不會真的付款。
   - 用 App 判斷點按的同一套規則，在電腦上把那一頁走過一次：汽車、車號、查詢、全部繳清都不會問；「前往繳費」會先問長輩；付款方式 →「是」→ 繳費完成。
   - 最後提醒框的「是」不會再問（按鈕只有「是」一個字）。要擋的話，可以讓 `_inspectJs` 看按鈕所在對話框的文字。
   - 台北通修改檔 `a11y-share.patch` 跟 fbf372d 的版本一樣，沒有多改台北通。
2. **介面改成台北通的樣子**（`base.css`、`care.css`、各頁的 `<header>`）
   - 頁首改成台北通網頁框那種青綠色標題列。在 App 裡（`window.flutterObject` 存在）藏起來、只留給螢幕閱讀器，用 App 自己的標題列；用 Safari 開才看得到。
   - 白底、圓角 10 的按鈕、TPCard 的淡陰影。按鈕底色用 primary-700（白字 5.9:1），標題列用 primary-600（大字 3.8:1）。
3. **家人也用 iPhone**：看畫面時整個螢幕是長輩的畫面，頁面不捲動。
   - 上面：誰的畫面、正在看哪一頁、「不看了」。
   - 中間：訊息（有才出現），以及長輩的畫面（`stage-view` 裡等比例縮到一次看得完，`ResizeObserver` 在打字框打開時重新縮）。
   - 下面：上一頁、首頁、打字。
4. **測試**：後端 85 個、JS 18 個、Flutter 9 個全過；假裝成台北通 App 的測試在 iPhone 大小（390×844）通過，長輩的畫面高 637px，一次看得完。
5. **iPhone 實測仍然還沒做**：`IPHONE_TESTING.md` 第 11～16 項是繳停車費。
