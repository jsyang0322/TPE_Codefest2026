# 台北通無障礙輔助：iPhone 實機測試手冊

給在 Mac 上測試的組員。照順序做完大約 1 小時：準備與套用 20～30 分鐘，實機測試 15 分鐘。
**截止 11/8 09:00，請在那之前把結果回報（見最後一節）。**

## 這次要測什麼

電腦上的自動測試都通過了，但**還沒有人在真的 iPhone 上跑過**。這次要確認兩件事：

1. **讓家人幫忙**：長輩在台北通按「同意」後，家人看得到長輩**整個台北通的畫面**，並能遠端幫忙點按、打字。
2. **常見問題語音查詢**：在台北通裡用說的問問題，手機念出答案。

需要兩個角色：

- **長輩**：你的 iPhone，跑套用修改後的台北通，以「王阿伯」登入。
- **家人**：第二支手機的 Safari，或 Mac 的瀏覽器，打開同一個網址，以「王小美」登入。

原理與每個修改的檔案寫在 [townpass/README.md](townpass/README.md)，這份手冊只講怎麼測。

## 準備

你平常在 iPhone 上跑 TownPass 的環境都能用，另外只要裝 Python 和 cloudflared，**不需要任何雲端帳號**。

| 要有的東西 | 用來做什麼 | 檢查方式 |
| --- | --- | --- |
| Mac＋Xcode＋FVM（Flutter 3.47.6） | 編譯、執行 TownPass | `fvm flutter --version` |
| 一支 iPhone，之前跑過 TownPass | 當長輩的手機 | 照你平常的方式能裝上去就好 |
| 第二支手機，或 Mac 的瀏覽器 | 當家人的手機 | 能打開 https 網址 |
| Python 3.11 以上 | 在 Mac 上跑後端 | `python3 --version`；沒有就 `brew install python@3.12` |
| cloudflared | 讓不同網路的手機連到 Mac 上的後端（免費、不用註冊） | `brew install cloudflared`，再 `cloudflared --version` |
| 兩個資料夾放在一起 | 修改檔用相對路徑套用 | `TownPass/` 和 `TPE_Codefest2026/` 在同一個資料夾裡 |

不用裝 Docker：`a11y/Dockerfile` 是之後交給資訊局，在他們的伺服器上跑的時候才用。

## 步驟一：拿到程式

```bash
cd ~/你放專案的資料夾                 # TownPass 也在這裡
git clone https://github.com/jsyang0322/TPE_Codefest2026.git   # 已經有就跳過
cd TPE_Codefest2026
git fetch origin
git checkout feat/a11y
git pull
git log --oneline -3                  # 最上面幾個 commit 是「讓家人幫忙…」
```

這個分支只動了 `a11y/` 資料夾，沒有改 `web/` 或其他人的程式。

## 步驟二：在 Mac 上跑後端，並打開通道

後端（網頁＋轉送畫面的程式）跑在你的 Mac 上。`cloudflared` 通道會給它一個公開的 https 網址，
長輩和家人在不同的網路也連得到（入門指引第 07 章允許比賽期間用通道對外提供本機服務）。之後交給資訊局，就改跑在他們的伺服器上。

**終端機 1：後端**

```bash
cd ~/你放專案的資料夾/TPE_Codefest2026/a11y
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

看到 `Uvicorn running on http://127.0.0.1:8000` 就好了。第一次啟動會從台北通官方網站同步常見問題，要有網路。

**終端機 2：通道**

```bash
cloudflared tunnel --url http://localhost:8000
```

幾秒後會印出一個框，裡面有 `https://隨機名稱.trycloudflare.com`，**把這個網址記下來**，後面叫它「後端網址」。

- 兩個終端機在測試和展示期間都**不要關**。重開 `cloudflared` 網址會換，就要重新做步驟四。
- Mac 睡著就連不到了：接上電源，再開**終端機 3** 執行 `caffeinate -dims`，測完按 `Ctrl`＋`C` 結束。

確認後端正常：

1. 用 Mac 的瀏覽器打開 `後端網址/api/health`，應該看到 `{"ok":true}`。
2. 打開 `後端網址/`，應該看到「台北通無障礙輔助」首頁，下面的「連線狀態」寫「連線正常」。

通道打不開的話，也可以讓 iPhone 和 Mac 連同一個 Wi-Fi，不用通道，做法見 [README.md](README.md) 的「部署 › 只在同一個 Wi-Fi 測試」。

