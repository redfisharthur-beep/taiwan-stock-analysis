import {tickerPattern,isETFCandidate} from "./instruments.js";
import {finmind,officialQuote,scanOfficialUniverse,searchOfficialCompanies,normalize,reconcile} from "./providers.js";
import {scoreStock,indicators} from "./scoring.js";
import {getHoldingRows,concentration,archivedHoldingForStock} from "./holding.js";
import {researchNews} from "./news.js";
import {summarizeFinancialStatements} from "./fundamentals.js";
import {buildPeerComparison,buildOfficialIndustryComparison} from "./industry.js";
import {hasMarketDB,saveUniverse,getMarketSummary,getVerifiedTopFive,getMarketPage,searchSavedStocks,getSavedCompany,getSavedProfile,claimNextCompany,saveResearch,saveETFResearch,recordResearchFailure,getIndustryPeers,syncHoldingSnapshots,savedHolding} from "./market-db.js";
import {sinopacReady,privateBrokerHistory,reconcileBrokerHistory,compareRawTechnicalIndicators} from "./sinopac.js";
const reply=(body,status=200,ttl=900)=>new Response(JSON.stringify(body),{status,headers:{
 "Content-Type":"application/json; charset=utf-8",
 "Cache-Control":status===200?"public, max-age=0, s-maxage="+ttl:"no-store",
 "X-Content-Type-Options":"nosniff"}});
const valid=s=>tickerPattern.test(String(s||""));
/**
 * ETF is a fund, not an issuer operating company. Do not apply company EPS,
 * P/E, financial leverage or aggregate company investment scores to a fund.
 */
