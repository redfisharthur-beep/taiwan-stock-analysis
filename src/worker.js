import {mergeVerifiedResearch} from "./top-five.js";
import {tickerPattern,isETFCandidate} from "./instruments.js";
import {finmind,officialQuote,scanOfficialUniverse,searchOfficialCompanies,normalize,reconcile,rankUniverseCandidates} from "./providers.js";
import {scoreStock,indicators} from "./scoring.js";
import {researchNews} from "./news.js";
import {summarizeFinancialStatements} from "./fundamentals.js";
import {buildPeerComparison,buildOfficialIndustryComparison} from "./industry.js";
import {hasMarketDB,saveUniverse,getMarketSummary,getVerifiedTopFive,getMarketPage,searchSavedStocks,getSavedCompany,getSavedProfile,claimNextCompany,saveResearch,saveETFResearch,recordResearchFailure,getIndustryPeers} from "./market-db.js";
import {sinopacReady,privateBrokerHistory,reconcileBrokerHistory,compareRawTechnicalIndicators} from "./sinopac.js";
import {assessCandidateRisk,assessIndustryOutlook,calculateValueScore,calculateFinalResearchScore} from "./risk.js";
import {buildAIResearchAssessment} from "./ai-assessment.js";
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
async function analyze(stock,env,override=null){
 if(!env.FINMIND_TOKEN)return reply({error:"尚未在 Cloudflare 設定 FINMIND_TOKEN Secret。"},503);

 // Ultra-light core for free Cloudflare Worker: only price + valuation.
 // Financial statements, institutional flow, revenue, cash flow, balance sheet,
 // news, industry PR and broker verification are all separate endpoints.
 const datasets=[
  ["TaiwanStockPrice",120],
  ["TaiwanStockPER",45]
 ];
 const data=await Promise.allSettled(datasets.map(([name,days])=>finmind(env,stock,name,days)));
 const warnings=data.flatMap((r,i)=>r.status==="rejected"?
  [datasets[i][0]+"："+String(r.reason?.message||"取得失敗")]:[]);
 if(data[0].status==="rejected")return reply({error:"FinMind 歷史行情取得失敗，未產生核心分析。",warnings},503);

 const rows=i=>data[i].status==="fulfilled"?data[i].value:[];
 const clean=normalize(rows(0),[],[],[],rows(1),[],[],[],[]);
 if(!clean.prices.length)return reply({error:"查無此股票可用行情，未產生核心分析。",warnings},404);

 const officialResult=override?{quote:override,errors:[]}:await officialQuote(stock);
 const official=officialResult.quote;
 const verification=reconcile(official,clean.prices);
 const marketDate=clean.prices.at(-1)?.date;
 const score=scoreStock({...clean,official,newsResearch:null});
 if(verification.state!=="一致"||official?.date!==clean.prices.at(-1)?.date)score.score=null;

 const latest=clean.prices.at(-1);
 const candles=clean.prices.filter(p=>[p.open,p.high,p.low,p.close].every(x=>Number.isFinite(x)&&x>0)&&
  p.high>=Math.max(p.open,p.close,p.low)&&p.low<=Math.min(p.open,p.close,p.high)).slice(-120);
 const datasetHealth=datasets.map(([name],i)=>{
  const r=data[i],records=r.status==="fulfilled"?r.value:[];
  const dates=records.map(x=>String(x?.date||"")).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));
  return {name,status:r.status==="rejected"?"error":records.length?"ok":"empty",
   records:records.length,latestDate:dates.sort().at(-1)||null,
   message:r.status==="rejected"?String(r.reason?.message||"資料來源錯誤"):
    records.length?"已取得資料":"來源成功回應，但此股票／期間沒有資料"};
 });
 const links={twse:"https://www.twse.com.tw/",tpex:"https://www.tpex.org.tw/",mops:"https://mops.twse.com.tw/"};
 const responseBody={stock,kind:"stock",name:official?.name||"",market:official?.market||"尚未辨認",
  asOf:new Date().toISOString(),analysisStage:"core-lite",
  deferredSections:["financial-extra","chips","industry-comparison","news","broker-check"],
  finmind:{date:latest.date,close:latest.close},official,verification,score,candles,
  newsResearch:null,datasetHealth,financialInsights:{},
  brokerVerification:{state:"deferred",reason:"永豐交叉核對改為獨立延伸分析"},
  missingMetrics:Object.entries(score.parts).flatMap(([group,part])=>
   part.items.filter(item=>item.score===null).map(item=>({group,name:item.name,reason:item.note||"延伸資料尚未載入"}))),
  valuationLatest:clean.valuation.filter(v=>v.date<=marketDate)
   .sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null,
  industryComparison:{items:[],reason:"同業比較載入中"},
  sourceWarnings:[...warnings,...(official?[]:officialResult.errors)],links};
 responseBody.aiAssessment=buildAIResearchAssessment(responseBody);
 return reply(responseBody,200,600);
}

