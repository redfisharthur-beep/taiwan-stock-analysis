import test from "node:test";
import assert from "node:assert/strict";
import {getVerifiedTopFive} from "../src/market-db.js";
import {summarizeFinancialStatements} from "../src/fundamentals.js";
import {normalize} from "../src/providers.js";

const sections={
 fundamental:{max:40,covered:40,earned:32,items:[
  {name:"EPS 與去年同季",value:{eps:2,yoyPct:8}},
  {name:"營業現金流（初步）",value:100},
  {name:"獲利品質與負債",value:{debtRatioPct:35}}
 ]},
 technical:{max:30,covered:30,earned:21},
 chips:{max:30,covered:30,earned:22}
};
const row=(stock,score,industry="一般")=>({
 stock,name:stock,market:"上市",industry,close:100,quote_date:"2026-09-24",
 per:12,pbr:1.4,dividend_yield:3,
 score_json:JSON.stringify(score),metrics_json:JSON.stringify({verified:true})
});
const scored=(n)=>({score:n,baseScore:n,coveragePercent:100,parts:sections,newsDelta:0});
test("homepage ranks only full-score verified stocks, never an incomplete prescreen",async()=>{
 const selected=[row("1002",88),row("1003",76),row("1001",90),row("1004",72),row("1005",70)]
  .map((r,i)=>({...r,score_json:JSON.stringify(scored([88,76,90,72,70][i]))}));
 const fund=row("0050",{parts:{technical:{max:30,covered:30,earned:25}}},"ETF");
 const queries=[];
 const db={prepare(sql){queries.push(sql);return {async all(){
  return {results:sql.includes("c.industry='ETF'")?[fund]:selected};
 }}}};
 const found=await getVerifiedTopFive(db);
 assert.deepEqual(found.stocks.map(x=>x.stock),["1001","1002","1003","1004","1005"]);
 assert.equal(found.stocks.every(x=>x.coveredPoints===100&&Number.isFinite(x.score)),true);
 assert.equal(found.stocks[0].financials.eps,2);
 assert.equal(found.stocks[0].financials.operatingCashFlow,100);
 assert.equal(found.etfs.length,1);
 assert.equal(found.etfs[0].technicalScore,25);
 assert.equal(found.etfs[0].score,undefined);
 assert.equal(queries.length,2);
 for(const sql of queries){
  assert.match(sql,/LIMIT 5/);
  assert.match(sql,/p.market_date=c.quote_date/);
  assert.match(sql,/verified/);
 }
 assert.match(queries[0],/coveragePercent/);
 assert.match(queries[0],/fundamental.covered/);
 assert.match(queries[0],/chips.covered/);
 assert.match(queries[1],/technical.covered/);
});
test("financial summary selects the latest comparable statement period and exact matching equity",()=>{
 const result=summarizeFinancialStatements({
  financials:[
   {date:"2026-09-30",type:"EPS",value:2},
   {date:"2026-06-30",type:"Revenue",value:1000},
   {date:"2026-06-30",type:"ProfitLoss",value:100}
  ],
  balance:[
   {date:"2026-06-30",type:"EquityAttributableToOwnersOfParent",value:500},
   {date:"2026-09-30",type:"Assets",value:2000}
  ]
 });
 assert.equal(result.netMargin,10);
 assert.equal(result.quarterlyRoe,20);
 assert.equal(result.incomeDate,"2026-06-30");
 assert.equal(result.missingReasons.netMargin,null);
 assert.equal(result.missingReasons.quarterlyRoe,null);
 const missing=summarizeFinancialStatements({financials:[
  {date:"2026-06-30",type:"Revenue",value:1000}
 ]});
 assert.equal(missing.netMargin,null);
 assert.equal(missing.quarterlyRoe,null);
 assert.match(missing.missingReasons.netMargin,/不足/);
});
test("financing data can be assessed without short-selling fields",()=>{
 const result=normalize([],[],[],[],[],[],[
  {date:"2026-09-24",MarginPurchaseTodayBalance:"1020",MarginPurchaseYesterdayBalance:"1000"}
 ]);
 assert.equal(result.margin.length,1);
 assert.equal(result.margin[0].financing,1020);
 assert.equal(result.margin[0].short,null);
});
