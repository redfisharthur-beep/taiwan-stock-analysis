import test from "node:test";import assert from "node:assert/strict";
import {scoreStock,indicators,num,WEIGHTS} from "../src/scoring.js";
import {reconcile} from "../src/providers.js";
test("missing data cannot create fabricated full 100-point score",()=>{
 const s=scoreStock({});assert.equal(s.score,null);assert.equal(s.coveredPoints,0);assert.equal(s.parts.news.covered,0);
});
test("raw-price fallback restores technical coverage but never masquerades as adjusted prices",()=>{
 const rows=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,5,26+i)).toISOString().slice(0,10),
  close:100+i*.1,volume:1000}));
 const s=scoreStock({prices:rows});
 assert.equal(s.parts.technical.covered,20);assert.equal(s.coveredPoints,20);
 assert.equal(s.technicalMode,"raw");assert.equal(s.score,null);
 assert.ok(s.parts.technical.items.every(i=>i.source==="FinMind TaiwanStockPrice"));
 assert.ok(s.parts.technical.items.every(i=>i.note.includes("未還原")));
 assert.deepEqual(Object.fromEntries(Object.entries(s.parts).map(([k,v])=>[k,v.max])),WEIGHTS);
});
test("stale adjusted-price feed uses real same-date raw prices, not stale adjusted prices",()=>{
 const rows=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,5,26+i)).toISOString().slice(0,10),
  close:100+i*.1,volume:1000}));
 const s=scoreStock({prices:rows,adjusted:rows.slice(0,-1).map(r=>({...r,close:r.close/2}))});
 assert.equal(s.technicalMode,"raw");assert.equal(s.parts.technical.covered,20);
 assert.equal(s.diagnostics.technical.adjustedDate,rows.at(-2).date);
});
test("insufficient real price history stays missing even if adjusted feed exists",()=>{
 const rows=Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,5,26+i)).toISOString().slice(0,10),
  close:100+i*.1,volume:1000}));
 const s=scoreStock({prices:rows,adjusted:rows.map(r=>({...r,close:r.close/2}))});
 assert.equal(s.technicalMode,"unavailable");assert.equal(s.parts.technical.covered,0);
});
test("adjusted-price indicators include risk metrics but do not change original K-line prices",()=>{
 const rows=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,5,26+i)).toISOString().slice(0,10),
  close:100+i*.1,volume:1000}));
 const s=scoreStock({prices:rows,adjusted:rows.map(r=>({...r,close:r.close/2}))});
 assert.equal(s.parts.technical.covered,20);assert.equal(s.coveredPoints,20);
 assert.ok(s.indicators.volatility20>=0);assert.ok(s.indicators.maxDrawdown60>=0);
 assert.equal(rows.at(-1).close,108.9);
});
test("missing or invalid numeric value is never automatically zero",()=>{
 assert.equal(num(""),null);assert.equal(num("1,234.5"),1234.5);
});
test("official price cross-check remains same-date only",()=>{
 assert.equal(reconcile({date:"2026-09-24",close:100},[{date:"2026-09-23",close:100}]).state,"日期不一致");
 assert.equal(reconcile({date:"2026-09-24",close:100},[{date:"2026-09-24",close:101}]).state,"不一致");
});

test("five-day institutional flow uses real prior reported sessions when current close arrives first",()=>{
 const trading=["2026-09-16","2026-09-17","2026-09-18","2026-09-21","2026-09-22","2026-09-23"];
 const prices=trading.map(date=>({date,close:100,volume:1000}));
 const institutional=trading.slice(0,-1).map(date=>({date,name:"Foreign_Investor",buy:600,sell:500}));
 const scored=scoreStock({prices,institutional});
 const item=scored.parts.chips.items.find(x=>x.name==="法人近五日淨買賣／成交量");
 assert.equal(item.score,10);
 assert.equal(item.date,"2026-09-22");
 assert.equal(item.value.netShares,500);
 assert.equal(item.value.delayedSessions,1);
 const missing=scoreStock({prices,institutional:institutional.filter(x=>x.date!=="2026-09-18")});
 assert.equal(missing.parts.chips.items.find(x=>x.name==="法人近五日淨買賣／成交量").score,null);
});
test("financial quality is scored from real same-period operating cash/pretax and dated debt",()=>{
 const prices=[{date:"2026-09-24",close:100,volume:1000}];
 const cashFlows=[{date:"2026-06-30",type:"CashFlowsFromOperatingActivities",value:150},
  {date:"2026-06-30",type:"NetIncomeBeforeTax",value:100}];
 const balance=[{date:"2026-06-30",type:"TotalLiabilities",value:400},
  {date:"2026-06-30",type:"TotalAssets",value:1000}];
 const quality=scoreStock({prices,cashFlows,balance}).parts.fundamental.items.find(x=>x.name==="獲利品質與負債");
 assert.equal(quality.score,9);
 assert.equal(quality.value.debtRatioPct,40);
 assert.equal(quality.value.cashConversion,1.5);
 const missingPretax=scoreStock({prices,cashFlows:cashFlows.slice(0,1),balance}).parts.fundamental.items.find(x=>x.name==="獲利品質與負債");
 assert.equal(missingPretax.score,null);
 assert.equal(missingPretax.value.debtRatioPct,40);
});
