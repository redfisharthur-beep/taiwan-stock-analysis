import {finmind,officialQuote,officialCandidates,scanOfficialUniverse,rankUniverseCandidates,normalize,reconcile} from "./providers.js";
import {scoreStock,indicators} from "./scoring.js";
import {selectDailyLeaders} from "./ranking.js";
import {getHoldingRows,concentration} from "./holding.js";
import {loadOfficialDisclosures,researchNews} from "./news.js";
import {valueWatchlist} from "./value.js";
import {sinopacReady,privateBrokerHistory,reconcileBrokerHistory,compareRawTechnicalIndicators} from "./sinopac.js";
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
 let brokerTechnicalPrices=[],brokerBars=[];
 if(!override&&sinopacReady(env)&&official?.date&&verification.state==="一致"&&
    /^[0-9]{4}$/.test(stock)){
   const broker=await privateBrokerHistory(stock,official.date,env);
   brokerVerification=reconcileBrokerHistory(broker,official,clean.prices);
   if(broker.status==="ok")brokerBars=broker.bars;
   // Permission must be explicitly verified before brokerage-derived history is
   // used for any publicly rendered indicator. No broker prices are ever serialized.
   if(env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true"&&
       brokerVerification.state==="matched"&&broker.bars?.length>=61)
     brokerTechnicalPrices=broker.bars;
 }
 const score=scoreStock({...clean,official,holding,newsResearch,brokerTechnicalPrices});
 if(brokerVerification.state==="matched"&&brokerBars.length>=61&&score.technicalMode==="raw"){
   const brokerIndicators=indicators(brokerBars);
   brokerVerification.indicatorReview=compareRawTechnicalIndicators(score.indicators,brokerIndicators);
 }else if(brokerVerification.state==="matched"&&score.technicalMode==="adjusted"){
   brokerVerification.indicatorReview={state:"not_comparable",
    reason:"FinMind 使用除權息還原價、永豐使用未還原日線；不能直接比較技術指標數值"};
 }
 if(verification.state!=="一致"||official?.date!==clean.prices.at(-1)?.date)score.score=null;
 const latest=clean.prices.at(-1);
 const candles=clean.prices.filter(p=>[p.open,p.high,p.low,p.close].every(x=>Number.isFinite(x)&&x>0)&&
 p.high>=Math.max(p.open,p.close,p.low)&&p.low<=Math.min(p.open,p.close,p.high)).slice(-120);
 const links={twse:"https://www.twse.com.tw/",tpex:"https://www.tpex.org.tw/",mops:"https://mops.twse.com.tw/"};
 return reply({stock,name:official?.name||"",market:official?.market||"尚未辨認",
  asOf:new Date().toISOString(),finmind:{date:latest.date,close:latest.close},official,verification,
  score,candles,holding,newsResearch,datasetHealth,
  brokerVerification:{state:brokerVerification.state,reason:brokerVerification.reason,
   indicatorReview:brokerVerification.indicatorReview||null,
   useInPublicScoring:env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true"&&brokerVerification.state==="matched"},
  missingMetrics:Object.entries(score.parts).flatMap(([group,part])=>
    part.items.filter(item=>item.score===null).map(item=>({group,name:item.name,reason:item.note||"來源資料不足"}))),
  valuationLatest:clean.valuation.filter(v=>v.date<=marketDate&&
    (Date.parse(marketDate+"T00:00:00Z")-Date.parse(v.date+"T00:00:00Z"))/86400000<=10)
    .sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null,
  sourceWarnings:[...warnings,...(newsResearch?.warnings||[]),...(official?[]:officialResult.errors)],links});
}
// 一次掃描兩市場官方行情及估值的所有當日四位數個股；每組再選 5 檔做深入資料核對。
// 免費 Worker 每次 50 次外部請求上限：4 次官方全市場資料 + 5×9 次 FinMind = 49 次。
// 若 FinMind 或官方資料缺漏，依真實初篩資料顯示，但絕不冒充已完成 100 分評估。
async function computeTopFive(env,mode="daily",exclude=[]){
 const universe=await scanOfficialUniverse({priceCeiling:500});
 const candidates=rankUniverseCandidates(universe.stocks.filter(r=>!exclude.includes(r.stock)),mode,5);
 const marketComplete=universe.marketCount===universe.expectedMarketCount&&
  universe.markets.every(m=>m.date===universe.marketDate);
 const base={ready:candidates.length>0,marketDate:universe.marketDate,
  asOf:new Date().toISOString(),priceCeiling:500,
  universe:{total:universe.universeCount,sameDate:universe.sameDateCount,
   priced:universe.pricedCount,underCeiling:universe.affordableCount,
   tradable:universe.tradableCount,overCeiling:universe.excludedOverCeiling,
   missingPrice:universe.missingPriceCount,staleMarket:universe.staleMarketCount,
   marketComplete,markets:universe.markets,scope:"官方當日行情可辨認的四位數上市／上櫃股票"},
  markets:universe.markets,sourceWarnings:universe.warnings,
  scope:"whole_official_daily_universe_prescreen",
  analyzedCount:0,candidateCount:candidates.length,stocks:[]};
 if(!candidates.length)return {...base,reason:"官方當日行情尚未形成符合價格與成交條件的候選；沒有以舊日資料冒充今日資料。"};
 const shared={tdccRows:[],bulk:true,newsByMarket:{
  "上市":{rows:[],error:"批次未逐檔核對重大訊息；請進入個股確認"},
  "上櫃":{rows:[],error:"批次未逐檔核對重大訊息；請進入個股確認"}}};
 const investigated=new Map();
 if(env.FINMIND_TOKEN){
  // 不同股票的個股資料缺漏不應阻止其餘名單顯示。
  for(const row of candidates){
   try{
    const res=await analyze(row.stock,env,row,shared);
    if(res.ok)investigated.set(row.stock,await res.json());
   }catch(error){console.warn("daily research failed for",row.stock,String(error.message||error))}
  }
 }
 const stocks=candidates.map((row,i)=>{
  const deep=investigated.get(row.stock)||null,validDeep=deep&&
   deep.verification?.state==="一致"&&deep.official?.date===universe.marketDate&&
   deep.finmind?.date===universe.marketDate;
  const fs=validDeep?deep.score?.parts?.fundamental?.items||[]:[];
  const eps=fs.find(x=>x.name==="EPS 與去年同季");
  const cash=fs.find(x=>x.name==="營業現金流（初步）");
  const leverage=fs.find(x=>x.name==="獲利品質與負債");
  const checkNotes=[
   {label:"EPS 為正",status:!validDeep||eps?.value?.eps===undefined?"unknown":eps.value.eps>0?"pass":"fail"},
   {label:"營業現金流為正",status:!validDeep||typeof cash?.value!=="number"?"unknown":cash.value>0?"pass":"fail"},
   {label:"財務負債初步檢查",status:!validDeep||leverage?.value?.debtRatioPct==null?
    "unknown":leverage.value.debtRatioPct<=70?"pass":"fail"}];
  const checks=[...row.screening.checks,...checkNotes];
  const allKnown=checks.every(c=>c.status!=="unknown"),passAll=allKnown&&checks.every(c=>c.status==="pass");
  return {rank:i+1,stock:row.stock,name:row.name,market:row.market,date:row.date,
   close:row.close,turnover:row.turnover,screening:row.screening,checks,
   passedAll:passAll,criteriaMet:checks.filter(x=>x.status==="pass").length,
   criteriaKnown:checks.filter(x=>x.status!=="unknown").length,
   detailVerified:!!validDeep,observedPoints:validDeep?deep.score.observedPoints:null,
   coveredPoints:validDeep?deep.score.coveredPoints:0,
   parts:validDeep?Object.fromEntries(Object.entries(deep.score.parts).map(([k,v])=>
    [k,{earned:v.earned,covered:v.covered,max:v.max}])):null,
   reason:mode==="value"?
    passAll?"初步估值與已取得的財務條件符合設定門檻；未推估內在價值":
    "依可取得的官方估值相對排序；未通過或未取得的檢查請看下方標籤":
    "官方當日收盤價 低於 500 元；參考估值與成交金額進行全市場初篩"};
 });
 return {...base,stocks,analyzedCount:investigated.size,
  strictCount:stocks.filter(s=>s.passedAll).length,
  reason:marketComplete?
   "已讀取兩市場當日四位數股票行情，對符合價格與成交條件者逐檔進行官方初篩；僅名單內股票嘗試九項 FinMind 深入核對。":
   "當日兩市場行情未同時齊備；目前名單僅根據可用市場初篩，不可視為完整市場比較。"};
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==="/api/health")return reply({ok:true,finmindConfigured:!!env.FINMIND_TOKEN,
  rankingMode:"whole_market_daily_prescreen_five_deep_research",sinopacConfigured:sinopacReady(env),
  brokerAutomaticCheck:sinopacReady(env),brokerPublicAnalysisPermissionConfigured:
   env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true",
  version:"0.13.0",time:new Date().toISOString()});
 if(url.pathname==="/api/top5"||url.pathname==="/api/value5"){
  const isValue=url.pathname==="/api/value5";
  // 排除參數限特定查詢用途；首頁價值名單不排除每日名單。
  const exclusion=isValue?(url.searchParams.get("exclude")||"").split(",").filter(v=>
   /^[0-9]{4}$/.test(v)).slice(0,5):[];
  const exclude=[...new Set(exclusion)].sort();
  const key=new Request(url.origin+url.pathname+"?exclude="+exclude.join(",")+"&model=0.13.0"),
   cache=caches.default;
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const body=await computeTopFive(env,isValue?"value":"daily",exclude);
   const response=reply(body,200,1800);
   if(body.ready)ctx.waitUntil(cache.put(key,response.clone()));
   return response;
  }catch(err){return reply({ready:false,stocks:[],reason:"全市場官方資料或分析 API 連線異常，沒有使用舊資料補排名。",
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
