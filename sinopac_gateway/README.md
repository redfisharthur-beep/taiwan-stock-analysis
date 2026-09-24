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

## 私人功能驗證（不需要電腦持續開機）

回到台股研究室網站搜尋股票代號，例如 `2330`；展開「永豐 Shioaji 私人行情測試」。將**你自行設定的 `SJ_OWNER_TEST_TOKEN`** 輸入密碼框，再按「查詢永豐」。按下後：
1. 前端只把測試碼傳送到自己 Cloudflare 網站的後端；不保存在網頁本機或網址中。
2. Cloudflare 先驗證你的測試碼，再以 `SJ_BRIDGE_TOKEN` 連到固定的 Render 服務。
3. Render 驗證該通行碼後，才使用 Render 自己保存的 `SJ_API_KEY`、`SJ_SEC_KEY` 執行唯讀 Shioaji `snapshots`。
4. 若成功，網頁只顯示該股私人快照的價格和實際時間；**這不是已核定的官方收盤價、也不是即時串流行情。**

若測試頁顯示 `429`，請至少等 90 秒後再試，避免將 snapshots 當成盤中即時推播；Render Free 若休眠會逾時，建議使用可維持運行的付費方案。若登入或安裝失敗，請查看 Render Deploy Logs，只分享**去除金鑰及帳戶資料後的錯誤摘要**。

## 資安與使用權

- 此服務只有 `/health` 公開可讀；`/internal/quote/{stock}` 需要至少 32 字元的 `X-Bridge-Token`。沒有下單路由，只有四位數上市／上櫃股票快照功能。
- Cloudflare `/api/shioaji/test` 另需通過 `SJ_OWNER_TEST_TOKEN`，不使用公開快取，也不讓親友看到你的券商行情；公開 `/api/analyze` 和首頁排名仍使用原有官方及 FinMind 資料。
- 待你**確認永豐個人行情的再展示授權**，才能決定是否對親友顯示、用於公開評分或盤中資料更新。沒有授權時，不能直接把私人帳戶的報價公開轉發。
- Shioaji `snapshots` 不是盤中即時推播，不可反覆輪詢；本服務每次請求限制至少 90 秒，僅作單檔私人連線驗證。
- `SJ_BRIDGE_TOKEN` 和 `SJ_OWNER_TEST_TOKEN` 都不是券商金鑰。若疑似外洩，請兩邊一起換碼並重新部署。