async function analyzeFinancialExtra(stock,env){
 if(!env.FINMIND_TOKEN)return reply({error:"FINMIND_TOKEN 未設定"},503);
 const datasets=[
  ["TaiwanStockFinancialStatements",900],
  ["TaiwanStockMonthRevenue",520],
  ["TaiwanStockCashFlowsStatement",600],
  ["TaiwanStockBalanceSheet",240]
 ];
 const data=await Promise.allSettled(datasets.map(([name,days])=>finmind(env,stock,name,days)));
 const rows=i=>data[i].status==="fulfilled"?data[i].value:[];
 const clean=normalize([],rows(1),rows(0),[],[],rows(2),[],[],rows(3));
 const financialInsights=summarizeFinancialStatements(clean);
 return reply({stock,financialInsights,
  datasetHealth:datasets.map(([name],i)=>({
   name,status:data[i].status==="rejected"?"error":rows(i).length?"ok":"empty",
   records:rows(i).length,
   message:data[i].status==="rejected"?String(data[i].reason?.message||"取得失敗"):""
  }))},200,900);
}

async function analyzeChipsExtra(stock,env){
  if(!env.FINMIND_TOKEN)return reply({error:"FINMIND_TOKEN 未設定"},503);
  try{
   const [pricesRaw,institutionalRaw]=await Promise.all([
    finmind(env,stock,"TaiwanStockPrice",45),
    finmind(env,stock,"TaiwanStockInstitutionalInvestorsBuySell",35)
   ]);
   const clean=normalize(pricesRaw,[],[],institutionalRaw,[],[],[],[],[]);
   const scored=scoreStock({...clean,newsResearch:null});
   return reply({stock,chips:scored.parts.chips,
    coverage:scored.parts.chips.covered},200,600);
  }catch(error){
   return reply({stock,chips:null,error:"法人籌碼延伸分析暫不可用"},200,300);
  }
}

async function analyzeIndustryExtra(stock){
 try{
  const official=await scanOfficialUniverse();
  return reply({stock,industryComparison:buildOfficialIndustryComparison(stock,official)},200,900);
 }catch(error){
  return reply({stock,industryComparison:{items:[],reason:"官方同業估值暫不可用，PR 待查"}},200,300);
 }
}

async function analyzeNewsExtra(stock,env){
 try{
  const officialResult=await officialQuote(stock),official=officialResult.quote;
  const marketDate=official?.date;
  const newsResearch=await researchNews(stock,marketDate,official?.market||"上市",env,
   undefined,official?.name||"");
  return reply({stock,newsResearch},200,600);
 }catch(error){
  return reply({stock,newsResearch:{status:"unverified",events:[],checked:[],
   warnings:["重大訊息核對暫未完成："+String(error.message||error)]}},200,300);
 }
}

async function analyzeBrokerExtra(stock,env){
 if(!sinopacReady(env))return reply({stock,brokerVerification:{state:"not_configured"}},200,600);
 try{
  const [officialResult,pricesRaw]=await Promise.all([
   officialQuote(stock),finmind(env,stock,"TaiwanStockPrice",120)
  ]);
  const official=officialResult.quote;
  const prices=normalize(pricesRaw,[],[],[],[],[],[],[],[]).prices;
  if(!official?.date)return reply({stock,brokerVerification:{state:"unavailable",reason:"官方日期不足"}},200,300);
  const broker=await Promise.race([
   privateBrokerHistory(stock,official.date,env),
   new Promise(resolve=>setTimeout(()=>resolve({status:"timeout"}),6000))
  ]);
  const brokerVerification=reconcileBrokerHistory(broker,official,prices);
  return reply({stock,brokerVerification},200,600);
 }catch(error){
  return reply({stock,brokerVerification:{state:"unavailable",
   reason:"永豐交叉核對暫不可用；不影響核心分析"}},200,300);
 }
}

