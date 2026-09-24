import test from "node:test";
import assert from "node:assert/strict";
import {normalize} from "../src/providers.js";
import {scoreStock} from "../src/scoring.js";
const marketDate="2026-09-23";
const prices=Array.from({length:90},(_,i)=>({
 date:new Date(Date.UTC(2026,5,26+i)).toISOString().slice(0,10),close:100+i*.1,volume:2000
}));
const fin=Array.from({length:90},(_,i)=>({date:prices[i].date,per:i===89?18:25,pbr:1.4}));
const extra={
 adjusted:prices.map(p=>({...p,close:p.close/2})),
 valuation:fin,
 revenues:[{date:"2025-09-01",revenue:100,revenue_year:2025,revenue_month:9},
 {date:"2026-09-01",revenue:200,revenue_year:2026,revenue_month:9}],
 financials:[{date:"2025-06-30",type:"EPS",value:2},{date:"2026-06-30",type:"EPS",value:3}],
 cashFlows:[{date:"2025-06-30",type:"CashFlowsFromOperatingActivities",value:100},
 {date:"2026-06-30",type:"CashFlowsFromOperatingActivities",value:150},
 {date:"2026-06-30",type:"NetIncomeBeforeTax",value:100}],
 balance:[{date:"2026-06-30",type:"Assets",value:1000},
 {date:"2026-06-30",type:"Liabilities",value:400}],
 margin:[{date:marketDate,financing:960,previousFinancing:1000,short:6,previousShort:5}],
 institutional:prices.slice(-5).map(p=>({date:p.date,name:"Foreign_Investor",buy:300,sell:200}))
};
test("all new financial metrics use actual dates and valid cash/debt and historical PER",()=>{
 const s=scoreStock({prices,...extra});const f=s.parts.fundamental.items,chips=s.parts.chips.items;
 assert.equal(f.find(x=>x.name==="估值／本益比").score,8);
 assert.equal(f.find(x=>x.name==="營業現金流（初步）").score,8);
 assert.equal(f.find(x=>x.name==="獲利品質與負債").score,7.2);
 assert.equal(f.find(x=>x.name==="EPS 與去年同季").score,8);
 assert.equal(chips.find(x=>x.name==="法人近五日淨買賣／成交量").value.ratioPct,5);
 assert.equal(chips.find(x=>x.name==="法人近五日淨買賣／成交量").score,20);
 assert.equal(s.parts.technical.covered,30);assert.equal(s.coveredPoints,100);
 assert.ok(Number.isFinite(s.score));assert.equal(s.parts.news.covered,0);
});
test("raw technical indicators stay source-labeled when adjusted series is missing; balance and PER remain missing",()=>{
 const s=scoreStock({prices,valuation:[{date:marketDate,per:18}],cashFlows:extra.cashFlows,
  margin:[{date:"2026-09-30",financing:1,previousFinancing:2,short:0,previousShort:0}]});
 assert.equal(s.parts.technical.covered,30);
 assert.equal(s.technicalMode,"raw");
 assert.equal(s.parts.fundamental.items.find(x=>x.name==="估值／本益比").score,null);
 assert.equal(s.parts.fundamental.items.find(x=>x.name==="獲利品質與負債").score,null);
 assert.equal(s.parts.chips.items.find(x=>x.name==="法人近五日淨買賣／成交量").score,null);
 assert.equal(s.score,null);
});
test("current positive EPS and cash flow alone are not a substitute for leverage quality",()=>{
 const s=scoreStock({prices,financials:extra.financials,cashFlows:extra.cashFlows});
 assert.equal(s.parts.fundamental.items.find(x=>x.name==="獲利品質與負債").score,null);
});
test("normalize maps raw price, adjusted price and authentic balance-sheet fields separately",()=>{
 const p=normalize([{date:marketDate,close:100,open:98,max:101,min:97,Trading_Volume:1000}],
 [],[],[],[{date:marketDate,PER:16.2,PBR:2.5,dividend_yield:1.3}],
 [{date:"2026-06-30",type:"CashFlowsFromOperatingActivities",value:400}],
 [{date:marketDate,MarginPurchaseTodayBalance:5,MarginPurchaseYesterdayBalance:8,
 ShortSaleTodayBalance:1,ShortSaleYesterdayBalance:2}],
 [{date:marketDate,close:90,Trading_Volume:1000}],
 [{date:"2026-06-30",type:"Assets",value:200}]);
 assert.equal(p.prices[0].close,100);assert.equal(p.adjusted[0].close,90);
 assert.equal(p.balance[0].value,200);assert.equal(p.margin[0].financing,5);
 assert.equal(p.valuation[0].per,16.2);
});
