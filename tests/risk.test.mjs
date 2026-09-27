import test from "node:test";
import assert from "node:assert/strict";
import {assessCandidateRisk,assessIndustryOutlook,calculateValueScore,isCyclicalIndustry} from "../src/risk.js";

const dates=Array.from({length:90},(_,i)=>new Date(Date.UTC(2026,5,30+i)).toISOString().slice(0,10));
const steadyPrices=dates.map((date,i)=>({date,close:100+i*.05,volume:1000000}));

test("cyclical industry with peak EPS is flagged",()=>{
 const financials=[
  {date:"2024-06-30",type:"EPS",value:2},
  {date:"2025-06-30",type:"EPS",value:2.2},
  {date:"2026-06-30",type:"EPS",value:5}
 ];
 const risk=assessCandidateRisk({industry:"航運業",prices:steadyPrices,financials,
  screening:{per:8,pbr:2}});
 assert.equal(isCyclicalIndustry("航運業"),true);
 assert.ok(risk.cyclical.score>=60);
});

test("short-term surge and volume spike triggers abnormal-trading gate",()=>{
 const surge=[100,125,130,135,140,145];
 const prices=dates.map((date,i)=>({date,
  close:i<dates.length-6?100:surge[i-(dates.length-6)],
  volume:i<dates.length-5?1000000:5000000}));
 const risk=assessCandidateRisk({industry:"電子零組件業",prices,financials:[],institutional:[]});
 assert.ok(risk.abnormalTrading.score>=60);
 assert.equal(risk.excluded,true);
});

test("falling EPS, institutional selling and broken MA60 raise value-trap risk",()=>{
 const prices=dates.map((date,i)=>({date,close:130-i*.5,volume:1000000}));
 const financials=[
  {date:"2025-06-30",type:"EPS",value:4},
  {date:"2026-06-30",type:"EPS",value:2}
 ];
 const institutional=dates.slice(-5).flatMap(date=>[
  {date,name:"Foreign",buy:10000,sell:70000}
 ]);
 const risk=assessCandidateRisk({industry:"電子零組件業",prices,financials,institutional});
 assert.ok(risk.valueTrap.score>=60);
 assert.equal(risk.excluded,true);
});

test("risk deductions reduce final value score",()=>{
 const lowRisk={cyclical:{score:0},abnormalTrading:{score:0},valueTrap:{score:0}};
 const highRisk={cyclical:{score:60},abnormalTrading:{score:60},valueTrap:{score:60}};
 const a=calculateValueScore({compositeScore:70,relativePoints:8,qualityPoints:10,risk:lowRisk});
 const b=calculateValueScore({compositeScore:70,relativePoints:8,qualityPoints:10,risk:highRisk});
 assert.ok(a>b);
});

test("structurally weak industries are excluded from recommendations but not globally deleted",()=>{
 const cement=assessIndustryOutlook("水泥工業");
 assert.equal(cement.excluded,true);
 assert.equal(cement.level,"排除");
 const steel=assessIndustryOutlook("鋼鐵工業");
 assert.equal(steel.excluded,false);
 assert.equal(steel.level,"逆風");
 const semi=assessIndustryOutlook("半導體業");
 assert.equal(semi.excluded,false);
 assert.equal(semi.level,"成長");
});