// Free-plan homepage ranking: scan the whole official market once, then deeply
// analyze only a very small candidate set. This deliberately avoids D1 and background jobs.
function median(values){
 const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);
 if(!xs.length)return null;
 const m=Math.floor(xs.length/2);
 return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
}
function relativeUndervaluation(rows){
 const groups=new Map();
 for(const r of rows){
  const key=r.industry||r.market||"其他";
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(r);
 }
 return rows.map(r=>{
  const peers=groups.get(r.industry||r.market||"其他")||[];
  const per=Number.isFinite(r.screen?.per)&&r.screen.per>0?r.screen.per:null;
  const pbr=Number.isFinite(r.screen?.pbr)&&r.screen.pbr>0?r.screen.pbr:null;
  const dy=Number.isFinite(r.screen?.dividendYield)&&r.screen.dividendYield>=0?r.screen.dividendYield:null;
  const medPer=median(peers.map(x=>x.screen?.per).filter(x=>Number.isFinite(x)&&x>0));
  const medPbr=median(peers.map(x=>x.screen?.pbr).filter(x=>Number.isFinite(x)&&x>0));
  const medDy=median(peers.map(x=>x.screen?.dividendYield).filter(x=>Number.isFinite(x)&&x>=0));
  let points=0,known=0;
  if(per!==null&&medPer){known++;points+=per<=medPer*.7?4:per<=medPer*.85?3:per<=medPer?2:0}
  if(pbr!==null&&medPbr){known++;points+=pbr<=medPbr*.7?4:pbr<=medPbr*.85?3:pbr<=medPbr?2:0}
  if(dy!==null&&medDy!==null){known++;points+=dy>=medDy*1.3?3:dy>=medDy*1.1?2:dy>=medDy?1:0}
  return {...r,relativeValue:{points,known,peerCount:peers.length,
   industry:r.industry||null,industryMedianPER:medPer,industryMedianPBR:medPbr,
   industryMedianYield:medDy}};
 }).sort((a,b)=>b.relativeValue.points-a.relativeValue.points||
   b.screening.sortingPoints-a.screening.sortingPoints||
   (b.turnover||0)-(a.turnover||0));
}
function qualityProxy(rows){
 return rows.map(r=>{
  const per=r.screening?.per,pbr=r.screening?.pbr,dy=r.screening?.dividendYield;
  let score=0,known=0;
  if(Number.isFinite(per)&&per>0){known++;score+=per<=18?4:per<=25?3:per<=35?1:0}
  if(Number.isFinite(pbr)&&pbr>0){known++;score+=pbr<=1.8?4:pbr<=2.5?2:0}
  if(Number.isFinite(dy)&&dy>=0){known++;score+=dy>=3?1:0}
  if((r.screening?.ratioCoverage||0)===3)score+=2;
  return {...r,qualityProxy:{score,known,positiveEarnings:Number.isFinite(per)&&per>0}};
 }).sort((a,b)=>b.qualityProxy.score-a.qualityProxy.score||
   b.screening.ratioCoverage-a.screening.ratioCoverage||
   (b.relativeValue?.points||0)-(a.relativeValue?.points||0)||
   a.stock.localeCompare(b.stock));
}

