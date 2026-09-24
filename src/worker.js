import {finmind,officialQuote,normalize,reconcile} from "./providers.js";
import {scoreStock} from "./scoring.js";
import {readTopFive,saveSnapshot} from "./ranking.js";
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=900","X-Content-Type-Options":"nosniff"}});
const valid=s=>/^\d{4,6}$/.test(s);
async function analyze(stock,env){
 if(!env.FINMIND_TOKEN)return reply({error:"尚未在 Cloudflare 設定 FINMIND_TOKEN Secret。"},503);
 const datasets=[["TaiwanStockPrice",410],["TaiwanStockMonthRevenue",520],["TaiwanStockFinancialStatements",520],["TaiwanStockInstitutionalInvestorsBuySell",35]];
 const data=await Promise.allSettled(datasets.map(([d,n])=>finmind(env,stock,d,n)));
 const warnings=data.flatMap((r,i)=>r.status==="rejected"?[datasets[i][0]+": "+String(r.reason?.message||"取得失敗")]:[]);
 if(data[0].status==="rejected")return reply({error:"無法取得真實歷史股價，已停止評分。",warnings},503);
 const get=i=>data[i].status==="fulfilled"?data[i].value:[];
 const clean=normalize(get(0),get(1),get(2),get(3));
 if(clean.prices.length===0)return reply({error:"查無此股票的可用行情，未產生分數。",warnings},404);
 const officialResult=await officialQuote(stock);
 const official=officialResult.quote;
 const check=reconcile(official,clean.prices);
 const scored=scoreStock({...clean,official});
 // 官方價格不一致時，不允許顯示完整評分；與 FinMind 日期不同僅顯示部分分析。
 if(check.state==="不一致")scored.score=null;
 const latest=clean.prices.at(-1);
 const candles=clean.prices.filter(p=>[p.open,p.high,p.low,p.close].every(x=>Number.isFinite(x)&&x>0)&&p.high>=Math.max(p.open,p.close,p.low)&&p.low<=Math.min(p.open,p.close,p.high)).slice(-120);
 const links={goodinfo:"https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID="+stock,twse:"https://www.twse.com.tw/",tpex:"https://www.tpex.org.tw/",mops:"https://mops.twse.com.tw/"};
 const result={stock,name:official?.name||"",market:official?.market||"尚未辨認",asOf:new Date().toISOString(),finmind:{date:latest.date,close:latest.close},official,verification:check,score:scored,candles,sourceWarnings:[...warnings,...(official?[]:officialResult.errors)],links,goodinfo:{mode:"manual_only",note:"可開啟 Goodinfo 手動輸入相同交易日的收盤價核對；未取得自動擷取授權，不宣稱已自動查證。"}};
 if(env.DB && check.state==="一致" && official?.date===latest.date){
   try{await saveSnapshot(env.DB,result)}catch(e){result.sourceWarnings.push("榜單儲存失敗："+String(e.message||e))}
 }
 return reply(result);
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==="/api/health")return reply({ok:true,finmindConfigured:!!env.FINMIND_TOKEN,rankingDatabaseConfigured:!!env.DB,version:"0.3.0",time:new Date().toISOString()});
 if(url.pathname==="/api/top5"){
   const data=await readTopFive(env.DB);
   return reply(data,200);
 }
 if(url.pathname==="/api/analyze"){
   const stock=(url.searchParams.get("stock")||"").trim();if(!valid(stock))return reply({error:"請輸入 4 至 6 位數的股票代號。"},400);
   const key=new Request(url.origin+"/api/analyze?stock="+stock);
   const cache=caches.default;const hit=await cache.match(key);if(hit)return hit;
   try{const res=await analyze(stock,env);if(res.ok)ctx.waitUntil(cache.put(key,res.clone()));return res}catch(e){return reply({error:"資料來源連線異常；未產生評分。",detail:String(e.message||e)},503)}
 }
 if(url.pathname.startsWith("/api/"))return reply({error:"找不到 API"},404);
 return env.ASSETS.fetch(request);
 },
 async scheduled(event,env,ctx){
   if(!env.DB||!env.FINMIND_TOKEN)return;
   try{
     const items=await env.DB.prepare("SELECT stock FROM stock_snapshots ORDER BY updated_at ASC LIMIT 5").all();
     for(const item of items.results||[]){
       try{await analyze(item.stock,env)}catch(e){console.error("refresh stock failed",item.stock,String(e.message||e))}
     }
   }catch(e){console.error("scheduled refresh unavailable",String(e.message||e))}
 }
};
