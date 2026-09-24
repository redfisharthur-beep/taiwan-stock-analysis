import test from "node:test";
import assert from "node:assert/strict";
import {discoverNews} from "../src/news.js";
test("news discovery is evidence metadata only, not a verified event score",async()=>{
 const payload={articles:[{title:"台積電取得重大訂單觀察與供應鏈回應",
  url:"https://www.cna.com.tw/news/finance/20260924001.aspx",domain:"cna.com.tw",seendate:"20260924080000"}]};
 const mock=async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify(payload)).buffer});
 const r=await discoverNews("台積電","2026-09-24",mock);
 assert.equal(r.status,"discovered");
 assert.equal(r.articles[0].verification,"headline_metadata_only");
});