function epsSnapshot(financials=[]){
 const rows=financials.filter(x=>String(x.type||"").toLowerCase()==="eps"&&Number.isFinite(Number(x.value)))
  .map(x=>({date:String(x.date||""),value:Number(x.value)}))
  .filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const latest=rows.at(-1)||null;
 const prior=latest?rows.find(x=>x.date===String(Number(latest.date.slice(0,4))-1)+latest.date.slice(4)):null;
 return {latest,prior};
}
function buildRecommendationConfidence({candidate,prices=[],financials=[],institutional=[],verification,score}={}){
 const checks=[];
 const add=(key,ok,points)=>checks.push({key,ok:!!ok,points:ok?points:0,max:points});
 const per=candidate?.screen?.per,pbr=candidate?.screen?.pbr;
 const eps=epsSnapshot(financials);
 const instDates=new Set(institutional.map(x=>x.date).filter(Boolean));
 add("officialPER",Number.isFinite(per)&&per>0,10);
 add("officialPBR",Number.isFinite(pbr)&&pbr>0,10);
 add("priceHistory",prices.length>=61,20);
 add("currentEPS",Number.isFinite(eps.latest?.value)&&eps.latest.value>0,10);
 add("comparableEPS",Number.isFinite(eps.prior?.value),10);
 add("institutional5d",instDates.size>=5,15);
 add("financialStatement",financials.length>=10,10);
 add("accountingQuality",!!score?.accountingRisk&&financials.length>=10,5);
 add("sameDayVerification",verification?.state==="一致",10);
 const scorePct=checks.reduce((sum,x)=>sum+x.points,0);
 return {score:scorePct,checks,eps,minimumRequired:{
  per:Number.isFinite(per)&&per>0,pbr:Number.isFinite(pbr)&&pbr>0,
  priceHistory:prices.length>=61,positiveEPS:Number.isFinite(eps.latest?.value)&&eps.latest.value>0,
  institutional5d:instDates.size>=5,accountingQuality:!!score?.accountingRisk&&financials.length>=10,
  sameDayVerification:verification?.state==="一致"
 }};
}
function minimumRecommendationGate(row){
 const min=row.recommendationConfidence?.minimumRequired||{};
 const outlook=row.risk?.industryOutlook||{};
 const threshold=outlook.recognitionSensitive?75:60;
 return !row.risk?.excluded&&
  Object.values(min).every(Boolean)&&
  (row.recommendationConfidence?.score||0)>=threshold;
}
function valuationForCandidate(candidate){
 return candidate.screen&&(candidate.screen.per!==null||candidate.screen.pbr!==null||candidate.screen.dividendYield!==null)?
  [{date:candidate.screen.date||candidate.date,per:candidate.screen.per??null,
    pbr:candidate.screen.pbr??null,dividendYield:candidate.screen.dividendYield??null}]:[];
}
function verifyCandidate(candidate,prices){
 const official={market:candidate.market,source:candidate.source,name:candidate.name,kind:"stock",
  close:candidate.close,date:candidate.date,url:candidate.url};
 let verification=reconcile(official,prices);
 if(verification.state!=="一致"){
  const latest=prices.at(-1);
  const lag=latest?.date&&official.date?
   Math.round((Date.parse(official.date+"T00:00:00Z")-Date.parse(latest.date+"T00:00:00Z"))/86400000):null;
  if(Number.isFinite(lag)&&lag>=0&&lag<=3)
   verification={state:"近期資料",note:"FinMind 最新交易日較官方資料略晚更新。",
    date:latest.date,officialDate:official.date,finmindClose:latest.close,officialClose:official.close};
 }
 return {official,verification};
}
async function priceStageCandidate(candidate,env){
 try{
  const raw=await finmind(env,candidate.stock,"TaiwanStockPrice",410);
  const prices=normalize(raw,[],[],[],[],[],[],[],[]).prices;
  if(prices.length<20)return null;
  const {official,verification}=verifyCandidate(candidate,prices);
  const risk=assessCandidateRisk({industry:candidate.industry,prices,financials:[],institutional:[],
   screening:{per:candidate.screen?.per??null,pbr:candidate.screen?.pbr??null,
    dividendYield:candidate.screen?.dividendYield??null}});
  return {...candidate,_prices:prices,_official:official,_verification:verification,_riskPrice:risk};
 }catch{return null}
}
async function financialStageCandidate(row,env){
 try{
  const raw=await finmind(env,row.stock,"TaiwanStockFinancialStatements",900);
  const financials=normalize([],[],raw,[],[],[],[],[],[]).financials;
  const valuation=valuationForCandidate(row);
  const risk=assessCandidateRisk({industry:row.industry,prices:row._prices,financials,institutional:[],
   screening:{per:row.screen?.per??null,pbr:row.screen?.pbr??null,
    dividendYield:row.screen?.dividendYield??null}});
  const score=scoreStock({prices:row._prices,financials,valuation,official:row._official});
  const valueScore=calculateValueScore({
   compositeScore:score.score,relativePoints:row.relativeValue?.points||0,
   qualityPoints:row.qualityProxy?.score||0,risk,
   componentScores:{fundamental:score.parts?.fundamental?.earned||0,
    technical:score.parts?.technical?.earned||0,chips:score.parts?.chips?.earned||0},
   accountingPenalty:score.accountingRiskPenalty||0
  });
  return {...row,_financials:financials,risk,score,valueScore};
 }catch{return null}
}
async function institutionalStageCandidate(row,env){
 try{
  const raw=await finmind(env,row.stock,"TaiwanStockInstitutionalInvestorsBuySell",35);
  const institutional=normalize([],[],[],raw,[],[],[],[],[]).institutional;
  const valuation=valuationForCandidate(row);
  const risk=assessCandidateRisk({industry:row.industry,prices:row._prices,
   financials:row._financials,institutional,
   screening:{per:row.screen?.per??null,pbr:row.screen?.pbr??null,
    dividendYield:row.screen?.dividendYield??null}});
  const score=scoreStock({prices:row._prices,financials:row._financials,institutional,
   valuation,official:row._official});
  const valueScore=calculateValueScore({
   compositeScore:score.score,relativePoints:row.relativeValue?.points||0,
   qualityPoints:row.qualityProxy?.score||0,risk,
   componentScores:{fundamental:score.parts?.fundamental?.earned||0,
    technical:score.parts?.technical?.earned||0,chips:score.parts?.chips?.earned||0},
   accountingPenalty:score.accountingRiskPenalty||0
  });
  const recommendationConfidence=buildRecommendationConfidence({
   candidate:row,prices:row._prices,financials:row._financials,
   institutional,verification:row._verification,score
  });
  const finalResearchScore=calculateFinalResearchScore({
   valueScore,confidence:recommendationConfidence.score,risk
  });
  const fundamental=score.parts?.fundamental||{earned:0,covered:0,max:40};
  const technical=score.parts?.technical||{earned:0,covered:0,max:30};
  const chips=score.parts?.chips||{earned:0,covered:0,max:30};
  const epsItem=fundamental.items?.find(x=>x.name==="EPS 與去年同季");
  const result={...row,score:score.score,scoreModel:"value_research_confidence_v2",
   newsDelta:0,coveredPoints:score.coveredPoints,
   parts:{fundamental:{earned:fundamental.earned,covered:fundamental.covered,max:40},
    technical:{earned:technical.earned,covered:technical.covered,max:30},
    chips:{earned:chips.earned,covered:chips.covered,max:30}},
   screening:{per:row.screen?.per??null,pbr:row.screen?.pbr??null,
    dividendYield:row.screen?.dividendYield??null},
   financials:{eps:epsItem?.value?.eps??null,operatingCashFlow:null,debtRatioPct:null},
   accountingRisk:score.accountingRisk||null,risk,valueScore,
   recommendationConfidence,finalResearchScore,_institutional:institutional};
  result.recommendationEligible=minimumRecommendationGate(result);
  return result;
 }catch{return null}
}
async function brokerVerifyFinal(row,env){
 if(!row||!sinopacReady(env)||row._verification?.state!=="一致")
  return {...row,brokerVerification:{state:sinopacReady(env)?"not_checked":"not_configured"}};
 try{
  const broker=await Promise.race([
   privateBrokerHistory(row.stock,row._official.date,env),
   new Promise(resolve=>setTimeout(()=>resolve({status:"timeout"}),6000))
  ]);
  return {...row,brokerVerification:reconcileBrokerHistory(broker,row._official,row._prices)};
 }catch{
  return {...row,brokerVerification:{state:"unavailable",reason:"永豐交叉驗證暫不可用，不影響排名"}};
 }
}

