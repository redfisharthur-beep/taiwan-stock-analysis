# 台股研究室 · Cloudflare Workers v0.9

以手機、平板和電腦瀏覽的台股研究網站。使用 GitHub `main` 部署 Cloudflare Workers；**不需要 D1、不保存歷史榜單**。首頁標題圖片是既有的 `public/images/stock.png`，在桌面和手機置中顯示，可直接替換同名檔更新。

## 使用及限制

- **每日綜合觀察 5 檔：** 免費 Workers 模式最多分析同交易日、由官方成交金額預篩的 5 檔候選；付費模式環境變數 `FULL_SCREENING_ENABLED=true` 時可預篩上市與上櫃各 5 檔，但仍**不是全上市櫃股票的完整排名**。若來源缺失或候選未通過核對，顯示少於 5 檔。
- **價值投資觀察 5 檔：** 另一次無資料庫的 API 請求，先以官方 PE/PBR 預篩，再查 FinMind EPS、現金流、負債、個股近一年 PE 相對位置。需同時具備兩項估值訊號、正 EPS／現金流及初步財務品質；不符合條件就不列出，不製造「已低估」或合理價結論。
- **固定四面向權重**為基本面 50、消息面 10、籌碼面 20、技術面 20。畫面分別顯示「已評子項小計」（只加總有依據的分數）、「資料涵蓋權重」（0～100），不把缺值計 0、不依已完成項目重新配成 100 分。**100 分完整總評必須涵蓋四大面向所有項目才出現。**
- 資料日期以官方行情實際交易日及各個 API 原始日期為準。休市時可能顯示前一交易日，並非即時盤中行情；價格核對始終使用 **原始收盤價**。

## v0.9 評分資料及口徑

| 面向 | 固定滿分 | 實際子項 |
|---|---:|---|
| 基本面 | 50 | 月營收同比 10；同季 EPS 同比 10；營業現金流 10；現金獲利品質／負債比 10；**個股自身一年本益比分位** 10 |
| 消息面 | 10 | 經核實重大公告 5；獨立媒體報導 3；產業事件 2（未完成自動核實時標為待評） |
| 籌碼面 | 20 | **法人近五交易日淨買賣／同五日總成交股數** 10；TDCC 集保 400 張以上**三期連續週占比及增減** 5；融資餘額變化 5 |
| 技術面 | 20 | **還原價**均線 6；RSI 3；MACD 3；量價 3；**20 日波動年化和 60 日最大回撤** 5 |

### 原始價格和還原價

- `TaiwanStockPrice`：原始開高低收及成交股數，用於官方當日收盤核對、K 線、五日法人淨買賣比率的成交量分母。
- `TaiwanStockPriceAdj`：除權息調整後歷史價，**僅供技術指標、報酬波動、最大回撤計算**；不與 TWSE／TPEx 原價直接比較。必須同股票、同最新交易日、有至少 61 筆且日期可對應原始行情才給技術面分數。FinMind 帳戶如無權限或資料有缺，技術面顯示待評，不使用未調整價格冒充還原價。K 線仍顯示實際原價。
- FinMind 不同會員等級可能有不同資料集存取權限。新增 `TaiwanStockBalanceSheet`（資產／負債）、拉長 `TaiwanStockPER` 歷史到約 410 日；若資料缺漏或財務數字不適合比較，就不計分。現金獲利品質使用同現金流量表期間的營業活動淨現金流／稅前淨利，加上最近有效期的負債／資產比。**金融股、特殊股本變動及不同產業應另設模型，不宜直接套一般製造業分數。**

### TDCC 三週趨勢

`src/holding.js` 使用 TDCC 官方週資料的 12–15 級合計（約 400 張以上集保占比），**連續三期有效資料**才能評趨勢分；兩期之間需有合理週距、最新一期需在兩週內。只有單週比例可顯示但**不給股權趨勢分數**。此占比不等於實際前十大股東持股。

### 消息面查證

MOPS／TWSE／TPEx 官方重大事件與合法授權的中央社、MoneyDJ、Reuters 原始報導應按同一事件、原始發稿來源和日期比對。個股頁可透過 GDELT 找到更多媒體連結，**僅當待核實線索展示，不憑標題判利多或利空**。未連結合法授權的媒體內容時，新聞分數可能維持待評；不從外站批次繞過封鎖或複製全文。

## GitHub → Cloudflare 部署

1. 在 Cloudflare Workers & Pages 選擇 Import a repository，連接 `redfisharthur-beep/taiwan-stock-analysis` 的 `main`；選 **Workers**，Build command 留空，Deploy command 設 `npx wrangler deploy`。
2. Worker → Settings → Variables and Secrets 新增 **Secret** `FINMIND_TOKEN`，值為你的 FinMind 金鑰。不要把金鑰貼到聊天或公開 GitHub。
3. 開啟 `https://<你的-worker-url>/api/health`，確認 `version:"0.8.0"` 及 `finmindConfigured:true`。這只檢查設定，**還需要測試** `/api/analyze?stock=2330`、`/api/top5`、`/api/value5` 的實際 API 回應和來源日期。
4. 免費 Workers 單次請求的外部子請求有額度上限。榜單免費模式最多 5 檔、每檔 9 次 FinMind 查詢，會接近限額；若產生網路轉址、配額限制或錯誤就會顯示資料不可用。付費大樣本需另確認 Cloudflare 和 FinMind 的實際計費／使用上限。

## 修改原檔與驗證

介面位於 `public/index.html`、`public/style.css`、`public/app.js`；評分位於 `src/scoring.js`，資料取用 `src/providers.js`、`src/holding.js`，價值篩選 `src/value.js`，後端 `src/worker.js`。修改現有檔案即可，不須新增覆蓋用 CSS。GitHub Actions 執行 JavaScript 語法檢查與單元測試；**測試通過不等於已在你的 Cloudflare Worker 成功完成真實 FinMind/TDCC 介接**。

個股研究用途，不構成報酬保證或個別化買賣建議。
