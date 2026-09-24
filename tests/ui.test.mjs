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
 assert.doesNotMatch(html,/想查哪一檔股票？|每日觀察 5 檔|價值投資觀察 5 檔|id="value-list"/);
 assert.match(js,/el\("button","分析","daily-action"\)/);
 assert.doesNotMatch(js,/查看分析 →|refreshValue\(/);
 assert.match(js,/api\/search\?q=/);
});
test("single original stylesheet defines Morandi palettes and rounded light font",()=>{
 assert.match(css,/Zen Maru Gothic/);
 for(const selector of [".search{background:","#daily-panel{background:","#financial-panel{background:",
  "#comparison-panel{background:","#chart-panel{background:"]){
  assert.ok(css.includes(selector),selector);
 }
 assert.equal((css.match(/:root\{/g)||[]).length,1);
 assert.match(css,/body\{[^}]*font-size:19px;[^}]*font-weight:700/);
 assert.match(css,/#ticker\{[^}]*font-size:21px;[^}]*font-weight:700/);
 assert.doesNotMatch(css,/font-weight:(?:300|400|500|600)/);
 assert.match(html,/Zen\+Maru\+Gothic:wght@700/);
});
test("Cloudflare cron weekday names cannot unintentionally include Sunday",()=>{
 assert.deepEqual(wrangler.triggers.crons,
 ["*/5 * * * *","0 11 * * MON-FRI","30 11 * * FRI"]);
});
