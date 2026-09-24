import test from "node:test";
import assert from "node:assert/strict";
import {officialCandidates} from "../src/providers.js";
import {discoverNews} from "../src/news.js";
test("independent value prescreen uses official PER/PBR and can exclude first-list stocks",async()=>{
 const original=globalThis.fetch;
 const listed=["2330","2317","1101","1102","1103"].map((stock,i)=>({
  Date:"1150924",Code:stock,Name:"上市"+stock,ClosingPrice:"100",TradeValue:String(1e8-i*1e6),TradeVolume:"10000"}));
 const otc=["5001","5002","5003","5004"].map((stock,i)=>({
  Date:"1150924",SecuritiesCompanyCode:stock,CompanyName:"上櫃"+stock,Close:"50",
  TransactionAmount:String(9e7-i*1e6),TradingShares:"10000"}));
 const listedValue=listed.map((r,i)=>({...r,PEratio:String(i===0?40:i+6),PBratio:String(i===0?7:1.5),DividendYield:"3"}));
 const otcValue=otc.map((r,i)=>({...r,PriceEarningRatio:String(i+7),PriceBookRatio:"1.4",YieldRatio:"4"}));
 globalThis.fetch=async url=>({
  ok:true,status:200,json:async()=>{
   const u=String(url);
   if(u.includes("STOCK_DAY_ALL"))return listed;
   if(u.includes("BWIBBU_ALL"))return listedValue;
   if(u.includes("peratio_analysis"))return otcValue;
   if(u.includes("daily_close_quotes"))return otc;
   return [];
  }
 });
 try{
  const r=await officialCandidates(3,{mode:"value",exclude:["2330"]});
  assert.equal(r.candidates.length,6);
  assert.equal(r.candidates.some(x=>x.stock==="2330"),false);
  assert.equal(r.candidates.every(x=>x.screen?.per>0&&x.screen.pbr>0),true);
 }finally{globalThis.fetch=original}
});
test("news discovery is evidence metadata only, not a verified event score",async()=>{
 const payload={articles:[{title:"台積電取得重大訂單觀察與供應鏈回應",
  url:"https://www.cna.com.tw/news/finance/20260924001.aspx",domain:"cna.com.tw",seendate:"20260924080000"}]};
 const mock=async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify(payload)).buffer});
 const r=await discoverNews("台積電","2026-09-24",mock);
 assert.equal(r.status,"discovered");
 assert.equal(r.articles[0].verification,"not_independently_verified");
});
