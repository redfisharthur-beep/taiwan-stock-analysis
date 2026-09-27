import test from "node:test";
import assert from "node:assert/strict";
import {buildOfficialIndustryComparison,buildPeerComparison} from "../src/industry.js";

test("official industry comparison returns the exact peer values used by PR",()=>{
 const allStocks=Array.from({length:6},(_,i)=>({
  stock:String(1001+i),name:"同業"+(i+1),market:"上市",industry:"測試業",source:"TWSE",
  screen:{date:"2026-09-26",per:10+i,pbr:1+i*.1,dividendYield:3+i*.2}
 }));
 const result=buildOfficialIndustryComparison("1001",{allStocks});
 const pe=result.items.find(x=>x.key==="per");
 assert.equal(pe.sample,6);
 assert.equal(pe.peers.length,6);
 assert.deepEqual(pe.peers.map(x=>x.value),[10,11,12,13,14,15]);
 assert.equal(pe.peers.find(x=>x.stock==="1001").isCurrent,true);
 assert.ok(pe.peers.every(x=>Number.isFinite(x.pr)));
});

test("stored peer comparison includes drilldown rows for comparable same-period peers",()=>{
 const own={stock:"2330",name:"甲",industry:"半導體",market:"上市",marketDate:"2026-09-26",
  metrics:{per:14,valuationDate:"2026-09-26"}};
 const peers=Array.from({length:5},(_,i)=>({
  stock:String(2300+i),name:"同業"+i,industry:"半導體",market:"上市",marketDate:"2026-09-26",
  metrics:{per:12+i,valuationDate:"2026-09-26"}
 }));
 const result=buildPeerComparison(own,peers);
 const pe=result.items.find(x=>x.key==="per");
 assert.equal(pe.sample,5);
 assert.equal(pe.peers.length,5);
 assert.deepEqual(pe.peers.map(x=>x.value),[12,13,14,15,16]);
});
