import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import {securityKind} from "../src/instruments.js";

const date="1150924";
const listed=[
 {Date:date,Code:"1001",Name:"上市甲",ClosingPrice:"120",TradeValue:"90000000",TradeVolume:"80000"},
 {Date:date,Code:"1002",Name:"高價上市乙",ClosingPrice:"760",TradeValue:"70000000",TradeVolume:"60000"},
 {Date:date,Code:"0050",Name:"元大台灣50",ClosingPrice:"180",TradeValue:"500000000",TradeVolume:"600000"},
 {Date:date,Code:"02001",Name:"ETN 指數投資證券",ClosingPrice:"50",TradeValue:"90000000",TradeVolume:"10000"}];
const otc=[
 {Date:date,SecuritiesCompanyCode:"2001",CompanyName:"上櫃甲",Close:"210",
  TransactionAmount:"28000000",TradingShares:"50000"},
 {Date:date,SecuritiesCompanyCode:"00980T",CompanyName:"上櫃債券ETF",Close:"17",
  TransactionAmount:"18000000",TradingShares:"55000"}];
const getMock=async url=>{
 if(url.includes("STOCK_DAY_ALL"))return listed;
 if(url.includes("daily_close_quotes"))return otc;
 if(url.includes("BWIBBU_ALL"))return [{Date:date,Code:"1001",PEratio:"12",PBratio:"1.2",DividendYield:"3"}];
 if(url.includes("peratio_analysis"))return [{Date:date,SecuritiesCompanyCode:"2001",
  PriceEarningRatio:"12",PriceBookRatio:"1.2",YieldRatio:"3"}];
 if(url.includes("t187ap03_L"))return ["1001","1002"].map(code=>({"公司代號":code,"公司簡稱":"公司"+code}));
 if(url.includes("t187ap03_O"))return [{SecuritiesCompanyCode:"2001",CompanyAbbreviation:"上櫃甲"}];
 throw Error("unexpected official URL "+url);
};
async function mockWorker(path){
 const originalFetch=globalThis.fetch,originalCache=globalThis.caches;
 globalThis.fetch=async url=>({ok:true,status:200,json:async()=>getMock(String(url))});
 globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
 try{
  return await worker.fetch(new Request("https://example.test"+path),
   {ASSETS:{fetch:async()=>new Response("missing",{status:404})}},
   {waitUntil:()=>{}});
 }finally{globalThis.fetch=originalFetch;globalThis.caches=originalCache}
}
test("homepage never invents a full-market top five without persisted source-verified scores",async()=>{
 const response=await mockWorker("/api/observations");
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.ready,false);
 assert.deepEqual(data.stocks,[]);
 assert.match(data.reason,/資料庫/);
});
test("ETF lookup returns independent fund price/technical model even without FinMind/D1",async()=>{
 const response=await mockWorker("/api/analyze?stock=0050");
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.kind,"etf");
 assert.equal(data.official.source,"TWSE");
 assert.equal(data.finmind.close,180);
 assert.equal(data.score.score,null);
 assert.deepEqual(Object.keys(data.score.parts),["technical"]);
 assert.equal(data.financialInsights,null);
 assert.equal(data.industryComparison.items.length,0);
});
test("fund identity cannot be inferred for ETNs or warrants",()=>{
 assert.equal(securityKind("02001",{quotedName:"ETN 指數投資證券"}),null);
 assert.equal(securityKind("0050",{quotedName:"元大台灣50"}),"etf");
 assert.equal(securityKind("1001",{company:true,quotedName:"公司甲"}),"stock");
});
