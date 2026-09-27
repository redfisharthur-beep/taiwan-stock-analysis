import {mergeVerifiedResearch} from "./top-five.js";
import {tickerPattern,isETFCandidate} from "./instruments.js";
import {finmind,officialQuote,scanOfficialUniverse,searchOfficialCompanies,normalize,reconcile,rankUniverseCandidates} from "./providers.js";
import {scoreStock,indicators} from "./scoring.js";
import {researchNews} from "./news.js";
import {summarizeFinancialStatements} from "./fundamentals.js";
import {buildPeerComparison,buildOfficialIndustryComparison} from "./industry.js";
import {hasMarketDB,saveUniverse,getMarketSummary,getVerifiedTopFive,getMarketPage,searchSavedStocks,getSavedCompany,getSavedProfile,claimNextCompany,saveResearch,saveETFResearch,recordResearchFailure,getIndustryPeers} from "./market-db.js";
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
 // Fund-only model: missing technical indicators contribute 0, while the
 // coverage percentage remains visible. Same-day official/FinMind verification
 // is still required before the ETF can enter the homepage ranking.
 const fundComplete=technical.covered===30&&verification.state==="一致";
 const fundVerified=verification.state==="一致"&&technical.covered>0;
 const normalizedFundScore=fundVerified&&Number.isFinite(technical.earned)?
  Math.round(technical.earned/30*10000)/100:null;
 const fundCoverage=Math.round(technical.covered/30*100);
 const score={score:normalizedFundScore,scoreModel:"etf_technical_30_normalized",
  observedPoints:technical.earned,coveredPoints:fundCoverage,
  coveragePercent:fundCoverage,
  complete:fundComplete,newsDelta:0,parts:{technical},
  indicators:scored.indicators,technicalMode:scored.technicalMode};
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
 const marketDate=clean.prices.at(-1)?.date;
 let newsResearch=null;
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
 const score=scoreStock({...clean,official,newsResearch,brokerTechnicalPrices});
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
  score,candles,newsResearch,datasetHealth,financialInsights,
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
// Free-plan homepage ranking: scan the whole official market once, then deeply
// analyze only a very small candidate set. This deliberately avoids D1 and background jobs.
async function analyzeRankingCandidate(candidate,env){
 if(!env.FINMIND_TOKEN)throw Error("FINMIND_TOKEN 尚未設定");
 const datasets=[
  ["TaiwanStockPrice",410],
  ["TaiwanStockMonthRevenue",520],
  ["TaiwanStockFinancialStatements",520],
  ["TaiwanStockInstitutionalInvestorsBuySell",35],
  ["TaiwanStockCashFlowsStatement",600],
  ["TaiwanStockBalanceSheet",240]
 ];
 const data=await Promise.allSettled(datasets.map(([name,days])=>finmind(env,candidate.stock,name,days)));
 if(data[0].status!=="fulfilled")return null;
 const rows=i=>data[i].status==="fulfilled"?data[i].value:[];
 const clean=normalize(rows(0),rows(1),rows(2),rows(3),[],rows(4),[],[],rows(5));
 // Reuse same-day official full-market valuation when available instead of another API call.
 if(candidate.screen&&(candidate.screen.per!==null||candidate.screen.pbr!==null||candidate.screen.dividendYield!==null)){
  clean.valuation=[{date:candidate.screen.date||candidate.date,per:candidate.screen.per??null,
   pbr:candidate.screen.pbr??null,dividendYield:candidate.screen.dividendYield??null}];
 }
 if(!clean.prices.length)return null;
 const official={market:candidate.market,source:candidate.source,name:candidate.name,kind:"stock",
  close:candidate.close,date:candidate.date,url:candidate.url};
 const verification=reconcile(official,clean.prices);
 if(verification.state!=="一致")return null;
 const score=scoreStock({...clean,official,newsResearch:null});
 if(!Number.isFinite(score.score))return null;
 const fundamental=score.parts?.fundamental||{earned:0,covered:0,max:40};
 const technical=score.parts?.technical||{earned:0,covered:0,max:30};
 const chips=score.parts?.chips||{earned:0,covered:0,max:30};
 const items=fundamental.items||[];
 const metric=name=>items.find(x=>x.name===name)?.value??null;
 const eps=metric("EPS 與去年同季"),cash=metric("營業現金流（初步）"),
  leverage=metric("獲利品質與負債");
 return {stock:candidate.stock,name:candidate.name,market:candidate.market,kind:"stock",
  close:candidate.close,date:candidate.date,score:score.score,scoreModel:"company_40_30_30",
  newsDelta:0,coveredPoints:score.coveredPoints,
  parts:{fundamental:{earned:fundamental.earned,covered:fundamental.covered,max:40},
   technical:{earned:technical.earned,covered:technical.covered,max:30},
   chips:{earned:chips.earned,covered:chips.covered,max:30}},
  screening:{per:candidate.screen?.per??null,pbr:candidate.screen?.pbr??null,
   dividendYield:candidate.screen?.dividendYield??null},
  financials:{eps:eps?.eps??null,operatingCashFlow:cash,
   debtRatioPct:leverage?.debtRatioPct??null},
  detailVerified:true};
}