## 步驟三：在 TownPass 套用修改檔

修改檔是對 TownPass main 的 commit `6bb569b` 做的。會改組員原本的 5 個檔案（共加 22 行），另外新增 4 個檔案。

```bash
cd ~/你放專案的資料夾/TownPass
git status                            # 要乾淨；有改到一半的東西先 commit 或 git stash
git checkout main && git pull
git checkout -b feat/a11y-share
git apply --check ../TPE_Codefest2026/a11y/townpass/a11y-share.patch   # 沒有任何訊息 = 可以套
git apply ../TPE_Codefest2026/a11y/townpass/a11y-share.patch
git status                            # 應該是 5 個 modified、4 個新檔案
```

如果 `git apply --check` 失敗（main 後來又有新的 commit），改從 `6bb569b` 開分支：

```bash
git checkout -b feat/a11y-share 6bb569b
git apply ../TPE_Codefest2026/a11y/townpass/a11y-share.patch
```

先跑分享功能的測試（平常跑 TownPass 前要 `build_runner` 的話，照舊先跑）：

```bash
fvm flutter test test/a11y_share_test.dart
```

應該看到 `All tests passed!`，共 8 個。沒過的話，先把輸出存下來回報，再繼續往下測。

## 步驟四：在 iPhone 上執行台北通

把「後端網址」放進 `A11Y_URL`，**結尾一定要有 `/`**：

```bash
fvm flutter run --dart-define=A11Y_URL=https://隨機名稱.trycloudflare.com/
```

- 有好幾台裝置時，用 `fvm flutter devices` 找到 iPhone 的 ID，再加 `-d <ID>`。
- **這個終端機視窗不要關**：App 有問題時會印出 `a11y share:` 開頭的訊息，回報時要用。
- 打開台北通後，首頁的常用服務裡，「AI 語音助手」後面應該多一個「無障礙輔助」。

## 步驟五：實機測試清單

「結果」欄請填 ✅ 或 ❌，❌ 的話把看到的畫面寫在後面。

### 讓家人幫忙

| # | 誰的手機 | 操作 | 應該看到 | 結果 |
| --- | --- | --- | --- | --- |
| 1 | 長輩 | 台北通 →「無障礙輔助」 | 「台北通無障礙輔助」首頁；連線狀態兩個都寫「是／連線正常」 | |
| 2 | 長輩 | 按「以王阿伯登入（被照顧者）」→「讓家人幫我」 | 出現 6 位數字，手機一個數字一個數字念出來 | |
| 3 | 家人 | 打開 `後端網址/` →「以王小美登入（照顧者）」→ 輸入那 6 位數字 →「送出」 | 「已送出，請家人在他的手機上同意。」 | |
| 4 | 長輩 | 按或說「同意」 | 畫面下方出現黃色的「王小美 正在看你的畫面」和紅色的「停止分享」 | |
| 5 | 家人 | 按「看 王阿伯 的畫面」 | 看到長輩台北通目前的畫面，上面寫「正在看：…」 | |
| 6 | 長輩 | 按右上角關掉無障礙輔助，回到台北通首頁，再點「卡證」等其他頁 | 家人那邊大約 1 秒內跟著換畫面；黃色提示列一直都在 | |
| 7 | 長輩 | 打開一個網頁服務（例如「申辦服務」） | 家人看到網頁的內容，**不是一塊空白** | |
| 8 | 家人 | 點畫面上一個一般按鈕或連結 | 長輩的手機在同一個位置按下去、畫一個黃色的圈，並念出「王小美 按了『…』」 | |
| 9 | 家人 | 在畫面上拖曳、滾動滑鼠滾輪；再按「上一頁」、「回到首頁」 | 長輩的畫面跟著捲動、回上一頁、回到台北通首頁（分享繼續，黃色提示列還在） | |
| 10 | 家人 | 點一個文字欄位，再按「幫忙打字」，輸入「王大明」→「填入」 | 長輩那個欄位出現「王大明」，並念出「王小美 幫你填了『…』」 | |
| 11 | 家人 | 點一個寫著「送出」「確認」「申請」的按鈕 | 長輩的手機蓋上一層，問「王小美 想幫你按『…』，同意嗎？」並念出來 | |
| 12 | 長輩 | 在第 11 步按「不同意」 | 按鈕沒有被按；家人看到「王阿伯 不同意按『…』。」 | |
| 13 | 家人＋長輩 | 再點一次那個按鈕，長輩按「同意」 | 按鈕被按下；家人看到「王阿伯 同意了，已按下『…』。」 | |
| 14 | 長輩 | 按畫面下方的「停止分享」→「確定停止」 | 黃色提示列消失，念出「已停止分享…」；家人那邊回到首頁，顯示「王阿伯 已停止分享。」 | |

