import test from "node:test";
import assert from "node:assert/strict";
import {sinopacReady,validateOwner,privateBrokerSnapshot} from "../src/sinopac.js";

const env={SJ_GATEWAY_URL:"https://arthur-sinopac.onrender.com",
 SJ_BRIDGE_TOKEN:"B".repeat(40),SJ_OWNER_TEST_TOKEN:"O".repeat(40)};

test("empty config fails closed",()=>{
 assert.equal(sinopacReady({}),false);
});
test("owner token only works for correct Authorization header",async()=>{
 assert.equal(await validateOwner(new Request("https://example.com",{headers:{Authorization:"Bearer "+"O".repeat(40)}}),env),true);
 assert.equal(await validateOwner(new Request("https://example.com",{headers:{Authorization:"Bearer "+"X".repeat(40)}}),env),false);
 assert.equal(await validateOwner(new Request("https://example.com"),env),false);
});
test("Shioaji quote returned only from fixed trusted gateway and fully validated",async()=>{
 let called=0;
 const r=await privateBrokerSnapshot("2330",env,async(url,options)=>{
  called++;assert.equal(url,"https://arthur-sinopac.onrender.com/internal/quote/2330");
  assert.equal(options.headers["X-Bridge-Token"],env.SJ_BRIDGE_TOKEN);
  return new Response(JSON.stringify({stock:"2330",exchange:"TSE",price:101.5,
   observedAt:"2026-09-24T13:31:00+08:00",kind:"snapshot_not_official_close",
   account_id:"NEVER_EXPOSE"}),{headers:{"Content-Type":"application/json"}});
 });
 assert.equal(called,1);assert.equal(r.status,"ok");assert.equal(r.price,101.5);
 assert.equal(JSON.stringify(r).includes("NEVER_EXPOSE"),false);
});
test("host SSRF attempts or malformed symbols never trigger fetch",async()=>{
 let called=false;const mock=async()=>{called=true;throw Error("should never fetch")};
 for(const url of ["http://arthur.onrender.com","https://onrender.com.evil.test",
  "https://user@arthur.onrender.com","https://arthur.onrender.com/other"]){
  assert.equal((await privateBrokerSnapshot("2330",{...env,SJ_GATEWAY_URL:url},mock)).status,"bad_config");
 }
 assert.equal((await privateBrokerSnapshot("2330&x=1",env,mock)).status,"invalid_code");
 assert.equal(called,false);
});
test("bad market timestamp or price are rejected",async()=>{
 const fetcher=async()=>new Response(JSON.stringify({stock:"2330",exchange:"TSE",price:0,
 observedAt:"2026-09-24T13:31:00+08:00",kind:"snapshot_not_official_close"}),
 {headers:{"Content-Type":"application/json"}});
 assert.equal((await privateBrokerSnapshot("2330",env,fetcher)).status,"invalid_data");
});
