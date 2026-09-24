import test from "node:test";
import assert from "node:assert/strict";
import {mergeVerifiedResearch} from "../src/top-five.js";
test("one shared shortlist has exactly five stock and ETF entries ranked on documented category-specific 100-point displays",()=>{
 const stock=n=>({stock:String(2000+n),kind:"stock",score:70+n,
  coveredPoints:100,scoreModel:"company_40_30_30"});
 const etf=(code,technicalScore)=>({stock:code,kind:"etf",technicalScore,
  technicalCoverage:30,scoreModel:"etf_technical_30"});
 const shortlist=mergeVerifiedResearch({stocks:Array.from({length:5},(_,i)=>stock(i)),
  etfs:[etf("0050",27),etf("00878",25.5)]});
 assert.equal(shortlist.length,5);
 assert.deepEqual(shortlist.map(x=>x.rank),[1,2,3,4,5]);
 assert.equal(shortlist[0].stock,"0050");
 assert.equal(shortlist[0].score,90);
 assert.equal(shortlist[0].scoreModel,"etf_technical_30_normalized");
 assert.ok(shortlist.some(x=>x.kind==="stock"));
 assert.ok(shortlist.every(x=>x.coveredPoints===100));
});
test("incomplete ratings never become homepage candidates and no zero or invented scores are added",()=>{
 const items=mergeVerifiedResearch({stocks:[
  {stock:"2330",kind:"stock",score:null,coveredPoints:85,scoreModel:"company_40_30_30"},
  {stock:"2317",kind:"stock",score:77,coveredPoints:85,scoreModel:"company_40_30_30"}
 ],etfs:[{stock:"0050",kind:"etf",technicalScore:19,technicalCoverage:22,
  scoreModel:"etf_technical_30"}]});
 assert.deepEqual(items,[]);
});