async function analyzeETF(stock,env,officialResult=null){
 const verified=officialResult??await officialQuote(stock),official=verified.quote;
 if(!official||official.kind!=="etf")return reply({error:"找不到可辨認的上市／上櫃 ETF 行情"},404);
 const raw=env.FINMIND_TOKEN?await Promise.allSettled([
  finmind(env,stock,"TaiwanStockPrice",410),
  finmind(env,stock,"TaiwanStockPriceAdj",410)]):[];
 const prices=normalize(raw[0]?.status==="fulfilled"?raw[0].value:[],[],[],[],[],[],[],
  raw[1]?.status==="fulfilled"?raw[1].value:[]).prices;
 const adjusted=normalize([],[],[],[],[],[],[],
  raw[1]?.status==="fulfilled"?raw[1].value:[]).adjusted;
 const sameDay=prices.find(p=>p.date===official.date);
 const verification=sameDay?reconcile(official,prices):
  {state:"單一官方來源",note:"官方 ETF 收盤行情可用；FinMind 同日歷史尚未取得"};
 const usable=prices.length?prices:[{date:official.date,close:official.close,volume:null}];
 const scored=scoreStock({prices:usable,adjusted});
 // For funds, only the technically observed indicators are displayed;
 // company-centric 100-point aggregate, EPS, debt and industry PR are excluded.
 const technical=scored.parts.technical;
 const score={score:null,observedPoints:technical.earned,coveredPoints:technical.covered,
  parts:{technical},indicators:scored.indicators,technicalMode:scored.technicalMode};
 const candles=prices.filter(p=>[p.open,p.high,p.low,p.close].every(x=>
  typeof x==="number"&&Number.isFinite(x)&&x>0)).slice(-120);
 const result={stock,kind:"etf",name:official.name,market:official.market,
  asOf:new Date().toISOString(),official,finmind:{date:official.date,close:official.close},
  verification,score,candles,financialInsights:null,holding:null,newsResearch:null,
  industryComparison:{items:[],reason:"ETF 不適用公司同產業本益比比較"},
  datasetHealth:[],sourceWarnings:raw.filter(x=>x.status==="rejected").map(x=>
   "ETF 歷史行情來源："+String(x.reason?.message||x.reason)),
  missingMetrics:[],links:{mops:"https://mops.twse.com.tw/"}};
 return reply(result);
}
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
 let holdingStatus={code:"not_checked",reason:"尚未開始核對持股週期"};
 if(holding?.trend)holdingStatus={code:"verified",reason:"已取得三期集保持股紀錄"};
 if(!holding){try{const tdccRows=shared?.tdccRows??await getHoldingRows();
   holding=concentration(tdccRows,stock,marketDate);
   holdingStatus=holding?.trend?{code:"verified",reason:"TDCC 來源包含三期有效週資料"}:
    holding?{code:"latest_only",reason:"TDCC 最新資料已取得，但可核對的連續三週持股紀錄不足"}:
    {code:"no_current_record",reason:"TDCC 當期資料沒有此股票可核對的持股級距"};
 }catch(error){
   holdingStatus={code:"tdcc_unavailable",reason:"TDCC 當期資料讀取失敗："+String(error.message||error)};
   warnings.push(holdingStatus.reason);
 }}
 if(!holding?.trend&&!shared?.bulk&&!shared?.skipArchive){
  try{
   const archive=await archivedHoldingForStock(stock,marketDate,fetch,{
    onStatus:status=>{holdingStatus=status}
   });
   if(archive?.trend)holding=archive;
  }catch(error){
   holdingStatus={code:"archive_error",reason:"公開三週備份查詢失敗："+String(error.message||error)};
   warnings.push(holdingStatus.reason);
  }
 }
 if(!holding?.trend){
  holding={...(holding||{}),trend:null,
   note:"持股趨勢待查："+holdingStatus.reason};
 }
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
  score,candles,holding,holdingStatus,newsResearch,datasetHealth,financialInsights,
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
  const universe=await scanOfficialUniverse();
  if(universe.marketCount!==2||universe.markets.some(x=>!x.registryAvailable))
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
  const universe=await scanOfficialUniverse();
  if(universe.marketCount===2&&universe.markets.every(x=>x.registryAvailable))
   await saveUniverse(db,universe);
  return;
 }
 if(!env.FINMIND_TOKEN)return;
 const row=await claimNextCompany(db);
 if(!row)return;
 const override={kind:row.industry==="ETF"?"etf":"stock",market:row.market,source:row.market==="上市"?"TWSE":"TPEx",name:row.name,
  close:row.close,date:row.date,url:row.market==="上市"?
   "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL":
   "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"};
 if(row.industry==="ETF"){
  try{
   const response=await analyzeETF(row.stock,env,{quote:override,errors:[]});
   if(!response.ok)throw Error("ETF 深入分析 HTTP "+response.status);
   await saveETFResearch(db,row,await response.json());
  }catch(error){await recordResearchFailure(db,row.stock,String(error.message||error))}
  return;
 }
 const held=await savedHolding(db,row.stock,row.date);
 try{
  const response=await analyze(row.stock,env,override,{bulk:false,skipNews:true,skipArchive:false,tdccRows:[],
   // A stored weekly snapshot is shared across stocks; never re-download TDCC per company.
   cachedHolding:held,newsByMarket:{
    "上市":{rows:[],error:"排程未批次核對新聞"},
    "上櫃":{rows:[],error:"排程未批次核對新聞"}},
   persist:(clean,body)=>saveResearch(db,row,clean,body)});
  if(!response.ok)throw Error("深入分析 HTTP "+response.status);
 }catch(error){await recordResearchFailure(db,row.stock,String(error.message||error));}
}
// Homepage lists only verified, fully covered results from the entire stored universe.
// Never use an unscored price/valuation prescreen as an apparent top-score recommendation.
async function computeDailyObservations(env){
 if(!hasMarketDB(env))return {ready:false,stocks:[],etfs:[],analyzedCount:0,
  reason:"尚未啟用全市場研究資料庫，沒有可核實的綜合分數；不以估值初篩冒充前五名。"};
 const [summary,top]=await Promise.all([
  getMarketSummary(env.MARKET_DB),getVerifiedTopFive(env.MARKET_DB)
 ]);
 const isComplete=summary.eligible>0&&summary.currentProfiles>=summary.eligible&&
  summary.markets?.length===2&&summary.markets.every(m=>m.registryAvailable);
 return {ready:top.stocks.length>0||top.etfs.length>0,
  marketDate:summary.marketDate,asOf:new Date().toISOString(),
  stocks:top.stocks,etfs:top.etfs,analyzedCount:summary.profiles,
  selectedStocks:top.selectedStocks,selectedETFs:top.selectedETFs,
  universe:{total:summary.total,profiles:summary.profiles,currentProfiles:summary.currentProfiles,
   fullCoverage:summary.fullCoverage,scannedAll:isComplete},
  reason:!summary.total?"尚未完成上市與上櫃股票名冊同步。":
   !isComplete?"目前僅顯示已取得完整且核實資料的股票；全市場逐檔研究仍在進行，非全市場最終前五名。":
   top.stocks.length<5?"市場名冊已掃描，但完整且經核實的公司股票不足五檔。":
   "依已核實且涵蓋100%的公司綜合分數排序；ETF僅依其獨立技術指標排序。"};
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==="/api/health")return reply({ok:true,finmindConfigured:!!env.FINMIND_TOKEN,
  rankingMode:"verified_100_coverage_full_market_scores",sinopacConfigured:sinopacReady(env),
  brokerAutomaticCheck:sinopacReady(env),brokerPublicAnalysisPermissionConfigured:
   env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true",
  version:"0.19.0",marketDBConfigured:hasMarketDB(env),time:new Date().toISOString()});
 if(url.pathname==="/api/search"){
  const q=(url.searchParams.get("q")||"").trim();
  if(!q||q.length>30)return reply({results:[]},200,90);
  try{
   let results=[];
   results=await searchOfficialCompanies(q);
   if(!results.length&&hasMarketDB(env))results=await searchSavedStocks(env.MARKET_DB,q);
   return reply({results},200,300);
  }catch(error){return reply({results:[],error:"股票名冊暫不可用"},503)}
 }
 if(url.pathname==="/api/universe"){
  const market=(url.searchParams.get("market")||"all").trim();
  if(!["all","上市","上櫃","ETF","股票"].includes(market))
   return reply({error:"無效市場篩選"},400);
  const query=(url.searchParams.get("q")||"").trim().slice(0,30);
  const page=Math.max(1,Math.min(10000,Number.parseInt(url.searchParams.get("page")||"1",10)||1));
  const pageSize=30;
  try{
   if(hasMarketDB(env)){
    const data=await getMarketPage(env.MARKET_DB,{market,query,page,pageSize});
    return reply({...data,market,query,configured:true},200,90);
   }
   // Without D1 show only verified public identity/quotes; never invent analyzed coverage.
   const snapshot=await scanOfficialUniverse();
   const matches=snapshot.allStocks.filter(r=>(market==="all"||
     market==="ETF"&&r.kind==="etf"||market==="股票"&&r.kind==="stock"||
     (market==="上市"||market==="上櫃")&&r.market===market)&&
     (!query||r.stock.includes(query)||r.name.includes(query)));
   const start=(page-1)*pageSize;
   return reply({configured:false,market,query,page,pageSize,total:matches.length,
    pages:Math.ceil(matches.length/pageSize),marketDate:snapshot.marketDate,
    warnings:snapshot.warnings,rows:matches.slice(start,start+pageSize).map(r=>({
     stock:r.stock,name:r.name,market:r.market,kind:r.kind,price:r.close,
     quoteDate:r.date,coverage:null,score:null,technicalCoverage:null,
     status:r.close>0?"unscored":"no_quote"
    }))},200,300);
  }catch(error){return reply({error:"全市場名冊暫不可用",detail:String(error.message||error)},503)}
 }
 if(url.pathname==="/api/market-status"){
  if(!hasMarketDB(env))return reply({configured:false,reason:"尚未綁定並遷移 D1 市場資料庫"},200,60);
  try{return reply(await getMarketSummary(env.MARKET_DB),200,60)}
  catch{return reply({configured:true,error:"資料表尚未初始化"},503)}
 }
 if(url.pathname==="/api/observations"||url.pathname==="/api/top5"){
  const cache=caches.default;
  const key=new Request(url.origin+"/api/observations?model=0.19.0");
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const body=await computeDailyObservations(env);
   const response=reply(body,200,1800);
   if(body.ready)ctx.waitUntil(cache.put(key,response.clone()));
   return response;
  }catch(err){return reply({ready:false,stocks:[],reason:"官方資料或分析服務暫時無法取得。",
   detail:String(err.message||err)},503)}
 }
 if(url.pathname==="/api/analyze"){
  const stock=(url.searchParams.get("stock")||"").trim();
  if(!valid(stock))return reply({error:"請輸入 4 至 6 位數股票代號。"},400);
  const key=new Request(url.origin+"/api/analyze?stock="+stock+"&model=0.19.0"),cache=caches.default;
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const res=isETFCandidate(stock)?
    await analyzeETF(stock,env):await analyze(stock,env);
   if(res.ok){
    const payload=await res.clone().json();
    // 不依賴 D1：直接取同日官方全市場批次估值，顯示可驗證的同產業 PE/PB/殖利率 PR。
    // 其餘財報、技術、籌碼仍依個股真實資料分析，不能由估值表推測。
    if(payload.kind!=="etf"&&!hasMarketDB(env)){
     try{
      const official=await scanOfficialUniverse();
      payload.industryComparison=buildOfficialIndustryComparison(stock,official);
     }catch(error){payload.industryComparison={items:[],reason:"官方同業估值暫不可用，PR 待查"};}
    }
    if(payload.kind!=="etf"&&hasMarketDB(env)){
     try{
      const company=await getSavedCompany(env.MARKET_DB,stock);
      if(company){
       const stored=await getSavedProfile(env.MARKET_DB,stock);
       // A current, same-session verified archive may restore a complete score when
       // one upstream feed is transiently unavailable during an individual revisit.
       // Never reuse an older session, unverified profile or unearned coverage.
       if(payload.score?.score===null&&stored?.marketDate===payload.finmind.date&&
          company.date===payload.finmind.date&&payload.verification?.state==="一致"&&
          stored.metrics?.verified===true&&stored.score?.coveragePercent===100&&
          Number.isFinite(stored.score?.baseScore)&&
          ["fundamental","technical","chips"].every(k=>
           stored.score.parts?.[k]?.covered===stored.score.parts?.[k]?.max)){
        const currentDelta=payload.score.newsDelta??0;
        const archiveScore=stored.score;
        payload.score={...archiveScore,newsDelta:currentDelta,
         parts:{...archiveScore.parts,news:payload.score.parts?.news||archiveScore.parts.news},
         score:Math.max(0,Math.min(100,
          Math.round((archiveScore.baseScore+currentDelta)*100)/100)),
         scoreSource:"同交易日已核實研究快照"};
        if(stored.metrics.financialInsights){
         const original=stored.metrics.financialInsights;
         const recent=payload.financialInsights||{};
         const sameIncome=original.incomeDate===recent.incomeDate;
         const sameBalance=original.balanceDate===recent.balanceDate;
         payload.financialInsights={...recent,
          ...(sameIncome&&Number.isFinite(original.netMargin)&&recent.netMargin==null?
           {netMargin:original.netMargin}:{}),
          ...(sameIncome&&sameBalance&&Number.isFinite(original.quarterlyRoe)&&
           recent.quarterlyRoe==null?{quarterlyRoe:original.quarterlyRoe}:{})};
        }
       }
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