第 7 步找不到適合的網頁服務時，可以回到「無障礙輔助」，從「打開要辦的服務」點「模擬服務頁（測試用）」，它有姓名、手機、密碼欄位和「送出申請」按鈕。
在模擬服務頁上也可以多測一項：家人點「密碼」欄位再按「幫忙打字」，應該看到「密碼請 王阿伯 自己輸入。」，欄位沒有被填。

### 常見問題語音查詢

| # | 操作 | 應該看到 | 結果 |
| --- | --- | --- | --- |
| 15 | 台北通 →「無障礙輔助」→「常見問題：用講的問、用聽的聽答案」 | 第一次會跳出麥克風、語音辨識的權限，按允許 | |
| 16 | 按下半部的說話按鈕，說「身分證打錯怎麼改」 | 手機念出相關問題的答案 | |
| 17 | 把 iPhone 切成飛航模式，再問一次「忘記密碼怎麼辦」 | 一樣查得到、念得出來（搜尋在手機上做） | |

## 遇到問題怎麼辦

| 看到的狀況 | 可能的原因 | 怎麼處理 |
| --- | --- | --- |
| `git apply --check` 出現 `patch does not apply` | TownPass 有改到一半的東西，或 main 有新 commit | `git status` 確認乾淨；改從 `6bb569b` 開分支（步驟三） |
| 「無障礙輔助」打開是空白或錯誤頁 | 沒有加 `--dart-define=A11Y_URL=…`，或網址結尾少了 `/` | 停掉 App，照步驟四重新 `flutter run` |
| 長輩同意後出現「這個版本的台北通還不能分享畫面」 | 修改檔沒套到，或 `A11Y_URL` 和實際打開的網址不一樣 | `git status` 確認有 4 個新檔案；`A11Y_URL` 要和後端網址完全一樣 |
| 家人一直看到「還看不到 王阿伯 的畫面」 | App 連不上後端 | 看 `flutter run` 的終端機有沒有 `a11y share: connect failed`，把那一行回報 |
| 家人看到畫面，但網頁那一塊是空白 | WebView 截圖失敗 | 看終端機有沒有 `a11y share: capture failed`，回報第 7 步 ❌ |
| 家人點了沒反應 | 指令沒送到，或位置沒有東西可以按 | 看家人頁最上面的訊息框寫什麼；`flutter run` 終端機會印出 `a11y share: tap …` 和 `a11y share: command …`，把這幾行回報 |
| 網頁出現「請重新登入」 | 後端重開過，記憶體裡的登入和綁定清掉了 | 兩邊重新登入、重新綁定 |
| `cloudflared` 印出的網址打不開 | 通道剛建立要等幾秒，或網路擋住 | 等 10 秒再試；還是不行就重開 `cloudflared`（網址會換，要重新 `flutter run`），或改用同一個 Wi-Fi 的做法 |
| 一開始正常，過一陣子全部連不上 | Mac 睡著了，或終端機被關掉 | 確認三個終端機都還開著，`caffeinate -dims` 在跑 |
| 麥克風沒反應 | 權限被拒絕 | iPhone 的「設定 → 台北通」打開麥克風與語音辨識 |

## 測完回報與還原

請傳回這些給我：

1. 步驟五的兩個表格，每一項的 ✅ 或 ❌；❌ 的寫看到了什麼。
2. 第 5、7、11 步的截圖：家人看到的畫面、長輩被問「同意嗎？」的畫面。
3. `flutter run` 終端機裡所有 `a11y share:` 開頭的訊息（沒有就寫「沒有」）。
4. `fvm flutter test test/a11y_share_test.dart` 的結果。

還原 TownPass（修改都在 `feat/a11y-share` 分支上，main 沒有動）：

```bash
cd ~/你放專案的資料夾/TownPass
git checkout -- . && git clean -fd lib/service/a11y_share_service.dart lib/util/a11y_share_scope.dart lib/util/web_message_handler/a11y_share_message_handler.dart test/a11y_share_test.dart
git checkout main
git branch -D feat/a11y-share        # 確定不要這個分支才刪
```

測完在終端機 1、2、3 各按 `Ctrl`＋`C`，停掉後端、通道和防睡眠。
