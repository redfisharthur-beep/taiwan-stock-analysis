import test from "node:test";import assert from "node:assert/strict";
import {concentration} from "../src/holding.js";
import {eventKind,parseDisclosures,corroborate,scoreNews,researchNews} from "../src/news.js";
import {valueWatchlist} from "../src/value.js";
function weekly(date,largePct=10){
 return Array.from({length:17},(_,i)=>({"資料日期":date,"證券代號":"2330","持股分級":String(i+1),
 "股數":String(i+1===17?100000000:2000+i*100),"占集保庫存數比例%":String(i>=11&&i<=14?largePct:1)}));
}
test("official TDCC 400 lots concentration calculated from four valid tiers",()=>{
 const r=concentration([...weekly("20260904",8),...weekly("20260911",9),...weekly("20260918",10)],"2330","2026-09-24");
 assert.equal(r.share,40);assert.equal(r.change,4);assert.equal(r.trend.risingWeeks,2);assert.equal(r.trend.changeTwoWeeks,8);assert.equal(r.date,"2026-09-18");
});
test("wrong ticker, stale date or missing tiers cannot fabricate concentration",()=>{
 assert.equal(concentration(weekly("20260918"),"2317","2026-09-24"),null);
 assert.equal(concentration(weekly("20260201"),"2330","2026-09-24"),null);
 assert.equal(concentration(weekly("20260918").slice(0,13),"2330","2026-09-24"),null);
});
test("official disclosure alone not sufficient for independently corroborated sentiment",()=>{
 const official=parseDisclosures([{"公司代號":"2330","主旨 ":"公告本公司取得重大訂單","發言日期":"1150924"}],
 "2330","2026-09-24","MOPS","https://openapi.twse.com.tw");
 assert.equal(official.length,1);assert.equal(scoreNews(corroborate(official,[],"2330")).status,"unverified");
});
test("matching independent origin and event kind can be corroborated",()=>{
 const official=parseDisclosures([{"公司代號":"2330","主旨":"公告本公司取得重大訂單","發言日期":"1150924"}],
 "2330","2026-09-24","MOPS","https://openapi.twse.com.tw");
 const a=[{stock:"2330",publisher:"中央社",originalPublisher:"中央社",
 title:"台積電公告取得重大訂單 相關供應鏈持續關注",url:"https://www.cna.com.tw/news/test",eventType:"order_won",publishedAt:"2026-09-24"}];
 const result=scoreNews(corroborate(official,a,"2330"));assert.equal(result.status,"corroborated_event");
 assert.equal(result.items[0].score,4);assert.equal(result.items[1].score,3);
});
test("syndicated or source-spoofed pieces do not create independent news scores",()=>{
 const official=parseDisclosures([{"公司代號":"2330","主旨":"公告本公司取得重大訂單","發言日期":"1150924"}],
 "2330","2026-09-24","MOPS","https://openapi.twse.com.tw");
 const article={stock:"2330",publisher:"中央社",originalPublisher:"Reuters 路透社",title:"公告取得重大訂單",
 url:"https://example.com/item",eventType:"order_won",publishedAt:"2026-09-24"};
 assert.equal(scoreNews(corroborate(official,[article],"2330")).status,"unverified");
});
const metric=(name,score,value)=>({name,score,value,max:10,date:"2026-06-30"});
const make=(stock,per,pbr,yieldPct,quality=8)=>({stock,name:"測試公司",market:"上市",
 finmind:{date:"2026-09-24",close:100},official:{date:"2026-09-24"},
 verification:{state:"一致"},valuationLatest:{date:"2026-09-24",per,pbr,dividendYield:yieldPct},
 score:{metrics:{perPercentile:25},parts:{fundamental:{items:[
  metric("EPS 與去年同季",10,{eps:3,yoyPct:20}),
  metric("營業現金流（初步）",10,100),
  metric("獲利品質與負債",quality,{debtRatioPct:40,cashConversion:1}),
  metric("單月營收年增率",10,"5%")
 ]}}}});
test("value list requires own-history relative PE plus positive EPS cash flow and sound debt",()=>{
 const good=make("2330",12,1.3,4),bad=make("2317",50,5,0);
 const r=valueWatchlist([good,bad],{marketDate:"2026-09-24",candidateCount:2});
 assert.equal(r.stocks.length,1);assert.equal(r.stocks[0].stock,"2330");assert.equal(r.stocks[0].valueChecklist,92);
});
test("high debt or missing historical valuation excludes value-trap candidate",()=>{
 const weak=make("2330",12,1.3,4,0),poor=make("2317",12,1.3,4);
 poor.score.metrics.perPercentile=null;
 const r=valueWatchlist([weak,poor],{marketDate:"2026-09-24",candidateCount:2});
 assert.equal(r.stocks.length,0);
});
test("single TDCC week shows share but cannot earn concentration-trend score",()=>{
 const one=concentration(weekly("20260918",10),"2330","2026-09-24");
 assert.equal(one.share,40);assert.equal(one.trend,null);
});
