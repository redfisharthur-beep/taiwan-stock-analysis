# v0.12 更新：永豐已改為後端自動核對，私人測試介面已移除

- Render 的舊 `/internal/quote/{stock}` 私人快照測試接口及 Cloudflare **已移除** `/api/shioaji/test`，網站不再出現「永豐 Shioaji 私人行情測試」或任何密碼輸入框。Cloudflare 只會在**個股詳細分析**的伺服器端呼叫新接口 `/internal/history/{stock}?date_to=YYYY-MM-DD`，使用早已保存的 `SJ_GATEWAY_URL`、`SJ_BRIDGE_TOKEN`；`SJ_OWNER_TEST_TOKEN` 不再需要，可在 Cloudflare 移除。
- 新接口使用 Shioaji 官方 `api.kbars`，按 **29 天內的非重疊區間**讀取最近約 116 個日曆日的分 K，以完整交易時段末段資料彙整成未還原日線。每個股票＋交易日的結果在 Render 記憶體保存六小時，跨股票額外查詢限速至少 120 秒，避免反覆輪詢與券商流量限制。此資料**不是除權息還原價**，原始分 K 的成交量單位未經核實，絕不冒充 FinMind 的成交股數計算量價。
- Cloudflare 只對照 **同一已完成交易日**的 TWSE／TPEx 官方收盤價、FinMind 原始收盤價與永豐彙整日線收盤價，前端僅顯示「一致、差異、日期不同、暫不可用」等來源狀態，**不顯示個人券商原始價格或 K 線**。若核對不一致或永豐暫不可用，絕不拿券商價覆蓋官方資料，也不任意增加涵蓋率。
- 唯有自行向券商確認你的行情再展示及公開衍生分析權利，並取得適用授權後，才可在 Cloudflare Worker Secret／Variable 額外設定 `SJ_MARKET_DATA_REDISPLAY_APPROVED=true`；此時當 FinMind 原始與還原歷史**都不足 61 筆**且永豐完整日線至少 61 筆、最新日期且收盤價均經三方同日核對，才會用其未還原價後備計算技術指標。未核實成交量單位時，「量價」仍待評，能新增的技術面涵蓋**至多 17／20**（不是保證增加 17 分）。
- **永豐 API 不提供本站所需的營收、現金流、資產負債表、法人買賣、TDCC 大戶週資料與新聞獨立查核；這些部分需保留 TWSE／TPEx、FinMind、TDCC 及其他具權利的新聞來源。** 個股核對也不等於首頁十檔全部已經用永豐重新評分；為遵守個人行情查詢限制，首頁名單不批次觸發券商 K 線。
- Cloudflare `/api/health` 應顯示 `version:"0.12.0"`，Render `/health` 應顯示 `version:"0.2.0"`。這是部署版本，不代表你的券商日線資料已成功取得；在個股詳細頁的「資料來源與更新說明」檢查實際永豐後端自動核對狀態。

**重要：** 舊版以下的「輸入私人測試碼」段落已作廢，請改以上述新版流程為準。別把 API Key、Secret Key、SJ_BRIDGE_TOKEN 放到 GitHub 或對話。

---
# 永豐 Shioaji（Render）唯讀行情服務

此資料夾供 **Render Python 3 Web Service** 獨立部署；現有 Cloudflare Workers 繼續從倉庫根目錄部署。服務不含任何下單、帳戶查詢、CA 憑證或交易訂閱程式。

## Render：建立 Web Service

- GitHub repository: `redfisharthur-beep/taiwan-stock-analysis`，分支 `main`
- **Root Directory: `sinopac_gateway`**（非常重要，不能選倉庫根目錄）
- Runtime / Language: Python 3（不是 Node.js）
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1`
- Health Check Path: `/health`
- Python version: 目錄內 `.python-version` 指定 3.11，搭配已明確指定版本的 Shioaji。
- 機型：建議先選有足夠記憶體的常駐付費 Web Service。若用 Free 測試，閒置 15 分鐘後會休眠，冷啟動可能使 Cloudflare 25 秒逾時；不能保證盤中連續登入。

進入 Render 此 Web Service → Environment，新增（全部在 Render 填值）：

1. `SJ_API_KEY`：你真正的永豐 API Key
2. `SJ_SEC_KEY`：你真正的永豐 Secret Key
3. `SJ_BRIDGE_TOKEN`：**自行產生**的一組長度至少 32 字元的隨機字串。它不是永豐金鑰，而是 Render 與 Cloudflare 兩個伺服器之間的通行碼。

**請勿**上傳永豐 PFX 憑證、CA 密碼、身分證、帳號或交易資料。不要把三個密鑰放進 GitHub、公開網站、截圖或聊天。

部署成功後，開啟 Render 提供的 `https://<你的服務>.onrender.com/health`：`ok: true` 只代表 Python Web Service 已啟動；`credentialsConfigured: true` 只代表環境變數存在，**還不代表永豐登入成功**。首次真正登入需完成下面私人測試。

## Cloudflare：設定 Worker 的 Secrets

在 Cloudflare → Workers & Pages → `taiwan-stock-analysis` → Settings → Variables and Secrets 新增：

- `SJ_GATEWAY_URL`：Render 網站根網址，像 `https://你的服務.onrender.com`（不要附 `/health`、其他路徑、使用者名稱或參數）
- `SJ_BRIDGE_TOKEN`：**與 Render 一模一樣**的隨機通行碼（需至少 32 字元）
- `SJ_OWNER_TEST_TOKEN`：**另外產生**的長隨機測試碼（需至少 32 字元，絕不可和券商 API Key、Secret Key 或 SJ_BRIDGE_TOKEN 相同）

儲存後重新部署 Worker。查看 `https://你的-workers.dev/api/health` 是否顯示 `"sinopacConfigured":true`。這只是設定檢查，**非登入成功保證**。

## 自動核對

進入已部署的台股研究室搜尋 2330，再展開「資料來源與更新說明」，查看永豐自動核對狀態。完全不需要輸入私人測試碼，且不再提供快照測試路由。

## 資安與使用權

- 此服務只有 `/health` 公開可讀；`/internal/history/{stock}` 需要至少 32 字元的 `X-Bridge-Token`，僅讀取已完成交易日的分 K 彙整資料，沒有下單路由。
- Cloudflare 已刪除 `/api/shioaji/test`，個股 `/api/analyze` 會在後端自動嘗試券商同日核對，但不對外回傳券商原始價格或 K 線。
- 待你**確認永豐個人行情的再展示授權**，才能決定是否對親友顯示、用於公開評分或盤中資料更新。沒有授權時，不能直接把私人帳戶的報價公開轉發。
- Shioaji `snapshots` 不是盤中即時推播，不可反覆輪詢；本服務每次請求限制至少 90 秒，僅作單檔私人連線驗證。
- `SJ_BRIDGE_TOKEN` 和 `SJ_OWNER_TEST_TOKEN` 都不是券商金鑰。若疑似外洩，請兩邊一起換碼並重新部署。
