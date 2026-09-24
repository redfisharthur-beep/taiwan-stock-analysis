# v0.12：永豐改由後端自動核對，移除私人測試介面

已移除網頁中的「永豐 Shioaji 私人行情測試」密碼框及 Cloudflare 測試 API；Render 也不再提供舊的快照測試端點。**使用者進入個股詳細頁時，Cloudflare 後端會使用既有 Render 通行碼，在獨立服務上向永豐查詢已完成交易日的歷史分 K，彙整為未還原日線，交叉核對 TWSE／TPEx 官方及 FinMind 的同交易日收盤價。** 只回傳來源核對狀態，不向公開網站發送永豐原始行情。舊的 `SJ_OWNER_TEST_TOKEN` 可從 Cloudflare 移除。

- Render 需要從 GitHub main 重新部署新程式；`/health` 應顯示 `version:"0.2.0"`。Cloudflare 需重新部署新版；`/api/health` 應顯示 `version:"0.12.0"` 和 `brokerAutomaticCheck:true`。部署成功**不代表**已取得有效永豐歷史 K 線；請在個股頁下方「資料來源與更新說明」查看自動核對狀態。未取得永豐資料時原有官方及 FinMind 分析繼續運作。
- 僅當你的 Shioaji 個人行情契約**明確允許向其他訪客再展示或公開衍生分析**時，才可在 Cloudflare 加上 `SJ_MARKET_DATA_REDISPLAY_APPROVED=true`。在該設定下，FinMind 還原／原始歷史不足 61 筆、永豐完整日線至少 61 筆且最新同日價格經官方與 FinMind 三方核對時，可將永豐日線作為**未還原技術指標後備**。因券商分 K 成交量單位未驗證，量價子項仍不計分，最多補技術面 17／20 權重，並不代表個股分數增加 17 分。
- 永豐 Shioaji 行情不會提供本站需要的 EPS、月營收、財報負債、法人買賣、集保戶分散度或獨立新聞真實性查核；不能單靠多一個行情 API 就補滿基本面／消息面／籌碼面。考慮個人帳戶查詢限制，**目前永豐僅在個股詳細分析時作後端同日核對，不會為首頁所有榜單候選股輪詢券商行情**；這也不是即時推播服務。
- 不用提供任何永豐金鑰給本專案的公開前端；`SJ_API_KEY` 和 `SJ_SEC_KEY` 仍只放 Render 的 Secret，Cloudflare 只需 `SJ_GATEWAY_URL` 及 `SJ_BRIDGE_TOKEN`。既有 FinMind 分數與新聞資料規則維持；缺資料不灌分，不用 D1。

詳見 [Render 自動核對設定與限制](sinopac_gateway/README.md)。

---
# v0.11：永豐 Shioaji 已加入私人雲端連線程式（待你在 Render 設金鑰部署）

已於同一 GitHub 倉庫新增 `sinopac_gateway/`（Render Python 3.11 + FastAPI + Shioaji 唯讀快照服務），以及 Cloudflare `src/sinopac.js` 與網站個股頁「永豐 Shioaji 私人行情測試」。**你不需要讓家裡電腦開機，也不需要 D1。**

- Render 服務 Root Directory 設 `sinopac_gateway`，Build Command `pip install -r requirements.txt`，Start Command `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1`。
- Render Environment：`SJ_API_KEY`、`SJ_SEC_KEY`、`SJ_BRIDGE_TOKEN`。券商金鑰只保留在 Render，**不要貼到 GitHub 或聊天**。
- Cloudflare Worker 的 Variables and Secrets：`SJ_GATEWAY_URL`（Render 提供的根網址）、`SJ_BRIDGE_TOKEN`（與 Render 相同的至少 32 字元隨機碼）、`SJ_OWNER_TEST_TOKEN`（另外產生的至少 32 字元私人測試碼）。
- 部署後，`/api/health` 顯示 `version:"0.11.0"`、`sinopacConfigured:true`；然後在台股研究室查詢 2330，展開「永豐 Shioaji 私人行情測試」，只輸入你**自行設定的私人測試碼**，查詢唯讀行情。
- 公開網站的 FinMind／官方評分與兩份觀察清單仍不使用個人券商報價。永豐私人快照目前僅供本人測試；是否能讓親友查看，必須先確認其個人行情再展示授權。Shioaji 快照不是即時推播或官方收盤價，也不能補足消息面分數。

**完整操作步驟：** [sinopac_gateway/README.md](sinopac_gateway/README.md)。首次登入 Shioaji 只有 Render 實際啟動並設定正確金鑰後才會發生；GitHub 單元測試不能證明你的帳戶已登入永豐。

---

# v0.10 技術面覆蓋修正與可追查資料診斷

當 FinMind `TaiwanStockPriceAdj` 還原價資料集沒有回應、日期較原始成交價晚更新、或與原始價不能對齊至少 61 個交易日時，舊版直接將所有技術指標標為「未涵蓋」，造成已有真實歷史行情的股票仍顯示技術面 0/20。

新版依順序使用：(1) 同日且至少 61 筆真實還原價，成交量使用日期對齊的原始日行情；(2) 還原價不可用時，使用至少 61 筆真實原始日行情計算，並在每個技術指標、個股頁及 API 中明確標示「未還原」與除權息／減資／分割的風險；(3) 兩者皆不足時維持未評分，**不會為增加涵蓋率生成行情、偽造還原價或調整缺值分數**。兩種價格口徑在榜單中不混合排序。

`/api/analyze?stock=2330` 新增 `datasetHealth`（九個 FinMind 資料集各自的成功／空值／失敗狀態、筆數及最近日期）、`missingMetrics`（實際缺漏項目與原因），以及 `score.diagnostics.technical`（採用的技術價格口徑、原始／還原價筆數及最新日期）。畫面「資料來源與更新說明」會顯示這些狀態，方便辨認 PER 歷史筆數、TDCC 三期週資料、授權新聞等未涵蓋原因。

消息面目前缺乏完成來源授權及同事件獨立核對，仍可能 0/10 涵蓋；TDCC 要求三期連續且有效的分散度資料，可能缺 5/20。金融業、首次上市、近期除權息、消息事件及財報日期應依各自口徑額外檢查。**沒有消息不等於 0 分的負面評價，也不等於消息面已完成 10/10 核實**。要補足消息面需實際可用且具權利的來源，不能直接以搜尋新聞標題給分。

新版 `/api/health` 會顯示 `version:"0.10.0"`，三個 API 的快取鍵已更新，部署後不沿用舊評分。GitHub 單元測試只能驗證計分與格式，不能保證 Cloudflare 真實資料集當天可讀；請在正式網址上確認 `/api/analyze?stock=2330` 返回的診斷資料。

---
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
