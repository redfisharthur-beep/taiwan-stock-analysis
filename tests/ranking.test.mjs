import test from "node:test";
import assert from "node:assert/strict";
import {coverageSignature,selectDailyLeaders} from "../src/ranking.js";
const mk=(stock,points=42,covered=60,date="2026-09-24")=>({
 stock,name:"測試公司",market:"上市",finmind:{date,close:100},official:{date},
 verification:{state:"一致"},sourceWarnings:[],
 score:{score:null,complete:false,observedPoints:points,coveredPoints:covered,
 parts:Object.fromEntries(["fundamental","news","chips","technical"].map(k=>[k,{max:20,earned:1,covered:1,items:[{name:"共同測試項",score:1,max:2,note:"已核對",source:"測試",date}]}]))}});
test("missing validated data yields no fabricated top five",()=>{assert.equal(selectDailyLeaders([],{marketDate:"2026-09-24"}).stocks.length,0)});
test("sample scores never become a fake 100 point full-market rank",()=>{const r=selectDailyLeaders(Array.from({length:7},(_,i)=>mk(String(2000+i))),{marketDate:"2026-09-24"});assert.equal(r.stocks.length,5);assert.equal(r.published,false);assert.equal(r.scope,"verified_sample");assert.equal(r.stocks[0].score,null);});
test("reject mismatched market dates and unverified official prices",()=>{const a=mk("2330"),b=mk("2317");b.official.date="2026-09-23";assert.equal(selectDailyLeaders([a,b],{marketDate:"2026-09-24"}).verifiedComparableCount,1)});
test("sort only inside consistent coverage signature",()=>{const a=mk("2330",41),b=mk("2317",45);b.score.parts.news.items[0].score=null;assert.notEqual(coverageSignature(a.score),coverageSignature(b.score));assert.equal(selectDailyLeaders([a,b],{marketDate:"2026-09-24"}).verifiedComparableCount,1)});
test("never publish full-market unless all expected securities were scanned",()=>{const s=mk("2330");s.score.complete=true;s.score.score=95;assert.equal(selectDailyLeaders([s],{marketDate:"2026-09-24",universeSize:100,universeProcessed:1}).published,false)});
