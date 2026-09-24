import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const js=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const wrangler=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));

test("newbie homepage uses single daily list and stock keyword query with simple Analyze action",()=>{
 assert.match(html,/placeholder="輸入股票代碼或文字"/);
 assert.match(html,/每日觀察<\/h2>/);
 assert.doesNotMatch(html,/新手先看這裡：3 個數字怎麼理解？|class="newbie-guide"/);
 assert.match(js,/\["上市股票"/);
 assert.match(js,/\["上櫃股票"/);
 assert.match(js,/\["ETF"/);
 assert.match(js,/el\("div",stock.market,"daily-sub"\)/);
 assert.doesNotMatch(js,/stock.market\+" · 最近收盤 "/);
 assert.doesNotMatch(html,/想查哪一檔股票？|每日觀察 5 檔|價值投資觀察 5 檔|id="value-list"/);
 assert.match(js,/el\("button","分析","daily-action"\)/);
 assert.doesNotMatch(js,/查看分析 →|refreshValue\(/);
 assert.match(js,/api\/search\?q=/);
});
test("single original stylesheet defines Morandi palettes and rounded light font",()=>{
 assert.doesNotMatch(css,/Zen Maru Gothic/);
 for(const selector of [".search{background:","#daily-panel{background:","#financial-panel{background:",
  "#comparison-panel{background:","#chart-panel{background:"]){
  assert.ok(css.includes(selector),selector);
 }
 assert.equal((css.match(/:root\{/g)||[]).length,1);
 assert.match(css,/body\{[^}]*font-size:19px;[^}]*font-weight:700/);
 assert.match(css,/#ticker\{[^}]*font-size:21px;[^}]*font-weight:700/);
 assert.doesNotMatch(css,/font-weight:(?:300|400|500|600)/);
 assert.match(html,/Noto\+Sans\+TC:wght@(?:300;)?400;500;600;700;800/);
});
test("Cloudflare cron weekday names cannot unintentionally include Sunday",()=>{
 assert.deepEqual(wrangler.triggers.crons,
 ["*/5 * * * *","0 11 * * MON-FRI","30 11 * * FRI"]);
});

test("requested long boilerplate is absent from both HTML and stock-card renderers",()=>{
 const unwanted=[
  "部分市場或公司名冊資料尚未齊備；請以個股來源為準。",
  "財報尚待核對，不能只憑低本益比判斷價值。",
  "個股詳細資料待補",
  "財報或同日歷史行情待核對，暫不標記被低估。",
  "官方與 FinMind 同日價格一致",
  "部分來源暫未取得，詳見「資料來源與更新說明」。",
  "同市場同產業：",
  "資料期：",
  "K 線顯示真實成交價；技術指標優先採還原價",
  "尚待完成："
 ];
 for(const phrase of unwanted){
  assert.equal(html.includes(phrase)||js.includes(phrase),false,phrase);
 }
});

test("stock research shows observed points separately from coverage and splits EPS/Yoy into rows",()=>{
 assert.match(js,/基本面/);
 assert.match(js,/資料涵蓋/);
 assert.match(js,/綜合分數/);
 assert.match(js,/待資料齊全/);
 assert.match(js,/const metricDetails=item=>/);
 assert.match(js,/case "EPS 與去年同季":/);
 assert.match(js,/score-metric/);
 assert.match(css,/\.score-metric\{/);
 assert.doesNotMatch(js,/box\.append\(el\("span",label\),el\("strong",display\),\s*el\("small",note\)\)/);
 assert.match(js,/400張以上持股三週趨勢/);
 assert.match(js,/近期重點新聞/);
 assert.match(js,/source\.status==="other_market"\|\|source\.status==="not_connected"/);
});
