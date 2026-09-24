import {finmind,officialQuote,scanOfficialUniverse,rankUniverseCandidates,searchOfficialCompanies,normalize,reconcile} from "./providers.js";
import {scoreStock,indicators} from "./scoring.js";
import {getHoldingRows,concentration} from "./holding.js";
import {researchNews} from "./news.js";
import {assessUndervaluation} from "./value.js";
import {summarizeFinancialStatements} from "./fundamentals.js";
import {buildPeerComparison} from "./industry.js";
import {hasMarketDB,saveUniverse,getMarketSummary,searchSavedStocks,getSavedCompany,getSavedProfile,getDailySaved,claimNextCompany,saveResearch,recordResearchFailure,getIndustryPeers,syncHoldingSnapshots,savedHolding} from "./market-db.js";
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
 const data=await Promise.allSettled(datasets.map(([name,days])=>shared?.bulk&&name==="TaiwanStockMarginPurchaseShortSale"?
   Promise.resolve([]):finmind(env,stock,name,days)));
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
   return {name,status:shared?.bulk&&name==="TaiwanStockMarginPurchaseShortSale"?"skipped":
      r.status==="rejected"?"error":records.length?"ok":"empty",
     records:records.length,latestDate,
     message:r.status==="rejected"?String(r.reason?.message||"資料來源錯誤"):
       shared?.bulk&&name==="TaiwanStockMarginPurchaseShortSale"?"首頁免費額度略過融資融券逐檔資料；請點入個股核對":
       records.length?"已取得資料":"來源成功回應，但此股票／期間沒有資料"};
 });
 if(!clean.prices.length)return reply({error:"查無此股票可用行情，未產生分數。",warnings,datasetHealth},404);
 const officialResult=override?{quote:override,errors:[]}:await officialQuote(stock);
 const official=officialResult.quote;
 const verification=reconcile(official,clean.prices);
 let holding=shared?.cachedHolding||null,newsResearch=null;
 const marketDate=clean.prices.at(-1)?.date;
 if(!holding){try{const tdccRows=shared?.tdccRows??await getHoldingRows();
   holding=concentration(tdccRows,stock,marketDate);
 }catch(error){warnings.push("TDCC 股權分散資料暫不可用："+String(error.message||error))}}
 try{newsResearch=await researchNews(stock,marketDate,official?.market||override?.market||"上市",
   shared?.bulk||shared?.skipNews?{...env,NEWS_FEED_URL:null,NEWS_FEED_TOKEN:null,DISABLE_NEWS_DISCOVERY:"true"}:env,
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
 const financialInsights=summarizeFinancialStatements(clean);
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
 const responseBody={stock,name:official?.name||"",market:official?.market||"尚未辨認",
  asOf:new Date().toISOString(),finmind:{date:latest.date,close:latest.close},official,verification,
  score,candles,holding,newsResearch,datasetHealth,financialInsights,
  brokerVerification:{state:brokerVerification.state,reason:brokerVerification.reason,
   indicatorReview:brokerVerification.indicatorReview||null,
   useInPublicScoring:env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true"&&brokerVerification.state==="matched"},
  missingMetrics:Object.entries(score.parts).flatMap(([group,part])=>
    part.items.filter(item=>item.score===null).map(item=>({group,name:item.name,reason:item.note||"來源資料不足"}))),
  valuationLatest:clean.valuation.filter(v=>v.date<=marketDate&&
    (Date.parse(marketDate+"T00:00:00Z")-Date.parse(v.date+"T00:00:00Z"))/86400000<=10)
    .sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null,
  sourceWarnings:[...warnings,...(newsResearch?.warnings||[]),...(official?[]:officialResult.errors)],links};
 if(typeof shared?.persist==="function")await shared.persist(clean,responseBody);
 return reply(responseBody);
}
// D1 data collection is scheduled, bounded, and tracked. Unconfigured databases do not
// trigger public GET writes or pretend to contain a full-market financial history.
async function performScheduled(controller,env){
 if(!hasMarketDB(env))return;
 const db=env.MARKET_DB,cron=controller.cron||"";
 if(cron==="0 11 * * MON-FRI"){
  const universe=await scanOfficialUniverse({priceCeiling:500});
  if(universe.marketCount!==2||universe.markets.some(x=>!x.registryAvailable||x.date!==universe.marketDate))
   throw Error("兩市場名冊或日期不完整，保留先前已核實的資料庫行情");
  await saveUniverse(db,universe);
  return;
 }
 if(cron==="30 11 * * FRI"){
  const summary=await getMarketSummary(db);
  if(summary.marketDate)await syncHoldingSnapshots(db,summary.marketDate);
  return;
 }
 const summary=await getMarketSummary(db);
 if(summary.total===0){
  const universe=await scanOfficialUniverse({priceCeiling:500});
  if(universe.marketCount===2&&universe.markets.every(x=>x.registryAvailable&&x.date===universe.marketDate))
   await saveUniverse(db,universe);
  return;
 }
 if(!env.FINMIND_TOKEN)return;
 const row=await claimNextCompany(db);
 if(!row)return;
 const held=await savedHolding(db,row.stock,row.date);
 const override={market:row.market,source:row.market==="上市"?"TWSE":"TPEx",name:row.name,
  close:row.close,date:row.date,url:row.market==="上市"?
   "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL":
   "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"};
 try{
  const response=await analyze(row.stock,env,override,{bulk:false,skipNews:true,tdccRows:[],
   // A stored weekly snapshot is shared across stocks; never re-download TDCC per company.
   cachedHolding:held,newsByMarket:{
    "上市":{rows:[],error:"排程未批次核對新聞"},
    "上櫃":{rows:[],error:"排程未批次核對新聞"}},
   persist:(clean,body)=>saveResearch(db,row,clean,body)});
  if(!response.ok)throw Error("深入分析 HTTP "+response.status);
 }catch(error){await recordResearchFailure(db,row.stock,String(error.message||error));}
}
// 每日單一名單：官方全市場估值先選五檔，再核對可取得的財報與歷史行情。
// 免費 Worker 單次子請求目標：六份市場批次資料＋五檔各八份 FinMind，約 46 次。
// 若 FinMind 或官方資料缺漏，依真實初篩資料顯示，但絕不冒充已完成 100 分評估。
function formatDailyStocks(candidates,investigated,marketDate){
 return candidates.map((row,i)=>{
  const deep=investigated.get(row.stock)||null,validDeep=deep&&
   deep.verification?.state==="一致"&&deep.official?.date===marketDate&&
   deep.finmind?.date===marketDate;
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
  const assessment=assessUndervaluation(row,validDeep?deep:null,marketDate);
  const allKnown=checks.every(c=>c.status!=="unknown"),passAll=allKnown&&checks.every(c=>c.status==="pass");
  return {rank:i+1,stock:row.stock,name:row.name,market:row.market,date:row.date,
   close:row.close,turnover:row.turnover,screening:row.screening,checks,
   passedAll:passAll,criteriaMet:checks.filter(x=>x.status==="pass").length,
   criteriaKnown:checks.filter(x=>x.status!=="unknown").length,
   ...assessment,detailVerified:!!validDeep,observedPoints:validDeep?deep.score.observedPoints:null,
   coveredPoints:validDeep?deep.score.coveredPoints:0,
   parts:validDeep?Object.fromEntries(Object.entries(deep.score.parts).map(([k,v])=>
    [k,{earned:v.earned,covered:v.covered,max:v.max}])):null,
   reason:"上市櫃官方行情與估值初步篩選；財報待查者不標記被低估"};
 });
}

async function computeStoredFive(env){
 const db=env.MARKET_DB;
 const saved=await getDailySaved(db,5);
 if(!saved.stocks.length)return null;
 const summary=await getMarketSummary(db),investigated=new Map();
 const candidates=rankUniverseCandidates(saved.stocks,"value",5);
 for(const row of saved.stocks){
  if(!row.profile?.score||!row.profile?.metrics?.verified)continue;
  investigated.set(row.stock,{score:row.profile.score,verification:{state:"一致"},
   official:{date:row.date},finmind:{date:row.profileDate,close:row.close}});
 }
 const stocks=formatDailyStocks(candidates,investigated,saved.marketDate);
 return {ready:true,marketDate:saved.marketDate,asOf:new Date().toISOString(),
  priceCeiling:500,scope:"full_market_stored_daily_prescreen",
  universe:{total:summary.total,tradable:summary.eligible,
   marketComplete:summary.markets.length===2&&
   summary.markets.every(x=>x.date===saved.marketDate&&x.registryAvailable)},
  stocks,candidateCount:stocks.length,analyzedCount:investigated.size,
  sourceWarnings:summary.warnings||[],
  researchProgress:{total:summary.total,finance:summary.finance,
   technical:summary.technical,chips:summary.chips},
  reason:"名單依已入庫的官方全市場行情與估值產生；歷史財報、技術與籌碼將依排程分批更新。"};
}
async function computeTopFive(env){
 const universe=await scanOfficialUniverse({priceCeiling:500});
 const candidates=rankUniverseCandidates(universe.stocks,"value",5);
 const marketComplete=universe.marketCount===universe.expectedMarketCount&&
  universe.markets.every(m=>m.date===universe.marketDate&&m.registryAvailable);
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
 const stocks=formatDailyStocks(candidates,investigated,universe.marketDate);
 return {...base,stocks,analyzedCount:investigated.size,
  reason:marketComplete?
   "已讀取兩市場公司名冊及當日行情，對符合價格與成交條件者逐檔初篩；僅名單內股票嘗試八項 FinMind 深入核對。":
   "當日兩市場行情未同時齊備；目前名單僅根據可用市場初篩，不可視為完整市場比較。"};
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==="/api/health")return reply({ok:true,finmindConfigured:!!env.FINMIND_TOKEN,
  rankingMode:"whole_market_daily_prescreen_scheduled_research",sinopacConfigured:sinopacReady(env),
  brokerAutomaticCheck:sinopacReady(env),brokerPublicAnalysisPermissionConfigured:
   env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true",
  version:"0.15.0",marketDBConfigured:hasMarketDB(env),time:new Date().toISOString()});
 if(url.pathname==="/api/search"){
  const q=(url.searchParams.get("q")||"").trim();
  if(!q||q.length>30)return reply({results:[]},200,90);
  try{
   let results=[];
   if(hasMarketDB(env))results=await searchSavedStocks(env.MARKET_DB,q);
   if(!results.length)results=await searchOfficialCompanies(q);
   return reply({results},200,300);
  }catch(error){return reply({results:[],error:"股票名冊暫不可用"},503)}
 }
 if(url.pathname==="/api/market-status"){
  if(!hasMarketDB(env))return reply({configured:false,reason:"尚未綁定並遷移 D1 市場資料庫"},200,60);
  try{return reply(await getMarketSummary(env.MARKET_DB),200,60)}
  catch{return reply({configured:true,error:"資料表尚未初始化"},503)}
 }
 if(url.pathname==="/api/top5"){
  const cache=caches.default;
  const key=new Request(url.origin+"/api/top5?model=0.15.0");
  const hit=await cache.match(key);if(hit)return hit;
  try{
   let body=null;
   if(hasMarketDB(env)){
    try{body=await computeStoredFive(env)}
    catch(error){console.warn("market database not ready",String(error.message||error))}
   }
   if(!body)body=await computeTopFive(env);
   const response=reply(body,200,1800);
   if(body.ready)ctx.waitUntil(cache.put(key,response.clone()));
   return response;
  }catch(err){return reply({ready:false,stocks:[],reason:"官方資料或分析服務暫時無法取得。",
   detail:String(err.message||err)},503)}
 }
 if(url.pathname==="/api/analyze"){
  const stock=(url.searchParams.get("stock")||"").trim();
  if(!valid(stock))return reply({error:"請輸入 4 至 6 位數股票代號。"},400);
  const key=new Request(url.origin+"/api/analyze?stock="+stock+"&model=0.15.0"),cache=caches.default;
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const res=await analyze(stock,env);
   if(res.ok){
    const payload=await res.clone().json();
    if(hasMarketDB(env)){
     try{
      const company=await getSavedCompany(env.MARKET_DB,stock);
      if(company){
       const stored=await getSavedProfile(env.MARKET_DB,stock);
       if(stored?.metrics){
        const own={stock,industry:company.industry,market:company.market,
         marketDate:payload.finmind.date,metrics:{...stored.metrics,
          technical:payload.score?.indicators||stored.metrics.technical,
          technicalDate:payload.score?.indicators?.date||null}};
        const peers=await getIndustryPeers(env.MARKET_DB,company,payload.finmind.date);
        payload.industryComparison=buildPeerComparison(own,peers);
       }else payload.industryComparison={industry:company.industry,items:[],
        reason:"同產業財報尚未入庫，暫不計算 PR"};
       const f=stored.metrics||{};
       payload.researchArchive={finance:stored.financialPeriod,technical:stored.technicalDate,
        chips:stored.chipsDate,updatedAt:stored.fetchedAt};
      }
     }catch(error){payload.industryComparison={industry:null,items:[],
      reason:"同產業資料庫暫不可用，PR 待查"}}
    }
    const result=reply(payload,200,900);
    ctx.waitUntil(cache.put(key,result.clone()));
    return result;
   }
   return res;
  }catch(err){return reply({error:"資料來源連線異常；未產生評分。",
   detail:String(err.message||err)},503)}
 }
 if(url.pathname.startsWith("/api/"))return reply({error:"找不到 API"},404);
 return env.ASSETS.fetch(request);
},
 async scheduled(controller,env,ctx){ctx.waitUntil(performScheduled(controller,env))}
};
