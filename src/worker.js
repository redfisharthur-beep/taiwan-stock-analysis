import {finmind,officialQuote,officialCandidates,normalize,reconcile} from "./providers.js";
import {scoreStock} from "./scoring.js";
import {selectDailyLeaders} from "./ranking.js";
import {getHoldingRows,concentration} from "./holding.js";
import {loadOfficialDisclosures,researchNews} from "./news.js";
import {valueWatchlist} from "./value.js";
import {sinopacReady,privateBrokerHistory,reconcileBrokerHistory} from "./sinopac.js";
const reply=(body,status=200,ttl=900)=>new Response(JSON.stringify(body),{status,headers:{
 "Content-Type":"application/json; charset=utf-8",
 "Cache-Control":status===200?"public, max-age=0, s-maxage="+ttl:"no-store",
 "X-Content-Type-Options":"nosniff"}});
const valid=s=>String(s||"").length>=4&&String(s||"").length<=6&&
 [...String(s)].every(ch=>ch>="0"&&ch<="9");
async function analyze(stock,env,override=null,shared=null){
 if(!env.FINMIND_TOKEN)return reply({error:"尚未在 Cloudflare 設定 FINMIND_TOKEN Secret。"},503);
 const datasets=[["TaiwanStockPrice",410],["TaiwanStockMonthRevenue",520],
  ["TaiwanStockFinancialStatements",520],["TaiwanStockInstitutionalInvestorsBuySell",35],
  ["TaiwanStockPER",410],["TaiwanStockCashFlowsStatement",600],["TaiwanStockMarginPurchaseShortSale",30],
  ["TaiwanStockPriceAdj",410],["TaiwanStockBalanceSheet",240]];
 const data=await Promise.allSettled(datasets.map(([name,days])=>finmind(env,stock,name,days)));
 const warnings=data.flatMap((r,i)=>r.status==="rejected"?
  [datasets[i][0]+"："+String(r.reason?.message||"取得失敗")]:[]);
 if(data[0].status==="rejected")return reply({error:"FinMind 歷史行情取得失敗，已停止評分。",warnings},503);
 const rows=i=>data[i].status==="fulfilled"?data[i].value:[];
 const clean=normalize(rows(0),rows(1),rows(2),rows(3),rows(4),rows(5),rows(6),rows(7),rows(8));
 const datasetHealth=datasets.map(([name],i)=>{
   const r=data[i];
   const records=r.status==="fulfilled"?r.value:[];
   const dates=records.map(x=>String(x?.date||"")).filter(x=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x));
   const latestDate=dates.sort().at(-1)||null;
   return {name,status:r.status==="rejected"?"error":records.length?"ok":"empty",
     records:records.length,latestDate,
     message:r.status==="rejected"?String(r.reason?.message||"資料來源錯誤"):
       records.length?"已取得資料":"來源成功回應，但此股票／期間沒有資料"};
 });
 if(!clean.prices.length)return reply({error:"查無此股票可用行情，未產生分數。",warnings,datasetHealth},404);
 const officialResult=override?{quote:override,errors:[]}:await officialQuote(stock);
 const official=officialResult.quote;
 const verification=reconcile(official,clean.prices);
 let holding=null,newsResearch=null;
 const marketDate=clean.prices.at(-1)?.date;
 try{const tdccRows=shared?.tdccRows??await getHoldingRows();
   holding=concentration(tdccRows,stock,marketDate);
 }catch(error){warnings.push("TDCC 股權分散資料暫不可用："+String(error.message||error))}
 try{newsResearch=await researchNews(stock,marketDate,official?.market||override?.market||"上市",
   shared?.bulk?{...env,NEWS_FEED_URL:null,NEWS_FEED_TOKEN:null,DISABLE_NEWS_DISCOVERY:"true"}:env,
   shared?.newsByMarket?.[official?.market||override?.market],official?.name||override?.name||"");}
 catch(error){warnings.push("重大訊息核對暫未完成："+String(error.message||error))}
 // Only individual analysis invokes Shioaji; daily five-stock requests must not turn
 // into repeated historical polling of a personal brokerage connection.
 let brokerVerification={state:sinopacReady(env)?"not_checked":"not_configured",
  reason:"首頁批次不查詢券商，個股將盡力對照已完成交易日"};
 let brokerTechnicalPrices=[];
 if(!override&&sinopacReady(env)&&official?.date&&verification.state==="一致"&&
    /^[0-9]{4}$/.test(stock)){
   const broker=await privateBrokerHistory(stock,official.date,env);
   brokerVerification=reconcileBrokerHistory(broker,official,clean.prices);
   // Permission must be explicitly verified before brokerage-derived history is
   // used for any publicly rendered indicator. No broker prices are ever serialized.
   if(env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true"&&
       brokerVerification.state==="matched"&&broker.bars?.length>=61)
     brokerTechnicalPrices=broker.bars;
 }
 const score=scoreStock({...clean,official,holding,newsResearch,brokerTechnicalPrices});
 if(verification.state!=="一致"||official?.date!==clean.prices.at(-1)?.date)score.score=null;
 const latest=clean.prices.at(-1);
 const candles=clean.prices.filter(p=>[p.open,p.high,p.low,p.close].every(x=>Number.isFinite(x)&&x>0)&&
 p.high>=Math.max(p.open,p.close,p.low)&&p.low<=Math.min(p.open,p.close,p.high)).slice(-120);
 const links={twse:"https://www.twse.com.tw/",tpex:"https://www.tpex.org.tw/",mops:"https://mops.twse.com.tw/"};
 return reply({stock,name:official?.name||"",market:official?.market||"尚未辨認",
  asOf:new Date().toISOString(),finmind:{date:latest.date,close:latest.close},official,verification,
  score,candles,holding,newsResearch,datasetHealth,
  brokerVerification:{state:brokerVerification.state,reason:brokerVerification.reason,
   useInPublicScoring:env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true"&&brokerVerification.state==="matched"},
  missingMetrics:Object.entries(score.parts).flatMap(([group,part])=>
    part.items.filter(item=>item.score===null).map(item=>({group,name:item.name,reason:item.note||"來源資料不足"}))),
  valuationLatest:clean.valuation.filter(v=>v.date<=marketDate&&
    (Date.parse(marketDate+"T00:00:00Z")-Date.parse(v.date+"T00:00:00Z"))/86400000<=10)
    .sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null,
  sourceWarnings:[...warnings,...(newsResearch?.warnings||[]),...(official?[]:officialResult.errors)],links});
}
// 免 D1：每次快取到期直接由官方最新行情選出流動性候選，再逐檔核對 FinMind。
// 樣本範圍 10 檔，不能宣稱為全台股綜合得分最高前五。
async function computeTopFive(env,mode="score",exclude=[]){
 if(!env.FINMIND_TOKEN)return {ready:false,reason:"尚未設定 FINMIND_TOKEN Secret；未產生榜單。",
  marketDate:null,stocks:[]};
 // Free Workers: at most five candidates × nine FinMind requests + two market endpoints.
 // Value mode adds two valuation endpoints; keep below 50 external requests if no redirects.
 const perMarket=env.FULL_SCREENING_ENABLED==="true"?5:3;
 const official=await officialCandidates(perMarket,{mode:mode==="value"?"value":"liquid",exclude});
 if(!official.candidates.length)return {ready:false,reason:"尚未取得帶有有效交易日期的官方行情，無法產生今日觀察名單。",
  marketDate:official.marketDate,sourceWarnings:official.warnings,stocks:[]};
 const selected=env.FULL_SCREENING_ENABLED==="true"?official.candidates:official.candidates.slice(0,5);
 // Each official open-data file is requested once per daily computation, not once per stock.
 const [listedNews,otcNews]=env.FULL_SCREENING_ENABLED==="true"?
  await Promise.allSettled([loadOfficialDisclosures("上市"),loadOfficialDisclosures("上櫃")]):
  [{status:"fulfilled",value:{rows:[],error:"首頁樣本不批次讀取公告；點入個股時核對"}},
   {status:"fulfilled",value:{rows:[],error:"首頁樣本不批次讀取公告；點入個股時核對"}}];
 let tdccRows=[];
 if(perMarket===5){
  try{tdccRows=await getHoldingRows()}catch(error){console.warn("TDCC daily batch unavailable",String(error.message||error))}
 }
 const shared={
  tdccRows,bulk:perMarket!==5,
  newsByMarket:{
   "上市":listedNews.status==="fulfilled"?listedNews.value:{rows:[],error:"上市公告來源暫時不可用"},
   "上櫃":otcNews.status==="fulfilled"?otcNews.value:{rows:[],error:"上櫃公告來源暫時不可用"}
  }
 };
 const results=[];
 // 小批量連線，避免同時向 API 傳送大量請求；仍需注意各帳戶配額。
 for(let i=0;i<selected.length;i+=2){
  const pair=await Promise.allSettled(selected.slice(i,i+2).map(async row=>{
   const res=await analyze(row.stock,env,row,shared);
   if(!res.ok)return {stock:row.stock,error:"分析資料暫不可用（HTTP "+res.status+"）"};
   return await res.json();
  }));
  results.push(...pair.map((p,j)=>p.status==="fulfilled"?p.value:
   {stock:selected[i+j].stock,error:String(p.reason?.message||p.reason)}));
 }
 const good=results.filter(r=>r&&r.stock&&r.score);
 const ranking=selectDailyLeaders(good,{marketDate:official.marketDate,candidateCount:selected.length});
 const failed=results.filter(r=>r.error).map(r=>r.stock+"："+r.error);
 const value=valueWatchlist(good,{marketDate:official.marketDate,candidateCount:selected.length});
 return {ready:true,...ranking,value,asOf:new Date().toISOString(),
  sourceWarnings:[...official.warnings,...failed,
    ...(perMarket===3?["目前為免費額度模式：首頁不批次取得 TDCC 與授權新聞；點開個股才查證。"]:[])],
  markets:official.markets,
  reason:mode==="value"?
   "僅比較官方本益比／淨值比預篩的 "+selected.length+" 檔候選股票，並檢查 EPS 與現金流；不是內在價值排名。":
   ranking.stocks.length?
   "僅比較官方依成交金額預篩的 "+selected.length+" 檔候選股票，非全市場完整四面向最高分前五。":
   "此次候選股尚未取得足夠的同交易日、同評分口徑資料，未產生五檔名單。"};
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==="/api/health")return reply({ok:true,finmindConfigured:!!env.FINMIND_TOKEN,
  rankingMode:"on_demand_no_database",sinopacConfigured:sinopacReady(env),
  brokerAutomaticCheck:sinopacReady(env),brokerPublicAnalysisPermissionConfigured:
   env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true",
  version:"0.12.0",time:new Date().toISOString()});
 if(url.pathname==="/api/top5"){
  const cache=caches.default;
  const key=new Request(url.origin+"/api/top5?model=0.12");
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const body=await computeTopFive(env),response=reply(body,200,1800);
   if(body.ready&&body.stocks.length)ctx.waitUntil(cache.put(key,response.clone()));
   return response;
  }catch(err){return reply({ready:false,stocks:[],reason:"官方資料或分析 API 連線異常；未產生推薦名單。",
   detail:String(err.message||err)},503)}
 }
 if(url.pathname==="/api/value5"){
  const exclusion=(url.searchParams.get("exclude")||"").split(",").filter(v=>
   v.length===4&&[...v].every(ch=>ch>="0"&&ch<="9")).slice(0,5);
  const exclude=[...new Set(exclusion)].sort();
  const key=new Request(url.origin+"/api/value5?exclude="+exclude.join(",")+"&model=0.12"),
   cache=caches.default;
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const body=await computeTopFive(env,"value",exclude),response=reply(body,200,1800);
   if(body.ready)ctx.waitUntil(cache.put(key,response.clone()));
   return response;
  }catch(err){return reply({ready:false,value:{stocks:[]},reason:"價值觀察資料暫無法取得。",
    detail:String(err.message||err)},503)}
 }
 if(url.pathname==="/api/analyze"){
  const stock=(url.searchParams.get("stock")||"").trim();
  if(!valid(stock))return reply({error:"請輸入 4 至 6 位數股票代號。"},400);
  const key=new Request(url.origin+"/api/analyze?stock="+stock+"&model=0.12"),cache=caches.default;
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const res=await analyze(stock,env);
   if(res.ok)ctx.waitUntil(cache.put(key,res.clone()));
   return res;
  }catch(err){return reply({error:"資料來源連線異常；未產生評分。",
   detail:String(err.message||err)},503)}
 }
 if(url.pathname.startsWith("/api/"))return reply({error:"找不到 API"},404);
 return env.ASSETS.fetch(request);
}};
