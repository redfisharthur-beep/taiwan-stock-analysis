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
test("registry scan retains ETF as a separate category and can apply an optional price ceiling",async()=>{
 const r=await scanOfficialUniverse({priceCeiling:500,fetchJSON:mock});
 assert.equal(r.marketCount,2);
 assert.equal(r.universeCount,7);
 assert.equal(r.sameDateCount,6);
 assert.equal(r.missingPriceCount,1);
 assert.equal(r.staleMarketCount,0);
 assert.equal(r.pricedCount,6);
 assert.equal(r.tradableCount,4);
 assert.equal(r.excludedOverCeiling,2);
 assert.deepEqual(new Set(r.stocks.map(x=>x.stock)),new Set(["1001","2001","2002","0050"]));
 assert.equal(r.markets.every(x=>x.registryAvailable),true);
 assert.equal(r.stocks.find(x=>x.stock==="0050").kind,"etf");
 assert.equal(r.stocks.find(x=>x.stock==="0050").screen,null);
 assert.equal(r.kindCounts.etf,1);
});
test("value shortlist remains available when no company meets all valuation checks",async()=>{
 const r=await scanOfficialUniverse({priceCeiling:500,fetchJSON:mock});
 const value=rankUniverseCandidates(r.stocks,"value",5);
 assert.equal(value.length,4);
 assert.equal(value[0].stock,"1001");
 assert.equal(value.find(x=>x.stock==="0050").screening.checks.length,0);
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
 assert.equal(r.marketCount,2);
 assert.ok(r.allStocks.some(x=>x.stock==="1001"&&x.market==="上市"&&x.close===100));
 assert.ok(r.allStocks.some(x=>x.stock==="2001"&&x.market==="上櫃"&&x.close===80));
 assert.ok(r.markets.every(x=>x.registryAvailable===false));
});

test("default universe has no price cap and includes listed, OTC and multi-character ETF tickers",async()=>{
 const full=await scanOfficialUniverse({fetchJSON:async url=>{
  if(url.includes("daily_close_quotes"))return [...otc,{Date:date,SecuritiesCompanyCode:"00980T",
   CompanyName:"上櫃債券ETF",Close:"18",TransactionAmount:"30000000",TradingShares:"50000"}];
  return mock(url);
 }});
 assert.ok(full.stocks.some(x=>x.stock==="1003"&&x.close>500));
 assert.ok(full.stocks.some(x=>x.stock==="0050"&&x.kind==="etf"&&x.market==="上市"));
 assert.ok(full.stocks.some(x=>x.stock==="00980T"&&x.kind==="etf"&&x.market==="上櫃"));
 assert.equal(full.excludedOverCeiling,0);
 assert.equal(full.priceCeiling,undefined);
 assert.equal(full.stocks.filter(x=>x.kind==="etf").every(x=>x.screen===null),true);
});

test("OTC quote fallback uses only the alternate official OTC source",async()=>{
 const hits=[];
 const full=await scanOfficialUniverse({fetchJSON:async url=>{
  hits.push(url);
  if(url.includes("tpex_mainboard_daily_close_quotes"))throw Error("upstream 403");
  if(url.includes("tpex_mainboard_quotes"))return otc;
  return mock(url);
 }});
 assert.equal(full.marketCount,2);
 assert.ok(hits.some(x=>x.includes("tpex_mainboard_quotes")));
 assert.ok(full.allStocks.some(x=>x.stock==="2001"&&x.market==="上櫃"&&
  x.url.endsWith("/tpex_mainboard_quotes")));
});
test("a wholly blocked OTC source exposes an honest one-market snapshot instead of zero stocks",async()=>{
 const full=await scanOfficialUniverse({fetchJSON:async url=>{
  if(url.includes("tpex_mainboard_daily_close_quotes")||
     url.includes("tpex_mainboard_quotes")||
     url.includes("mopsfin_t187ap03_O")||
     url.includes("tpex_mainboard_peratio_analysis"))
    throw Error("TPEx upstream 403");
  return mock(url);
 }});
 assert.equal(full.marketCount,1);
 assert.deepEqual(full.markets.map(x=>x.market),["上市"]);
 assert.ok(full.allStocks.some(x=>x.stock==="1001"&&x.market==="上市"));
 assert.equal(full.allStocks.some(x=>x.stock==="2001"),false);
 assert.ok(full.warnings.some(x=>x.includes("TPEx")&&x.includes("403")));
});
