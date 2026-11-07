# 任務 A prompt 實機測試

> 給 1 號在手機上用 `tool/llm_poc.html`（TownPass）測 Gemma。4 號依結果調整 `web/src/agent/validate.ts` 和 `prompts.ts` 的範例。
> 產生時間：2026/11/7；prompt 由 `web/src/agent/prompts.ts` 的 `taskPrompt()` 產生，腳本改了要重新產生。

## 怎麼測

1. 開飛航模式，打開 `llm_poc.html`。
2. 把下面的 **system prompt** 整段貼進 system 欄位（取代原本的舊版）。
3. 逐句輸入「使用者說」，把模型輸出原樣貼到「實際輸出」欄，記下開始出字的秒數。
4. 結果丟群組，或直接填在這份檔案裡 commit。

## system prompt

```
你是臺北市政府城市通的語音助手。從下列任務中選出最符合使用者需求的一個，並抽出需要的資料。只輸出 JSON，不要輸出其他文字。
任務：
- parking_fee：查詢或繳納路邊停車費。資料：vehicle（汽車或機車）、plate（車號）
- library_search：在圖書館查書。資料：keyword（書名或作者）
- counter_calling：查詢臨櫃叫號與等候人數。資料：office（地政事務所或戶政事務所或區公所或稅捐處或就業服務站）
- question：詢問規定或其他問題
- other：以上都不是
格式：{"task": "...", "slots": {...}, "question": "task 為 question 時，填使用者的問題"}
使用者沒提到的資料不要填。車號用大寫英文字母和阿拉伯數字，中間加「-」，例如 ABC-1234。
範例：
使用者說：「我要查 ABC 一二三這台機車的停車費」
{"task":"parking_fee","slots":{"vehicle":"機車","plate":"ABC-123"}}
使用者說：「幫我查停車費」
{"task":"parking_fee","slots":{}}
使用者說：「圖書館有沒有東野圭吾的書」
{"task":"library_search","slots":{"keyword":"東野圭吾"}}
使用者說：「戶政事務所現在要等多久」
{"task":"counter_calling","slots":{"office":"戶政事務所"}}
使用者說：「停車費可以去超商繳嗎」
{"task":"question","slots":{},"question":"停車費可以去超商繳嗎"}
```

使用者訊息的格式：`使用者說：「<句子>」`（`llm_poc.html` 會自動加）。`maxTokens` 150。

## 測試句

「期望」是正確答案；「關鍵字備案」是模型不可用時網頁自己判斷的結果（程式實際算出來的），用來看哪些句子特別需要 LLM。

| # | 使用者說 | 期望 | 關鍵字備案 | 要看什麼 | 實際輸出 | 秒數 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 幫我查停車費，車號 ABC 123 | `parking_fee` `{plate: ABC-123}` | parking_fee（沒抽車號） | **沒說車種，會不會自己編 `vehicle`** | | |
| 2 | 我要查 ABC 一二三 機車的停車費 | `parking_fee` `{vehicle: 機車, plate: ABC-123}` | parking_fee {機車} | 跟範例幾乎一樣，基本盤 | | |
| 3 | A B C 杠 一 二 三 那台汽車的停車費 | `parking_fee` `{vehicle: 汽車, plate: ABC-123}` | parking_fee {汽車} | 車號拆開唸、「杠」 | | |
| 4 | 幫我繳停車費 | `parking_fee` `{}` | parking_fee | 「繳」也要選 parking_fee | | |
| 5 | 我的摩托車停車費還沒繳 | `parking_fee` `{vehicle: 機車}` | parking_fee {機車} | 摩托車 → 機車（填「摩托車」也可以，網頁會轉） | | |
| 6 | 停車費要怎麼繳 | `question` | parking_fee | 問規定 vs. 要辦事 | | |
| 7 | 圖書館有沒有東野圭吾的書 | `library_search` `{keyword: 東野圭吾}` | library_search（沒抽關鍵字） | 跟範例一樣 | | |
| 8 | 我想借哈利波特 | `library_search` `{keyword: 哈利波特}` | library_search | 沒說「書」「圖書館」 | | |
| 9 | 戶政事務所現在要等多久 | `counter_calling` `{office: 戶政事務所}` | counter_calling {戶政事務所} | 跟範例一樣 | | |
| 10 | 區公所現在叫到幾號 | `counter_calling` `{office: 區公所}` | counter_calling {區公所} | | | |
| 11 | 敬老卡要怎麼申請 | `question` | question | 沒有對應腳本的規定問題 | | |
| 12 | 圖書館幾點關門 | `question` | library_search | 有「圖書館」但不是查書 | | |
| 13 | 今天天氣好嗎 | `other` 或 `question` | question | 都可以，不能選到腳本 | | |
| 14 | 嗯…那個… | `other` | 聽不懂 | 不能亂選腳本 | | |
| 15 | 停車費 | `parking_fee` `{}` | parking_fee | 很短的句子 | | |

## 網頁端已經處理的（不用模型做對）

- 輸出前後有說明文字、包在 ```` ```json ```` 裡：會去掉
- 車號格式不對（`ABC 123`、`abc123`）：會轉成 `ABC-123`
- 編出腳本沒有的欄位、選項外的值（例如 `vehicle: 腳踏車`）：丟掉，之後再問使用者
- `task` 不在清單內或 JSON 壞掉：改用關鍵字備案

## 最需要回報的

1. **會不會編資料**（第 1 句）：如果常編 `vehicle`，prompt 要加「沒說汽車或機車就不要填 vehicle」的範例。
2. **問規定 vs. 辦事**（第 6、12 句）：如果常選錯，要加範例。
3. **開始出字的秒數**：太慢的話，考慮縮短範例。
4. 有沒有簡體字或英文說明混在輸出裡。
