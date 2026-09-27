import test from "node:test";
import assert from "node:assert/strict";
import {assessAccountingRisk} from "../src/accounting-risk.js";
import {scoreStock} from "../src/scoring.js";
import {buildAIResearchAssessment} from "../src/ai-assessment.js";

const dates=Array.from({length:90},(_,i)=>new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10));
const prices=dates.map((date,i)=>({date,open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100+i*.1,volume:1000000}));

test("high equity-method profit share receives accounting risk penalty",()=>{
 const financials=[
  {date:"2026-06-30",type:"IncomeAfterTaxes",value:100},
  {date:"2026-06-30",type:"ShareOfProfitOfAssociatesAndJointVenturesAccountedForUsingEquityMethod",value:65}
 ];
 const risk=assessAccountingRisk(financials);
 assert.equal(risk.equityMethod.ratioPct,65);
 assert.ok(risk.equityMethod.penalty>=10);
 assert.ok(risk.penalty>=10);
});

test("volatile OCI adds risk without pretending it is core earnings",()=>{
 const financials=[
  {date:"2025-09-30",type:"IncomeAfterTaxes",value:100},
  {date:"2025-09-30",type:"OtherComprehensiveIncome",value:90},
  {date:"2025-12-31",type:"IncomeAfterTaxes",value:100},
  {date:"2025-12-31",type:"OtherComprehensiveIncome",value:-80},
  {date:"2026-03-31",type:"IncomeAfterTaxes",value:100},
  {date:"2026-03-31",type:"OtherComprehensiveIncome",value:120},
  {date:"2026-06-30",type:"IncomeAfterTaxes",value:100},
  {date:"2026-06-30",type:"OtherComprehensiveIncome",value:-100}
 ];
 const risk=assessAccountingRisk(financials);
 assert.ok(risk.oci.penalty>=6);
 assert.ok(risk.oci.signFlips>=2);
});

test("accounting risk directly reduces composite score",()=>{
 const clean=[
  {date:"2026-06-30",type:"EPS",value:6},
  {date:"2025-06-30",type:"EPS",value:4},
  {date:"2026-06-30",type:"IncomeAfterTaxes",value:100},
  {date:"2026-06-30",type:"ShareOfProfitOfAssociatesAndJointVenturesAccountedForUsingEquityMethod",value:70}
 ];
 const scored=scoreStock({prices,financials:clean});
 assert.ok(scored.accountingRiskPenalty>=10);
 assert.equal(scored.score,Math.max(0,Math.round((scored.observedPoints+scored.newsDelta-scored.accountingRiskPenalty)*100)/100));
});

test("AI assessment surfaces accounting quality risk and gives research stance",()=>{
 const detail={score:{score:72,coveragePercent:80,accountingRisk:{penalty:12,
   equityMethod:{penalty:10},oci:{penalty:2}},parts:{chips:{earned:20}},
   indicators:{close:110,ma20:105,ma60:100,rsi:60,maxDrawdown60:8}},
  financialInsights:{operatingCashFlow:10,monthlyRevenueYoY:5,quarterlyRoe:6},
  valuationLatest:{per:14},verification:{state:"一致"}};
 const result=buildAIResearchAssessment(detail);
 assert.ok(result.strengths.length>=3);
 assert.ok(result.risks.some(x=>x.includes("權益法")));
 assert.ok(["可優先研究","審慎觀察","暫不優先"].includes(result.stance));
});
