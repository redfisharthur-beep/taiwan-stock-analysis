# 台股研究室 · Cloudflare Workers v0.5（不使用 D1）

手機、平板及電腦可用的台股研究網站；**不保存歷史榜單、不使用 Cloudflare D1**。首頁自動取得最新可用的官方上市／上櫃行情，按流動性各選五檔候選，使用 FinMind 個股資料核對後產生研究清單。Cloudflare Cache API 對成功清單做 30 分鐘暫存，**這不是歷史資料庫**，快取到期後下次造訪重算。

## 功能與重要限制

- `/api/top5`：讀取 TWSE 和 TPEx 官方最新行情，按當日成交金額預篩**各 5 檔、最多 10 檔**候選；以四個 FinMind 資料集逐檔分析；只比較相同實際交易日、官方收盤價與 FinMind 一致、且具**相同已涵蓋子指標**的候選，至多展示五檔。不足五檔時如實展示少於五檔或顯示原因。官方兩市場資料日期不同時只分析最新相同日期的候選。
- **這不是全市場排名，也不是四大面向完整 100 分的前五名**：成交額預篩可能排除其他優質公司；現階段的消息、財務品質、TDCC 等尚未完成，僅顯示已評子項小計與覆蓋權重。尚不能對外宣稱今日「全上市櫃綜合評分最高 5 檔」或保證個股報酬。
- 每張觀察卡只顯示精簡的四面向數值與兩項高分理由，點開個股可查看四面向摺疊明細、Goodinfo 自動核對狀態與近 70 個交易日日 K（含開高低收及成交股數）。
- Goodinfo：點選「個股查詢」時由 **Cloudflare Worker 直接向 Goodinfo 公開個股頁送出單次 HTTP 請求**，保守解析頁面交易日期及收盤價，再與 TWSE／TPEx、FinMind 比對。**已移除人工輸入表單**；若遇 403、429、登入／驗證碼、解析不符或日期不同，就顯示「暫不可用／日期不同」，不會繞過封鎖或偽造資料。因 Goodinfo 為第三方網站，Cloudflare 實際連線是否成功仍需部署後驗證；目前未確認資料自動取用及公開再展示授權，正式公開前應另行確認。每日十檔預篩**不批量抓 Goodinfo**，只有點開個股才自動核對，避免網站遭受大量重複請求。Goodinfo 不另給額外分數。
- 交易日以官方回傳日期為準，不能使用電腦今天的日期冒充今日股價；休市與官方尚未更新時可能顯示前一交易日。完整研究報告與 K 線的公司行動（除權息、減資）調整、產業相對估值、財報更正與公告仍待補強。
- 每次排行榜冷快取需要最多 2 次官方市場請求 + 40 次 FinMind 個股資料請求；配額與計費視 FinMind 方案及 Cloudflare Workers 計畫而定。高流量、不同 Cloudflare 邊緣節點、快取未命中都可能觸發重算；不保證免費額度足夠。上線前應確認對親友分享時的資料再展示授權。
- 未連結 FinMind Secret 或來源不足時回傳缺資料說明，不以假股票、模擬日期或不完整資料硬補足五檔。

## 雲端部署（全程不必安裝本機程式）

1. Cloudflare Dashboard → Workers & Pages → Create → Import a repository，選 GitHub 倉庫 `redfisharthur-beep/taiwan-stock-analysis`，正式分支 `main`，類型 **Workers**。
2. 根目錄不變；Build command 可留空；Deploy command 設 `npx wrangler deploy`。專案 `wrangler.jsonc` 已指定 `src/worker.js` 與 `public/`。
3. Worker → Settings → Variables and Secrets → Add，類型 **Secret**、名稱 **`FINMIND_TOKEN`**，值貼上你的 FinMind API 金鑰。不要將金鑰貼到 GitHub、公開網頁或聊天訊息。儲存並部署新版本。
4. 開啟 `https://<你的-workers-dev-網址>/api/health` 確認 `finmindConfigured:true` 及 `rankingMode:"on_demand_no_database"`。此步僅驗證已配置金鑰；需要再開首頁測試 2330、上櫃個股與 `/api/top5`，確認 API 權限、實際交易日期、同日官方價核對成功。
5. Cloudflare 連結 GitHub main 後可由 push 自動部署；無需建立 D1、無需執行 schema.sql、無需 DB binding 或排程。

## 未實作但與「全上市櫃前五」有關

真正全市場每天完整四面向排名，需要覆蓋全部上市櫃普通股、清楚界定股票母體、官方／FinMind／合法授權的 Goodinfo 數據交叉驗證、補齊基本面與消息面、處理停牌及金融業特殊指標，再完成時間點一致性與歷史回測。**不用歷史榜單資料庫可以辦到，但需要足夠 API 配額、分批雲端運算與可在當日暫時提供結果的快取。** 目前只有十檔官方成交金額預篩樣本，因此不能代表全市場。

## 檢查程式碼

推送至 main 會由 GitHub Actions 執行 `node --check` 與 `npm test`。部署後仍應實際驗證官方 API 的欄位及 FinMind 的額度、權限，GitHub 離線測試不代表線上資料已核對成功。

## 首頁標題圖

已建立 `public/images/` 目錄，內有 `.gitkeep` 以便 GitHub 保留空目錄。請在 GitHub 的 `public/images/` 中上傳自己的 `hero-title.png`（建議透明背景，手機也可讀的寬版）。前端會自動顯示該檔；如果尚未上傳或圖片讀取失敗，繼續顯示文字標題，不會有破圖。無須修改程式碼，也不需本機安裝。

## 重要說明

Goodinfo 公開頁面有時會出現系統忙碌、存取限制或頁面欄位改版；這是直接連線的**實作與保守解析流程**，不是已證實可從 Cloudflare 成功取得每檔的保證。沒有取得授權時，請勿將大量原站資料複製到親友共享網站；目前只展示三來源同日收盤價是否一致與原始頁連結，不再製表格或新聞內文。
