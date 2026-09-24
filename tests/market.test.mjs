import test from "node:test";
import assert from "node:assert/strict";
import {searchOfficialCompanies} from "../src/providers.js";
import {peerPercentile,buildPeerComparison} from "../src/industry.js";
import {summarizeFinancialStatements} from "../src/fundamentals.js";
import {hasMarketDB} from "../src/market-db.js";

test("name, code and partial keyword search use only verified listed/OTC registry entries",async()=>{
 const fetchJSON=async url=>url.includes("t187ap03_L")?
  [{"公司代號":"2330","公司簡稱":"台積電","產業別":"半導體業"},
   {"公司代號":"0050","公司簡稱":"元大台灣50"}]:
  [{SecuritiesCompanyCode:"6488",CompanyAbbreviation:"環球晶","產業別":"半導體業"}];
 assert.deepEqual((await searchOfficialCompanies("台積",{fetchJSON})).map(x=>x.stock),["2330"]);
 assert.deepEqual((await searchOfficialCompanies("648",{fetchJSON})).map(x=>x.stock),["6488"]);
 assert.deepEqual((await searchOfficialCompanies("半導體",{fetchJSON})).map(x=>x.stock),[]);
 assert.deepEqual(await searchOfficialCompanies("",{fetchJSON}),[]);
});
test("same-industry PR requires at least five valid same-date/market peers",()=>{
 const own={stock:"2330",industry:"半導體業",market:"上市",marketDate:"2026-09-24",
  metrics:{per:12,valuationDate:"2026-09-24",eps:3,epsDate:"2026-06-30"}};
 const peers=[8,10,12,14,16].map((per,i)=>({stock:String(2300+i),industry:"半導體業",market:"上市",
  marketDate:"2026-09-24",metrics:{per,valuationDate:"2026-09-24",eps:i,epsDate:"2026-06-30"}}));
 let result=buildPeerComparison(own,peers),item=result.items.find(x=>x.key==="per");
 assert.equal(item.pr,50);assert.equal(item.sample,5);
 result=buildPeerComparison(own,peers.slice(0,4));
 assert.equal(result.items.find(x=>x.key==="per").pr,null);
 result=buildPeerComparison(own,peers.map((p,i)=>i===0?{...p,metrics:{...p.metrics,valuationDate:"2026-09-23"}}:p));
 assert.equal(result.items.find(x=>x.key==="per").pr,null);
 result=buildPeerComparison(own,peers.map(p=>({...p,market:"上櫃"})));
 assert.equal(result.items.find(x=>x.key==="per").pr,null);
 assert.equal(peerPercentile(null,[1,2,3,4,5]),null);
});
test("fundamental summary never invents unavailable margins or compares mismatched periods",()=>{
 const data={financials:[
  {date:"2026-06-30",type:"Revenue",value:100},
  {date:"2026-06-30",type:"GrossProfit",value:38},
  {date:"2026-06-30",type:"OperatingIncome",value:20},
  {date:"2026-06-30",type:"NetIncome",value:12}],
  balance:[{date:"2026-03-31",type:"Equity",value:40},
   {date:"2026-03-31",type:"CurrentAssets",value:30},
   {date:"2026-03-31",type:"CurrentLiabilities",value:10}],
  cashFlows:[{date:"2026-06-30",type:"CashFlowsFromOperatingActivities",value:9}],
  revenues:[{date:"2026-08-01",revenue:120,revenue_year:2026,revenue_month:8},
   {date:"2025-08-01",revenue:100,revenue_year:2025,revenue_month:8}]};
 const r=summarizeFinancialStatements(data);
 assert.equal(r.grossMargin,38);
 assert.equal(r.operatingMargin,20);
 assert.equal(r.netMargin,12);
 assert.equal(r.quarterlyRoe,null);
 assert.equal(r.currentRatio,3);
 assert.equal(r.monthlyRevenueYoY,20);
 assert.equal(summarizeFinancialStatements({}).grossMargin,null);
 assert.equal(hasMarketDB({}),false);
});
