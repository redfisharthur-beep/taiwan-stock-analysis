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