async function mapWithConcurrency(items,limit,fn){
 const out=new Array(items.length);
 let next=0;
 async function worker(){
  while(true){
   const i=next++;
   if(i>=items.length)break;
   try{out[i]=await fn(items[i],i)}catch{out[i]=null}
  }
 }
 await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
 return out;
}
function stripInternal(row){
 const out={};
 for(const [k,v] of Object.entries(row||{}))if(!k.startsWith("_"))out[k]=v;
 return out;
}
function officialReferenceCandidate(candidate){
 const quality=Math.max(0,Math.min(11,candidate.qualityProxy?.score||0));
 const relative=Math.max(0,Math.min(11,candidate.relativeValue?.points||0));
 const valueScore=Math.round((quality/11*45+relative/11*55)*100)/100;
 return {
  stock:candidate.stock,name:candidate.name,market:candidate.market,kind:"stock",
  close:candidate.close,date:candidate.date,industry:candidate.industry,
  score:null,valueScore,finalResearchScore:valueScore*.45,
  recommendationConfidence:{score:45,checks:[],minimumRequired:{}},
  recommendationEligible:false,scoreModel:"official_value_prescreen",
  coveredPoints:Math.round((candidate.screening?.ratioCoverage||0)/3*45),
  parts:{fundamental:{earned:null,covered:0,max:40},
   technical:{earned:null,covered:0,max:30},
   chips:{earned:null,covered:0,max:30}},
  screening:{per:candidate.screen?.per??null,pbr:candidate.screen?.pbr??null,
   dividendYield:candidate.screen?.dividendYield??null},
  financials:{eps:null,operatingCashFlow:null,debtRatioPct:null},
  relativeValue:candidate.relativeValue||null,qualityProxy:candidate.qualityProxy||null,
  risk:{industryOutlook:assessIndustryOutlook(candidate.industry)},
  referenceCandidate:true,verificationLabel:"待深度驗證"
 };
}

