# 台股研究室 v0.15.0

GitHub `main` 原檔維護：`public/index.html`、`public/app.js`、`public/style.css`、`src/worker.js`。
介面使用 Zen Maru Gothic 300/400 日系圓潤字（網路字型載入失敗時採系統字型），莫蘭迪色系區分功能。首頁只有「每日觀察」名單，原有股票搜尋已擴充成代碼或中文名稱搜尋（`/api/search?q=...`），按鈕文字為「分析」。候選股票收盤價須低於 500 元；「被低估」標籤只在來源核實、估值與財報標準全數成立時顯示，絕非保證真實內在價值或買入建議。

## 已完成的原始碼功能

- `src/providers.js`：證交所／櫃買中心公司名冊、同日行情、官方估值，全市場初篩；保存可辨認的產業分類。公司名冊中無當日成交價的公司仍留在母體，不以舊價冒充有效收盤價。
- `src/fundamentals.js`：同一報告期毛利率、營業利益率、淨利率、簡化季度 ROE、流動比率、負債比、營收年增率與營業現金流。財報來源缺欄位、不具可比較期間時輸出 null，不能虛構分數。個股頁保留原始詳細分析及更新日期。
- `src/industry.js`：同市場、同產業及相同報告期的實際有效樣本達 5 檔後計算各指標 PR（原始數值百分位）；樣本不足顯示待查，PR 高低不等於投資優劣。
- `src/market-db.js` + `migrations/0001_market.sql`：可啟用 D1 市場資料庫，記錄全部上市櫃公司名冊及日行情、估值、每檔不同季度的原始公開財報資料集、近 130 筆日價、完整已評分的技術及籌碼研究結果、獨立來源日期及失敗狀態。不得以 null 充當 0 分。
- `src/worker.js`：每個交易日的官方全市場資料排程更新、每五分鐘逐檔限量取得 FinMind 財報／歷史價／法人／融資資料、每週同步 TDCC 集保資料；透過 D1 任務欄位分批接續，不在一次免費 Worker 請求中全市場同時連續發 API。網站讀取已入庫行情時直接出名單；無 D1 時保留原先官方資料即時查詢模式。個股頁 `/api/analyze?stock=2330` 增加基本面細項及可取得的同產業 PR。
- `/api/market-status`：回傳公司數量、財報已入庫數、技術已取得數、籌碼條件已齊數和最近更新時間；`/api/health` 顯示 `marketDBConfigured`。這些數量代表確實儲存的檔數，不代表每檔的所有項目已齊或當日皆已更新。

## 必做：在 Cloudflare 綁定 D1 後才能開始實際入庫

GitHub 原始碼、資料表 migration 和 Cron 已提交，但**無法從只有 GitHub 連線的工作環境，替你的 Cloudflare 帳號建立資料庫、取得資料庫 ID 或替你部署 migration**。目前尚未核實 D1 已綁定／資料已填入，不能宣稱全市場財報、籌碼、技術都已完成。請在已連線 Cloudflare 帳戶的本地 terminal 或 Cloudflare 可用的 CLI 環境按順序執行：

```bash
npm install
npx wrangler d1 create taiwan-stock-market
```

將上一步輸出的實際 `database_id` 填進現有 `wrangler.jsonc` 頂層（與 `triggers` 同層）的 `d1_databases` 配置；不要把假 ID 或 D1 API Token 推到 GitHub。

```json
"d1_databases": [
  {
    "binding": "MARKET_DB",
    "database_name": "taiwan-stock-market",
    "database_id": "貼入 Cloudflare 回傳的實際資料庫 ID",
    "migrations_dir": "migrations"
  }
]
```

接著執行：

```bash
npx wrangler d1 migrations apply taiwan-stock-market --remote
npx wrangler deploy
```

在 Cloudflare Worker Secrets 確認 `FINMIND_TOKEN` 仍有效；永豐 `SJ_API_KEY`／`SJ_SEC_KEY` 只放在既有 Render 服務，不放前端或 GitHub。瀏覽 `/api/health` 應顯示 `version:"0.15.0"` 和 `marketDBConfigured:true`；瀏覽 `/api/market-status` 查目前已儲存檔數及更新時間。D1 若尚未初始化則市場同步功能不會啟動，公開網站可繼續使用現有即時查詢模式。

已配置的 Cron（UTC）：

- `0 11 * * 1-5`：交易日台北時間 19:00 以官方名冊與最新行情建立市場快照；官方市場資料未齊時保留前一份資料庫快照。
- `*/5 * * * *`：逐次選取一檔資料庫中的公司，抓取九項 FinMind 資料集及技術、籌碼來源，保存多期財報與近期歷史價格。資料失敗記錄錯誤並在之後重試；不可超出 FinMind 授權流量、Cloudflare D1 配額或延遲要求。
- `30 11 * * 5`：台北時間週五 19:30 嘗試讀取 TDCC 週股權分散資料並保存每檔有效股權分散與三週趨勢。

**完整母體入庫與各檔資料補齊不是同一件事。** 建立資料庫後應持續核對 `/api/market-status` 中的 `total/finance/technical/chips` 差距。停牌、停止交易、財報尚未公告、FinMind 授權或額度不足、資料來源格式改變、金融業特殊會計口徑時，個股財務／技術／籌碼可能仍為待查；不得標示為全市場 100% 完成。現行排程為避免公開行情被個人券商資料再散布，不會對全市場輪詢或輸出私人永豐行情。Cron、資料表 migration 及靜態測試通過也**不等於**已完成 Cloudflare 線上部署或首次完整回填。

## 測試

`npm test` 測試行情缺值、篩選、實際財報衍生指標、同產業有效樣本、搜尋、技術及券商資料核對；GitHub Actions 另檢查 JavaScript 語法與 SQL migration。測試本身不能代替正式 API 來源及部署驗收。

研究資訊非投資建議，分數和 PR 均不保證未來報酬。