async function computeFreeMarketTopFive(env){
 if(!env.FINMIND_TOKEN)return {ready:false,stocks:[],analyzedCount:0,
  reason:"尚未設定 FINMIND_TOKEN，無法進行候選股深度評分。"};
 const universe=await scanOfficialUniverse({priceCeiling:500});
 const commonStocks=universe.stocks.filter(x=>x.kind==="stock"&&x.close>0&&x.close<=500);
 // Entire official market is screened first. Only six candidates are deep-analyzed
 // to stay within free Worker subrequest limits.
 const candidates=rankUniverseCandidates(commonStocks,"daily",6);
 const settled=await Promise.allSettled(candidates.map(x=>analyzeRankingCandidate(x,env)));
 const analyzed=settled.filter(x=>x.status==="fulfilled"&&x.value).map(x=>x.value);
 const stocks=analyzed.sort((a,b)=>b.score-a.score||
   b.coveredPoints-a.coveredPoints||a.stock.localeCompare(b.stock))
  .slice(0,5).map((x,i)=>({...x,rank:i+1}));
 const unavailable=[
  "沒有逐檔全市場執行融資餘額資料，因此籌碼面最多先由法人買賣超計分；缺少部分以 0 分處理並顯示涵蓋率。",
  "首頁不批次抓新聞與永豐 Shioaji，避免免費額度與券商連線限制；點入個股時仍可做更完整核對。",
  "這是『全市場官方初篩後的深度候選前五名』，不是把全市場約 2,300 檔全部跑完完整財報／技術／籌碼後的絕對排名。"
 ];
 return {ready:stocks.length>0,marketDate:universe.marketDate,asOf:new Date().toISOString(),
  stocks,analyzedCount:analyzed.length,
  universe:{total:universe.universeCount,eligible:commonStocks.length,
   screened:candidates.length,deepAnalyzed:analyzed.length,scannedAll:true},
  warnings:universe.warnings||[],unavailable,
  reason:stocks.length?
   "已從上市、上櫃官方全市場先做行情／估值初篩，再對候選股做 FinMind 深度評分。":
   "官方全市場已完成初篩，但候選股深度資料暫不足，尚無可核實排名。"};
}

// D1 data collection is scheduled, bounded, and tracked. Unconfigured databases do not
// trigger public GET writes or pretend to contain a full-market financial history.
async function performScheduled(){
 // Free-plan architecture is on-demand + cache only. No D1 and no background cron.
 return;
}

// Homepage lists only verified, fully covered results from the entire stored universe.
// Never use an unscored price/valuation prescreen as an apparent top-score recommendation.
async function computeDailyObservations(env){
 return computeFreeMarketTopFive(env);
}

export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==="/api/health")return reply({ok:true,finmindConfigured:!!env.FINMIND_TOKEN,
  rankingMode:"official_full_market_prescreen_plus_finmind_candidate_scoring",sinopacConfigured:sinopacReady(env),
  brokerAutomaticCheck:sinopacReady(env),brokerPublicAnalysisPermissionConfigured:
   env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true",
  version:"0.30.0",marketDBConfigured:false,databaseMode:"disabled_free_plan",time:new Date().toISOString()});
 if(url.pathname==="/api/search"){
  const q=(url.searchParams.get("q")||"").trim();
  if(!q||q.length>30)return reply({results:[]},200,90);
  try{
   let results=[];
   results=await searchOfficialCompanies(q);
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
   // D1 is intentionally disabled on the free-plan architecture.
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
  return reply({configured:true,databaseMode:"disabled_free_plan",d1:false,
   finmindConfigured:!!env.FINMIND_TOKEN,
   rankingMode:"official_full_market_prescreen_plus_finmind_candidate_scoring",
   note:"免費版不使用 D1；首頁以官方全市場初篩＋少量 FinMind 候選深度分析即時計算。"},200,300);
 }
 if(url.pathname==="/api/observations"||url.pathname==="/api/top5"){
  const cache=caches.default;
  const key=new Request(url.origin+"/api/observations?model=0.30.0");
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const body=await computeDailyObservations(env);
   const response=reply(body,200,1800);
   // Cache both ready and not-ready states so repeated homepage refreshes do not
   // rescan D1 while the research queue is still warming up.
   ctx.waitUntil(cache.put(key,response.clone()));
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
    if(false&&payload.kind!=="etf"&&hasMarketDB(env)){
     try{
      const company=await getSavedCompany(env.MARKET_DB,stock);
      if(company){
       const stored=await getSavedProfile(env.MARKET_DB,stock);
       // A current, same-session verified archive may restore a complete score when
       // one upstream feed is transiently unavailable during an individual revisit.
       // Never reuse an older session, unverified profile or unearned coverage.
       if(payload.score?.score===null&&stored?.marketDate===payload.finmind.date&&
          company.date===payload.finmind.date&&payload.verification?.state==="一致"&&
          stored.metrics?.verified===true&&stored.score?.scoreModelVersion==="chips_flow20_margin10_v1"&&
           stored.score?.coveragePercent===100&&
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
