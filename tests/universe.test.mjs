import test from "node:test";
import assert from "node:assert/strict";
import {scanOfficialUniverse,rankUniverseCandidates} from "../src/providers.js";

const date="1150924";
const listed=[
 {Date:date,Code:"1001",Name:"甲",ClosingPrice:"100",TradeValue:"20000000",TradeVolume:"50000"},
 {Date:date,Code:"1002",Name:"乙",ClosingPrice:"500",TradeValue:"15000000",TradeVolume:"50000"},
 {Date:date,Code:"1003",Name:"丙",ClosingPrice:"501",TradeValue:"18000000",TradeVolume:"50000"},
 {Date:date,Code:"0050",Name:"ETF",ClosingPrice:"60",TradeValue:"99000000",TradeVolume:"90000"}
];
const otc=[
 {Date:date,SecuritiesCompanyCode:"2001",CompanyName:"丁",Close:"80",TransactionAmount:"6000000",TradingShares:"50000"},
 {Date:date,SecuritiesCompanyCode:"2002",CompanyName:"戊",Close:"30",TransactionAmount:"1500000",TradingShares:"50000"}
];
const mock=async url=>{
 if(url.includes("STOCK_DAY_ALL"))return listed;
 if(url.includes("daily_close_quotes"))return otc;
 if(url.includes("BWIBBU_ALL"))return [{Date:date,Code:"1001",PEratio:"12",PBratio:"1.3",DividendYield:"4"}];
 if(url.includes("peratio_analysis"))return [{Date:date,SecuritiesCompanyCode:"2001",PriceEarningRatio:"40",
  PriceBookRatio:"4",YieldRatio:"1"}];
 if(url.includes("t187ap03_L"))return ["1001","1002","1003","1004"].map(code=>({"公司代號":code,"公司簡稱":"上市"+code}));
 if(url.includes("t187ap03_O"))return ["2001","2002"].map(code=>({SecuritiesCompanyCode:code,CompanyAbbreviation:"上櫃"+code}));
 throw Error("unexpected "+url);
};
test("registry scan includes halted company, excludes ETFs and all prices at or above 500",async()=>{
 const r=await scanOfficialUniverse({priceCeiling:500,fetchJSON:mock});
 assert.equal(r.marketCount,2);
 assert.equal(r.universeCount,6);
 assert.equal(r.sameDateCount,5);
 assert.equal(r.missingPriceCount,1);
 assert.equal(r.staleMarketCount,0);
 assert.equal(r.pricedCount,5);
 assert.equal(r.tradableCount,3);
 assert.equal(r.excludedOverCeiling,2);
 assert.deepEqual(new Set(r.stocks.map(x=>x.stock)),new Set(["1001","2001","2002"]));
 assert.equal(r.markets.every(x=>x.registryAvailable),true);
});
test("value shortlist remains available when no company meets all valuation checks",async()=>{
 const r=await scanOfficialUniverse({priceCeiling:500,fetchJSON:mock});
 const value=rankUniverseCandidates(r.stocks,"value",5);
 assert.equal(value.length,3);
 assert.equal(value[0].stock,"1001");
 assert.equal(value[0].screening.passedAll,true);
 assert.equal(value.filter(x=>x.screening.passedAll).length,1);
 assert.equal(value.find(x=>x.stock==="2002").screening.known,0);
 assert.equal(value.find(x=>x.stock==="2002").screening.passedAll,false);
});
test("missing company registry must be announced and cannot claim full-market coverage",async()=>{
 const r=await scanOfficialUniverse({fetchJSON:async url=>{
  if(url.includes("t187ap03_"))throw Error("registry down");
  return mock(url);
 }});
 assert.equal(r.markets.every(x=>!x.registryAvailable),true);
 assert.equal(r.warnings.some(x=>x.includes("公司名冊暫不可用")),true);
});
