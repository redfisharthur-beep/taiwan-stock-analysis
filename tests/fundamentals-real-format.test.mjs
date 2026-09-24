import test from "node:test";
import assert from "node:assert/strict";
import {summarizeFinancialStatements} from "../src/fundamentals.js";

test("FinMind canonical IncomeAfterTaxes supports real net margin and same-quarter ROE",()=>{
 const financials=[
  {date:"2026-03-31",type:"Revenue",value:1200},
  {date:"2026-03-31",type:"IncomeAfterTaxes",value:120},
  {date:"2026-06-30",type:"Revenue",value:1400},
  {date:"2026-06-30",type:"IncomeAfterTaxes",value:140}
 ];
 const balance=[
  {date:"2026-03-31",type:"Equity",value:2000},
  {date:"2026-06-30",type:"Equity",value:2800}
 ];
 const result=summarizeFinancialStatements({financials,balance});
 assert.equal(result.incomeDate,"2026-06-30");
 assert.equal(result.roeDate,"2026-06-30");
 assert.equal(result.netMargin,10);
 assert.equal(result.quarterlyRoe,5);
 assert.equal(result.netIncome,140);
});
test("if newest equity is absent, ROE uses last truly comparable reporting period",()=>{
 const financials=[{date:"2026-03-31",type:"Revenue",value:1000},
  {date:"2026-03-31",type:"IncomeAfterTaxes",value:90},
  {date:"2026-06-30",type:"Revenue",value:1200},
  {date:"2026-06-30",type:"IncomeAfterTaxes",value:120}];
 const balance=[{date:"2026-03-31",type:"Equity",value:1800}];
 const result=summarizeFinancialStatements({financials,balance});
 assert.equal(result.netMargin,10);
 assert.equal(result.roeDate,"2026-03-31");
 assert.equal(result.quarterlyRoe,5);
 assert.notEqual(result.incomeDate,result.roeDate);
});
test("missing matching financial statement lines stay unavailable instead of using EPS as net income",()=>{
 const result=summarizeFinancialStatements({financials:[
  {date:"2026-06-30",type:"Revenue",value:1200},
  {date:"2026-06-30",type:"EPS",value:7.41}
 ],balance:[{date:"2026-06-30",type:"Equity",value:1800}]});
 assert.equal(result.netMargin,null);
 assert.equal(result.quarterlyRoe,null);
 assert.match(result.missingReasons.netMargin,/稅後淨利/);
});
