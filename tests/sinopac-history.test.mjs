import test from "node:test";
import assert from "node:assert/strict";
import {privateBrokerHistory,reconcileBrokerHistory,compareRawTechnicalIndicators} from "../src/sinopac.js";
import {scoreStock} from "../src/scoring.js";

const env={SJ_GATEWAY_URL:"https://taiwan-stock-analysis-qxy2.onrender.com",SJ_BRIDGE_TOKEN:"C".repeat(40)};
const date="2026-09-23";
const bars=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,4,1+i)).toISOString().slice(0,10),
 open:100,high:105,low:98,close:100+i*.01,minuteBars:260}));
bars.at(-1).date=date;bars.at(-1).close=102;
test("Cloudflare uses authenticated Render history without leaking brokerage quote",async()=>{
 let n=0;
 const data=await privateBrokerHistory("2330",date,env,async(url,init)=>{
  n++;assert.equal(url,"https://taiwan-stock-analysis-qxy2.onrender.com/internal/history/2330?date_to=2026-09-23");
  assert.equal(init.headers["X-Bridge-Token"],env.SJ_BRIDGE_TOKEN);
  return new Response(JSON.stringify({stock:"2330",through:date,
    kind:"unadjusted_completed_intraday_aggregate",bars}),
    {headers:{"Content-Type":"application/json"}});
 });
 assert.equal(n,1);assert.equal(data.status,"ok");
 assert.equal(data.bars.length,90);
 assert.equal(data.bars[0].volume,null);
 assert.equal(reconcileBrokerHistory(data,{date,close:102},[{date,close:102}]).state,"matched");
 assert.equal(reconcileBrokerHistory(data,{date,close:100},[{date,close:102}]).state,"mismatch");
});
test("broker history cannot claim matched if dates or official / FinMind values missing",()=>{
 const b={status:"ok",bars:[{date:"2026-09-22",close:100}]};
 assert.equal(reconcileBrokerHistory(b,{date,close:100},[{date,close:100}]).state,"different_date");
 assert.equal(reconcileBrokerHistory({status:"ok",bars:[{date,close:100}]},{date,close:100},[]).state,"finmind_missing");
});
test("broker technical rescue uses only corroborated full historical prices and refuses fabricated volume",()=>{
 const r=scoreStock({prices:[{date,close:102,volume:12345}],brokerTechnicalPrices:bars.map(x=>({
  date:x.date,open:x.open,high:x.high,low:x.low,close:x.close,volume:null}))});
 assert.equal(r.technicalMode,"broker_raw");
 assert.equal(r.parts.technical.covered,25);
 assert.equal(r.parts.technical.items.find(x=>x.name==="量價").score,null);
 assert.equal(r.parts.news.covered,0);
});
test("invalid broker price or future trading date fails closed",async()=>{
 const bad=await privateBrokerHistory("2330",date,env,async()=>new Response(JSON.stringify({
  stock:"2330",through:date,kind:"unadjusted_completed_intraday_aggregate",
  bars:[{date:"2026-09-24",open:1,high:2,low:1,close:2,minuteBars:270}]}),{
  headers:{"Content-Type":"application/json"}
 }));
 assert.equal(bad.status,"invalid_data");
});

test("independent same-day raw technical indicators cross-check without adding points",()=>{
 const a={date:"2026-09-23",ma20:100,ma60:105,rsi:54,macd:1.2,
  signal:1.0,volatility20:26,maxDrawdown60:11};
 const consistent=compareRawTechnicalIndicators(a,{...a});
 assert.equal(consistent.state,"consistent");assert.equal(consistent.checked,7);
 const different=compareRawTechnicalIndicators(a,{...a,rsi:80});
 assert.equal(different.state,"differences");assert.deepEqual(different.divergentMetrics,["rsi"]);
 assert.equal(compareRawTechnicalIndicators(a,{...a,date:"2026-09-22"}).state,"not_comparable");
});
