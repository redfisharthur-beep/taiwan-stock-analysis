import test from "node:test";
import assert from "node:assert/strict";
import {normalize} from "../src/providers.js";
import {scoreStock} from "../src/scoring.js";
const marketDate="2026-09-23";
const base={
 prices:Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,5,26+i)).toISOString().slice(0,10),close:100+i*0.1,volume:1000})),
 revenues:[],financials:[],institutional:[],official:null
};
base.prices.at(-1).date=marketDate;
const extra={
 valuation:[{date:"2026-09-23",per:18,pbr:4.2,dividendYield:2}],
 cashFlows:[{date:"2025-06-30",type:"CashFlowsFromOperatingActivities",value:100},
  {date:"2026-06-30",type:"CashFlowsFromOperatingActivities",value:150}],
 margin:[{date:"2026-09-23",financing:960,previousFinancing:1000,short:6,previousShort:5}]
};
test("PER, cash flow and financing are truly backend-scored when available",()=>{
 const p=scoreStock({...base,...extra});
 const f=p.parts.fundamental.items,c=p.parts.chips.items;
 assert.equal(f.find(x=>x.name==="估值／本益比").score,7);
 assert.equal(f.find(x=>x.name==="營業現金流（初步）").score,10);
 assert.equal(c.find(x=>x.name==="融資餘額變化").score,5);
 assert.equal(p.coveredPoints,45); // 10+10+5 plus 20 technical
 assert.equal(p.parts.news.covered,0);
 assert.equal(p.score,null);
});
test("future, stale, missing and non-positive valuation do not earn coverage",()=>{
 const p=scoreStock({...base,valuation:[{date:"2026-09-25",per:5},{date:"2026-08-01",per:15},{date:marketDate,per:0}],
 cashFlows:[{date:"2025-01-01",type:"CashFlowsFromOperatingActivities",value:100}],
 margin:[{date:"2026-09-30",financing:9,previousFinancing:11,short:0,previousShort:0}]});
 assert.equal(p.coveredPoints,20);
 assert.equal(p.score,null);
});
test("FinMind original field names are mapped to actual comparison fields",()=>{
 const x=normalize([],[],[],[],[{date:marketDate,PER:16.2,PBR:2.5,dividend_yield:1.3}],
  [{date:"2026-06-30",type:"CashFlowsFromOperatingActivities",value:400}],
  [{date:marketDate,MarginPurchaseTodayBalance:5,MarginPurchaseYesterdayBalance:8,ShortSaleTodayBalance:1,ShortSaleYesterdayBalance:2}]);
 assert.equal(x.valuation[0].per,16.2);
 assert.equal(x.cashFlows[0].value,400);
 assert.equal(x.margin[0].financing,5);
});
