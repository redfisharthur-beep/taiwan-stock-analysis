import test from "node:test";
import assert from "node:assert/strict";
import {parseGoodinfoQuote,getGoodinfoQuote,compareGoodinfo} from "../src/goodinfo.js";
const html=(day="09/24",close="2,500")=>
 '<html><head><title>2330 台積電</title></head><body><h1>2330 台積電</h1><p>日期: '+day+
 '</p><table><tr><td>成交價</td><td>昨收</td><td>漲跌價</td><td>漲跌幅</td><td>振幅</td>'+
 '<td>開盤</td><td>最高</td><td>最低</td></tr><tr><td>'+close+
 '</td><td>2490</td><td>10</td><td>0.4%</td></tr></table>'+("文字說明".repeat(30))+'</body></html>';
test("parse same-day public quote from explicit labeled table",()=>{
 assert.deepEqual(parseGoodinfoQuote(html(),"2330"),{day:"09/24",close:2500});
});
test("never guess data from page without expected table",()=>{
 assert.equal(parseGoodinfoQuote('<p>2330 日期: 09/24 成交價 2500</p>'+"x".repeat(200),"2330"),null);
});
test("do not bypass a blocked page",()=>{
 assert.equal(parseGoodinfoQuote(html().replace("2330 台積電","系統忙碌中"),"2330"),null);
});
test("real fetch date mismatch prevents cross-day comparison",async()=>{
 const fetcher=async()=>({ok:true,headers:new Headers({"content-type":"text/html"}),arrayBuffer:async()=>new TextEncoder().encode(html("09/23")).buffer});
 const got=await getGoodinfoQuote("2330","2026-09-24",fetcher);
 assert.equal(got.status,"different_day");
});
test("compare Goodinfo to official and FinMind only on matching trading date",()=>{
 const official={date:"2026-09-24",close:2500},finmind={date:"2026-09-24",close:2500};
 assert.equal(compareGoodinfo({status:"available",day:"09/24",close:2500},official,finmind).status,"matched");
 assert.equal(compareGoodinfo({status:"available",day:"09/24",close:2499},official,finmind).status,"mismatch");
 assert.equal(compareGoodinfo({status:"available",day:"09/24",close:2500},official,{date:"2026-09-23",close:2500}).status,"unverified");
});
