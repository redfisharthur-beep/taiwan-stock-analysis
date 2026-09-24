import test from "node:test";
import assert from "node:assert/strict";
import {getMarketPage,getMarketSummary,claimNextCompany} from "../src/market-db.js";

function mockDB(records){
 const queries=[];
 return {
  queries,
  prepare(sql){
   const statement={sql,args:[],bind(...args){this.args=args;return this;},
    async first(){
     queries.push({sql:this.sql,args:this.args});
     if(sql.includes("COUNT(*) AS n"))return {n:records.length};
     if(sql.includes("COUNT(*) AS total"))return {total:records.length,eligible:records.length,
      noQuote:0,etf:1,attempted:2,failed:0};
     if(sql.includes("COUNT(p.stock) AS profiles"))return {profiles:2,finance:1,
      technical:2,chips:1,fullCoverage:1,lastResearch:"2026-09-24T11:00:00Z"};
     if(sql.includes("SELECT value,updated_at FROM sync_state"))return {value:JSON.stringify({
      date:"2026-09-24",count:records.length,markets:[]}),updated_at:"2026-09-24T11:00:00Z"};
     if(sql.includes("UPDATE companies SET last_attempt"))return {stock:"2330"};
     return null;
    },
    async all(){queries.push({sql:this.sql,args:this.args});return {results:records}}};
   return statement;
  }
 };
}
test("all-market pages distinguish complete, partial and ETF without fabricating scores",async()=>{
 const records=[
  {stock:"2330",name:"台積電",market:"上市",industry:"半導體",close:100,quoteDate:"2026-09-24",
   analyzedAt:"2026-09-24T11:00:00Z",researchDate:"2026-09-24",
   scoreJSON:JSON.stringify({scoreModelVersion:"chips_flow20_margin10_v1",coveragePercent:100,score:78,parts:{}}),
   metricsJSON:JSON.stringify({verified:true})},
  {stock:"6488",name:"環球晶",market:"上櫃",industry:"半導體",close:40,quoteDate:"2026-09-24",
   analyzedAt:"2026-09-24T11:00:00Z",researchDate:"2026-09-24",
   scoreJSON:JSON.stringify({coveragePercent:70,score:null}),metricsJSON:JSON.stringify({verified:true})},
  {stock:"0050",name:"ETF",market:"上市",industry:"ETF",close:60,quoteDate:"2026-09-24",
   analyzedAt:"2026-09-24T11:00:00Z",researchDate:"2026-09-24",
   scoreJSON:JSON.stringify({parts:{technical:{covered:30}}}),metricsJSON:JSON.stringify({verified:true})}
 ];
 const db=mockDB(records),page=await getMarketPage(db,{market:"all",page:1,pageSize:30});
 assert.equal(page.total,3);assert.equal(page.pages,1);
 assert.equal(page.rows[0].score,78);assert.equal(page.rows[0].status,"complete");
 assert.equal(page.rows[1].score,null);assert.equal(page.rows[1].coverage,70);
 assert.equal(page.rows[1].status,"partial");
 assert.equal(page.rows[2].score,null);assert.equal(page.rows[2].coverage,null);
 assert.equal(page.rows[2].technicalCoverage,30);
 const sql=db.queries.find(q=>q.sql.includes("LEFT JOIN market_profiles"));
 assert.match(sql.sql,/LIMIT \? OFFSET \?/);
 assert.deepEqual(sql.args.slice(-2),[30,0]);
});
test("keyword search is parameterized and server-side filters by market",async()=>{
 const db=mockDB([]);
 await getMarketPage(db,{market:"上櫃",query:"%_2330",page:2,pageSize:50});
 const qs=db.queries.filter(x=>x.sql.includes("COUNT(*) AS n")||
   x.sql.includes("LEFT JOIN market_profiles"));
 assert.equal(qs.length,2);
 assert.match(qs[0].sql,/c.market=\?/);
 assert.match(qs[0].sql,/ESCAPE/);
 assert.equal(qs[0].args[0],"上櫃");
 assert.equal(qs[0].args[1],"%\\%\\_2330%");
 assert.deepEqual(qs[1].args.slice(-2),[50,50]);
});
test("market summary separates number of companies, archived analyses and full coverage",async()=>{
 const data=await getMarketSummary(mockDB([1,2,3]));
 assert.equal(data.total,3);assert.equal(data.profiles,2);
 assert.equal(data.unprocessed,1);assert.equal(data.fullCoverage,1);
 assert.equal(data.complete,false);
});
test("scheduled queue prioritizes never-tried stocks and cools down failures",async()=>{
 const db=mockDB([]),company=await claimNextCompany(db);
 assert.equal(company.stock,"2330");
 const statement=db.queries.find(x=>x.sql.includes("UPDATE companies SET last_attempt"));
 assert.match(statement.sql,/last_attempt IS NULL THEN 0/);
 assert.match(statement.sql,/last_scan_at=\(SELECT MAX\(last_scan_at\)/);
 assert.equal(statement.args.length,3);
});
