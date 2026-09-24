# 台股研究室 · Cloudflare Workers v0.2

跨手機、平板及電腦的響應式台股研究介面，使用 Cloudflare Workers 託管網站與資料 API。**此版本為可部署的單檔查詢與資料核對 MVP，不是完成的全市場評分或即時交易系統。**

## 現有功能

- FinMind：歷史日行情、月營收、EPS 所在財報、法人交易的個股查詢。使用者帳戶需要具備各資料集存取權限。
- TWSE / TPEx：取得最近的官方收盤資料；只有當官方與 FinMind 記錄屬於相同交易日才比價；日期不明與資料衝突會明確標記。
- 四面向固定權重：基本面 50、消息面 10、籌碼面 20、技術分析 20。尚未介接的財務品質、股權、融資券及消息細項標記「資料不足」，不把缺失重分配權重，也不假造完整的 100 分。已評子項只作研究參考。
- Goodinfo：個股連結與**使用者手動輸入同日收盤價核對**。未獲 Goodinfo 自動擷取授權，沒有爬蟲或假裝已自動查證。手動數值不傳送到後端，不參與評分。
- 研究來源、資料日期、驗證狀態、資料覆蓋率與官方來源連結；使用者可直接分享 `?stock=2330` 個股網址。
- 已附基本單元測試與 GitHub Actions。資料與指標皆可能延遲或有誤；技術指標未納入除權息與減資價格調整。

## 連線 FinMind（請勿在聊天或 GitHub 分享金鑰）

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 的 Workers & Pages 建立 Worker，點選 **Import a repository**，選擇 `redfisharthur-beep/taiwan-stock-analysis` 的 `main` 分支。
2. 專案類型使用 **Workers**，根目錄留空；Build command 留空，Deploy command 輸入 `npx wrangler deploy`。本專案 `wrangler.jsonc` 已指定靜態資產 `public/` 與後端 `src/worker.js`，不需要 Python 主機，也不使用 Pages 專用建置。
3. 首次部署後進入該 Worker → Settings → Variables and Secrets → Add → 類型 **Secret**；名稱必須為 `FINMIND_TOKEN`，值貼入你的 FinMind API 金鑰。儲存並確保使用含 Secret 的新部署版本。
4. 開啟 `https://<你的 workers.dev 網址>/api/health`，確認 `finmindConfigured: true`。這只表示有設定金鑰，還要再開首頁測試 2330（上市）及一檔上櫃股票，確定 FinMind 權限、資料日期與 API 回傳格式皆有效。
5. 在 Cloudflare 設定 Worker 的 Git repository 與 main 生產分支，未來 GitHub 更新才能自動部署。經過資料授權與資料品質檢驗後，才將正式版網址分享給親友。

## 問題排查

- `/api/health` 回傳 `false`：Worker 尚未配置金鑰、名稱錯誤或新版尚未部署。
- 查詢回傳 503：FinMind 配額、金鑰、上游服務或連線可能異常；程式不以測試數據補值。
- 官方核對顯示日期不一致／未知：官方行情與 FinMind 必須是同一交易日，先檢查端點資料格式與時區。
- 若股票為停牌、剛掛牌、金融業、除權息或特殊公司行動，現行通用指標可能不適合，請回原始公告核對。
- Repo 為公開倉庫，`.dev.vars`、`.env` 已加入 `.gitignore`，API key 只能設定為 Cloudflare Secret。

## 尚未實作（正式發布前應規劃）

全市場批次股票排名及 D1 歷史資料庫、進階 ROE／現金流、金融業專用模型、TDCC 股權、融資融券、重大公告及新聞的多來源查證、修正後還原價、公司行動、歷史回測、使用者登入與個人自選股、**授權後的 Goodinfo 自動比對**。全市場查詢和公開再散布前，確認 FinMind、TWSE、TPEx 與 Goodinfo 的資料使用授權、API 速率及再展示規定。

## 測試

GitHub Actions 於 push main 後執行 `npm test`；若需要本地測試，`npm install && npm test`。本地開發可建立未追蹤的 `.dev.vars` 並執行 `npm run dev`；正式網站不需要在你的電腦運作。