async function computeFreeMarketTopFive(env){
 const universe=await scanOfficialUniverse();
 const commonStocks=universe.stocks.filter(x=>x.kind==="stock"&&x.close>0);
 // Liquidity is only an eligibility floor, never a ranking bonus.
 const liquidStocks=commonStocks.filter(x=>Number.isFinite(x.turnover)&&x.turnover>=10000000);
 // Financial companies are withheld only because the generic corporate model is invalid for them.
 const modelEligible=liquidStocks.filter(x=>!assessIndustryOutlook(x.industry).modelUnsupported);

 // 1) Full official market -> broad valuation pool -> 100 candidates after
 // industry outlook adjustment. Industry is a penalty/bonus, never a permanent delete.
 const broad300=rankUniverseCandidates(modelEligible,"daily",300);
 const cheap100=broad300.map(x=>{
  const outlook=assessIndustryOutlook(x.industry);
  return {...x,industryOutlook:outlook,
   initialResearchPoints:(x.screening?.sortingPoints||0)-(outlook.penalty||0)/2+(outlook.bonus||0)};
 }).sort((a,b)=>b.initialResearchPoints-a.initialResearchPoints||
   b.screening.ratioCoverage-a.screening.ratioCoverage||
   a.stock.localeCompare(b.stock)).slice(0,100);

 // 2) Official completeness/profitability proxy -> 40.
 const quality40=qualityProxy(cheap100).slice(0,40);

 // 3) Same-industry relative valuation -> 30.
 const relative30=relativeUndervaluation(quality40).slice(0,30);

 // 4) Expand deep candidate pool to 20; price history checks abnormal trading before financial calls.
 const deep20=relative30.sort((a,b)=>
   (b.relativeValue?.points||0)-(a.relativeValue?.points||0)||
   (b.qualityProxy?.score||0)-(a.qualityProxy?.score||0)||
   (b.screening?.sortingPoints||0)-(a.screening?.sortingPoints||0)
  ).slice(0,20);

 if(!env.FINMIND_TOKEN){
  const stocks=deep20.slice(0,5).map(officialReferenceCandidate).map((x,i)=>({...x,rank:i+1}));
  return {ready:stocks.length>0,marketDate:universe.marketDate,asOf:new Date().toISOString(),
   stocks,reason:stocks.length<5?"官方市場可用候選不足 5 檔。":"",
   funnel:{official:commonStocks.length,liquid:liquidStocks.length,cheap:cheap100.length,
    quality:quality40.length,relativeValue:relative30.length,deepCandidates:deep20.length,shown:stocks.length},
   warnings:universe.warnings||[],unavailable:["FinMind 未設定，僅顯示官方估值候選；不視為完整推薦。"]};
 }

 const price20=(await mapWithConcurrency(deep20,4,x=>priceStageCandidate(x,env))).filter(Boolean);
 const priceRanked=price20.filter(x=>x._riskPrice?.abnormalTrading?.score<60)
  .sort((a,b)=>
   (b.relativeValue?.points||0)-(a.relativeValue?.points||0)||
   (b.qualityProxy?.score||0)-(a.qualityProxy?.score||0)||
   (a._riskPrice?.abnormalTrading?.score||0)-(b._riskPrice?.abnormalTrading?.score||0));

 // 5) Only the best 10 consume a financial-statement request.
 const financial10=(await mapWithConcurrency(priceRanked.slice(0,10),3,x=>financialStageCandidate(x,env)))
  .filter(Boolean)
  .sort((a,b)=>b.valueScore-a.valueScore||
   (a.risk?.valueTrap?.score||0)-(b.risk?.valueTrap?.score||0));

 // 6) The best 7 consume institutional-flow requests; this keeps the free Worker under its request budget.
 const institutional7=(await mapWithConcurrency(financial10.slice(0,7),2,x=>institutionalStageCandidate(x,env)))
  .filter(Boolean);
 const eligible=institutional7.filter(x=>x.recommendationEligible)
  .sort((a,b)=>b.finalResearchScore-a.finalResearchScore||
   b.recommendationConfidence.score-a.recommendationConfidence.score||
   b.valueScore-a.valueScore);

 // Always keep 5 research references, but candidates missing the minimum gate are clearly marked as backups.
 const used=new Set(eligible.map(x=>x.stock));
 const partial=institutional7.filter(x=>!used.has(x.stock))
  .sort((a,b)=>b.finalResearchScore-a.finalResearchScore||
   b.recommendationConfidence.score-a.recommendationConfidence.score);
 for(const x of partial)used.add(x.stock);
 const remaining=financial10.filter(x=>!used.has(x.stock)).map(x=>{
  const fallback=officialReferenceCandidate(x);
  return {...fallback,valueScore:x.valueScore||fallback.valueScore,
   finalResearchScore:(x.valueScore||fallback.valueScore)*.5,
   risk:x.risk||fallback.risk,referenceCandidate:true,verificationLabel:"資料門檻未完成"};
 });
 // The homepage must always show 5 research candidates when the official market
 // itself has at least five eligible securities. Deep verification changes rank/confidence,
 // but never suppresses the whole shortlist.
 const rankedPool=[...eligible,...partial,...remaining];
 const seen=new Set(rankedPool.map(x=>x.stock));

 // Backfill from the 20-price stage first.
 for(const x of priceRanked){
  if(seen.has(x.stock))continue;
  const fallback=officialReferenceCandidate(x);
  rankedPool.push({...fallback,
   risk:x._riskPrice||fallback.risk,
   finalResearchScore:fallback.valueScore*.45,
   verificationLabel:"已完成價格風險檢查，待財報／法人深度驗證"});
  seen.add(x.stock);
 }

 // If API depth was insufficient, backfill from official relative-value candidates.
 for(const x of deep20){
  if(seen.has(x.stock))continue;
  rankedPool.push(officialReferenceCandidate(x));
  seen.add(x.stock);
 }

 // Last-resort official-market backfill: never leave the homepage blank because
 // FinMind/Shioaji temporarily failed. These are clearly marked as reference candidates.
 if(rankedPool.length<5){
  for(const x of relative30){
   if(seen.has(x.stock))continue;
   rankedPool.push(officialReferenceCandidate(x));
   seen.add(x.stock);
   if(rankedPool.length>=5)break;
  }
 }
 if(rankedPool.length<5){
  for(const x of quality40){
   if(seen.has(x.stock))continue;
   rankedPool.push(officialReferenceCandidate(x));
   seen.add(x.stock);
   if(rankedPool.length>=5)break;
  }
 }
 if(rankedPool.length<5){
  for(const x of cheap100){
   if(seen.has(x.stock))continue;
   rankedPool.push(officialReferenceCandidate(x));
   seen.add(x.stock);
   if(rankedPool.length>=5)break;
  }
 }

 const preBroker=rankedPool.slice(0,5);
 const brokerChecked=await mapWithConcurrency(preBroker,2,x=>brokerVerifyFinal(x,env));
 const stocks=brokerChecked.map(stripInternal).map((x,i)=>({...x,rank:i+1}));

 const unavailable=[
  "首頁固定顯示 5 檔研究候選；深度資料完整者以研究分數排序，資料不足者保留為『候補研究』並顯示推薦可信度，不再因單一資料源失敗而整頁空白。",
  "正式推薦門檻仍要求官方 PE／PB、至少 61 筆歷史價、正 EPS、至少 5 個法人資料日、財報會計品質檢查，以及官方／FinMind 同日行情核對。",
  "一般企業的最終研究分數＝價值分數 × 推薦可信度 − 景氣循環／異常交易／Value Trap 風險；技術面在價值分數中的權重為 15%。",
  "金融業暫不進一般企業推薦排名；永豐 Shioaji 僅對最後 5 檔做交叉核對，不直接加分。"
 ];
 return {ready:stocks.length>0,marketDate:universe.marketDate,asOf:new Date().toISOString(),
  stocks,analyzedCount:institutional7.length,
  funnel:{official:commonStocks.length,liquid:liquidStocks.length,
   modelEligible:modelEligible.length,cheap:cheap100.length,quality:quality40.length,
   relativeValue:relative30.length,deepCandidates:deep20.length,priceChecked:price20.length,
   financialChecked:financial10.length,institutionalChecked:institutional7.length,
   recommendationEligible:eligible.length,shown:stocks.length},
  universe:{total:universe.universeCount,eligible:commonStocks.length,
   screened:cheap100.length,deepAnalyzed:institutional7.length,scannedAll:true},
  warnings:universe.warnings||[],unavailable,
  diagnostics:{deepCandidates:deep20.map(x=>x.stock),
   recommendationEligible:eligible.map(x=>x.stock),
   partialCandidates:partial.map(x=>x.stock),
   shown:stocks.map(x=>({stock:x.stock,eligible:!!x.recommendationEligible,
    referenceCandidate:!!x.referenceCandidate,confidence:x.recommendationConfidence?.score??null}))},
  reason:stocks.length?"":"官方市場目前無法取得可用研究候選。"};
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
  rankingMode:"full_market_100_40_30_20_10_7_5_confidence_funnel",sinopacConfigured:sinopacReady(env),
  brokerAutomaticCheck:sinopacReady(env),brokerPublicAnalysisPermissionConfigured:
   env.SJ_MARKET_DATA_REDISPLAY_APPROVED==="true",
  version:"0.51.0",marketDBConfigured:false,databaseMode:"disabled_free_plan",time:new Date().toISOString()});
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
   rankingMode:"full_market_100_40_30_20_10_7_5_confidence_funnel",
   note:"免費版不使用 D1；全市場先做官方估值與產業風險初篩，再分階段以 FinMind 深度驗證，最後以推薦可信度與風險調整研究分數。"},200,300);
 }
 if(url.pathname==="/api/observations"||url.pathname==="/api/top5"){
  const cache=caches.default;
  const key=new Request(url.origin+"/api/observations?model=0.51.0");
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
  const stock=(url.searchParams.get("stock")||"").trim().toUpperCase();
  if(!valid(stock))return reply({error:"請輸入有效的股票或 ETF 代號。"},400);
  const key=new Request(url.origin+"/api/analyze?stock="+stock+"&model=0.50.0"),cache=caches.default;
  const hit=await cache.match(key);if(hit)return hit;
  try{
   const res=isETFCandidate(stock)?await analyzeETF(stock,env):await analyze(stock,env);
   if(res.ok)ctx.waitUntil(cache.put(key,res.clone()));
   return res;
  }catch(err){
   return reply({error:"核心分析暫時失敗。",detail:String(err.message||err)},503);
  }
 }
 if(url.pathname==="/api/analyze-financial"){
  const stock=(url.searchParams.get("stock")||"").trim().toUpperCase();
  if(!valid(stock)||isETFCandidate(stock))return reply({error:"此端點僅適用一般公司股票。"},400);
  return analyzeFinancialExtra(stock,env);
 }
 if(url.pathname==="/api/analyze-chips"){
  const stock=(url.searchParams.get("stock")||"").trim().toUpperCase();
  if(!valid(stock)||isETFCandidate(stock))return reply({error:"此端點僅適用一般公司股票。"},400);
  return analyzeChipsExtra(stock,env);
 }
 if(url.pathname==="/api/analyze-industry"){
  const stock=(url.searchParams.get("stock")||"").trim().toUpperCase();
  if(!valid(stock)||isETFCandidate(stock))return reply({error:"此端點僅適用一般公司股票。"},400);
  return analyzeIndustryExtra(stock);
 }
 if(url.pathname==="/api/analyze-news"){
  const stock=(url.searchParams.get("stock")||"").trim().toUpperCase();
  if(!valid(stock)||isETFCandidate(stock))return reply({error:"此端點僅適用一般公司股票。"},400);
  return analyzeNewsExtra(stock,env);
 }
 if(url.pathname==="/api/analyze-broker"){
  const stock=(url.searchParams.get("stock")||"").trim().toUpperCase();
  if(!valid(stock)||isETFCandidate(stock))return reply({error:"此端點僅適用一般公司股票。"},400);
  return analyzeBrokerExtra(stock,env);
 }
 if(url.pathname.startsWith("/api/"))return reply({error:"找不到 API"},404);
 return env.ASSETS.fetch(request);
},
 async scheduled(controller,env,ctx){ctx.waitUntil(performScheduled(controller,env))}
};
