import test from "node:test";
import assert from "node:assert/strict";
import {scoreStock,WEIGHTS} from "../src/scoring.js";
function completeInputs(){
 const prices=Array.from({length:90},(_,i)=>({
  date:new Date(Date.UTC(2026,5,27+i)).toISOString().slice(0,10),
  open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100+i*.1,volume:1000
 }));
 return {
  prices,adjusted:prices.map(x=>({...x})),
  revenues:[{date:"2025-09-01",revenue:100,revenue_year:2025,revenue_month:9},
   {date:"2026-09-01",revenue:150,revenue_year:2026,revenue_month:9}],
  financials:[{date:"2025-06-30",type:"EPS",value:2},
   {date:"2026-06-30",type:"EPS",value:3}],
  cashFlows:[{date:"2025-06-30",type:"CashFlowsFromOperatingActivities",value:120},
   {date:"2026-06-30",type:"CashFlowsFromOperatingActivities",value:160},
   {date:"2026-06-30",type:"NetIncomeBeforeTax",value:100}],
  balance:[{date:"2026-06-30",type:"Assets",value:1000},
   {date:"2026-06-30",type:"Liabilities",value:350}],
  institutional:prices.slice(-5).map(x=>({date:x.date,name:"Foreign_Investor",buy:550,sell:500})),
  valuation:prices.map(x=>({date:x.date,per:14,pbr:1.2,dividendYield:4})),
  margin:[{date:"2026-09-24",financing:980,previousFinancing:1000,short:0,previousShort:0}],
  holding:{date:"2026-09-18",share:60,source:"TDCC",trend:{
   risingWeeks:2,fallingWeeks:0,changeTwoWeeks:1.5,weeklyChanges:[.7,.8]}}
 };
}
test("100% data coverage requires all three core groups with real observations",()=>{
 const full=scoreStock(completeInputs());
 assert.deepEqual(WEIGHTS,{fundamental:40,news:0,chips:30,technical:30});
 assert.deepEqual(["fundamental","technical","chips"].map(k=>full.parts[k].covered),[40,30,30]);
 assert.equal(full.coveredPoints,100);
 assert.equal(full.complete,true);
 assert.equal(full.score,full.baseScore);
 assert.ok(full.score!==null);
 const missing=completeInputs();missing.balance=[];
 const incomplete=scoreStock(missing);
 assert.equal(incomplete.coveredPoints,92);
 assert.equal(incomplete.complete,false);
 assert.equal(incomplete.score,null);
});
test("positive verified news adds points, negative deducts, and no event is exactly neutral",()=>{
 const full=completeInputs(),base=scoreStock(full);
 const event=kind=>({kind,verification:"independent_corrob",
  date:"2026-09-24",title:"已核實重大事件",source:"MOPS"});
 const plus=scoreStock({...full,newsResearch:{events:[event("order_won")]}});
 const minus=scoreStock({...full,newsResearch:{events:[event("order_cancelled")]}});
 const unknown=scoreStock({...full,newsResearch:{events:[
  {...event("order_won"),verification:"unverified"}]}});
 assert.equal(plus.coveredPoints,100);
 assert.equal(minus.coveredPoints,100);
 assert.equal(plus.newsDelta,5);
 assert.equal(minus.newsDelta,-5);
 assert.equal(unknown.newsDelta,0);
 assert.equal(plus.parts.news.items[0].score,5);
 assert.equal(minus.parts.news.items[0].score,-5);
 assert.equal(plus.score,Math.min(100,base.baseScore+5));
 assert.equal(minus.score,Math.max(0,base.baseScore-5));
 assert.equal(unknown.score,base.score);
 const missing=completeInputs();missing.cashFlows=[];
 assert.equal(scoreStock({...missing,newsResearch:{events:[event("order_won")]}}).score,null);
});
