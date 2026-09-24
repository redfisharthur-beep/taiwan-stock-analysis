// SQLite D1 storage; all statements use bound parameters. Missing binding stays read-only/fallback.
import {getHoldingRows} from "./holding.js";
const now=()=>new Date().toISOString();
const numeric=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
export const hasMarketDB=env=>!!env?.MARKET_DB?.prepare;
export async function runBatch(db,statements,size=60){
 for(let i=0;i<statements.length;i+=size)await db.batch(statements.slice(i,i+size));
}
export async function saveUniverse(db,universe){
 if(!universe?.allStocks?.length)throw Error("官方公司名冊尚未取得，不更新空白市場");
 const ts=now(),sql=`INSERT INTO companies
 (stock,name,market,industry,close,quote_date,turnover,volume,per,pbr,dividend_yield,valuation_date,last_scan_at)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(stock) DO UPDATE SET name=excluded.name,market=excluded.market,
 industry=excluded.industry,close=excluded.close,quote_date=excluded.quote_date,
 turnover=excluded.turnover,volume=excluded.volume,per=excluded.per,
 pbr=excluded.pbr,dividend_yield=excluded.dividend_yield,
 valuation_date=excluded.valuation_date,last_scan_at=excluded.last_scan_at`;
 const rows=universe.allStocks.map(r=>db.prepare(sql).bind(r.stock,r.name||r.stock,r.market,
  r.industry||null,numeric(r.close),r.date||null,numeric(r.turnover),numeric(r.volume),
  numeric(r.screen?.per),numeric(r.screen?.pbr),numeric(r.screen?.dividendYield),
  r.screen?.date||null,ts));
 await runBatch(db,rows);
 await db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES ('universe',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
  .bind(JSON.stringify({date:universe.marketDate,count:universe.universeCount,markets:universe.markets,
   warning:universe.warnings}),ts).run();
 return universe.universeCount;
}
// Counts are scoped to the latest successfully saved official two-market snapshot.
export async function getMarketSummary(db){
 const [company,profile,state]=await Promise.all([
  db.prepare(`SELECT COUNT(*) AS total,
   SUM(CASE WHEN close>0 AND quote_date IS NOT NULL THEN 1 ELSE 0 END) AS eligible,
   SUM(CASE WHEN close IS NULL OR close<=0 THEN 1 ELSE 0 END) AS noQuote,
   SUM(CASE WHEN industry='ETF' THEN 1 ELSE 0 END) AS etf,
   SUM(CASE WHEN last_attempt IS NOT NULL THEN 1 ELSE 0 END) AS attempted,
   SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS failed
   FROM companies WHERE last_scan_at=(SELECT MAX(last_scan_at) FROM companies)`).first(),
  db.prepare(`SELECT COUNT(p.stock) AS profiles,
   SUM(CASE WHEN p.financial_period IS NOT NULL THEN 1 ELSE 0 END) AS finance,
   SUM(CASE WHEN p.technical_date IS NOT NULL THEN 1 ELSE 0 END) AS technical,
   SUM(CASE WHEN p.chips_date IS NOT NULL THEN 1 ELSE 0 END) AS chips,
   SUM(CASE WHEN COALESCE(c.industry,'')!='ETF' AND p.market_date=c.quote_date AND json_extract(p.score_json,'$.coveragePercent')=100
     AND json_extract(p.score_json,'$.score') IS NOT NULL
     AND json_extract(p.metrics_json,'$.verified')=1 THEN 1 ELSE 0 END) AS fullCoverage,
   MAX(p.fetched_at) AS lastResearch
   FROM companies c JOIN market_profiles p ON p.stock=c.stock
   WHERE c.last_scan_at=(SELECT MAX(last_scan_at) FROM companies)`).first(),
  db.prepare("SELECT value,updated_at FROM sync_state WHERE key='universe'").first()]);
 let original=null;try{original=state?.value?JSON.parse(state.value):null}catch{}
 const total=company?.total||0,profiles=profile?.profiles||0;
 return {configured:true,total,eligible:company?.eligible||0,noQuote:company?.noQuote||0,
  etf:company?.etf||0,attempted:company?.attempted||0,failed:company?.failed||0,
  profiles,unprocessed:Math.max(0,total-profiles),fullCoverage:profile?.fullCoverage||0,
  finance:profile?.finance||0,technical:profile?.technical||0,
  chips:profile?.chips||0,lastResearch:profile?.lastResearch||null,
  marketDate:original?.date||null,markets:original?.markets||[],
  warnings:original?.warning||[],updatedAt:state?.updated_at||null,
  complete:!!total&&profiles===total,stockScope:"上市、上櫃公司及可辨認ETF"};
}
// Paginate on the server: never send thousands of company profiles in one response.
export async function getMarketPage(db,{market="all",query="",page=1,pageSize=30}={}){
 const filter=["上市","上櫃"].includes(market)?" AND c.market=?":
  market==="ETF"?" AND c.industry='ETF'":
  market==="股票"?" AND (c.industry IS NULL OR c.industry!='ETF')":"";
 const term=String(query||"").trim().slice(0,30);
 const search=term?" AND (c.stock LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')":"";
 const clause=` WHERE c.last_scan_at=(SELECT MAX(last_scan_at) FROM companies)${filter}${search}`;
 const args=(["上市","上櫃"].includes(market)?[market]:[]).concat(term?[
  "%"+term.replace(/[\\%_]/g,"\\$&")+"%",
  "%"+term.replace(/[\\%_]/g,"\\$&")+"%"]:[]);
 const size=Math.max(1,Math.min(50,Math.trunc(Number(pageSize))||30));
 const p=Math.max(1,Math.min(10000,Math.trunc(Number(page))||1));
 const total=(await db.prepare("SELECT COUNT(*) AS n FROM companies c"+clause).bind(...args).first())?.n||0;
 const result=await db.prepare(`SELECT c.stock,c.name,c.market,c.industry,c.close,c.quote_date AS quoteDate,
  c.last_profile_at AS analyzedAt,c.last_attempt AS attemptedAt,c.last_error AS error,
  p.market_date AS researchDate,p.score_json AS scoreJSON,p.metrics_json AS metricsJSON
  FROM companies c LEFT JOIN market_profiles p ON p.stock=c.stock
  ${clause}
  ORDER BY CASE WHEN c.market='上市' THEN 0 ELSE 1 END,c.stock
  LIMIT ? OFFSET ?`).bind(...args,size,(p-1)*size).all();
 return {total,page:p,pageSize:size,pages:Math.ceil(total/size),rows:(result.results||[]).map(r=>{
  let score=null,verified=false;try{score=r.scoreJSON?JSON.parse(r.scoreJSON):null}catch{}
  try{verified=!!(r.metricsJSON&&JSON.parse(r.metricsJSON)?.verified)}catch{}
  const covered=typeof score?.coveragePercent==="number"?score.coveragePercent:
   typeof score?.coveredPoints==="number"?score.coveredPoints:0;
  const isETF=r.industry==="ETF";
  return {stock:r.stock,name:r.name,market:r.market,kind:isETF?"etf":"stock",
   price:r.close,quoteDate:r.quoteDate,analyzedAt:r.analyzedAt,
   researchDate:r.researchDate,coverage:isETF?null:covered,
   score:!isETF&&verified&&covered===100&&r.researchDate===r.quoteDate?score?.score??null:null,
   technicalCoverage:isETF?score?.parts?.technical?.covered??0:null,
   status:r.error?"error":!r.analyzedAt?"pending":
    r.researchDate!==r.quoteDate?"stale":isETF?"analyzed":verified&&covered===100?"complete":"partial",
   error:r.error?String(r.error).slice(0,100):null};
 })};
}
export async function searchSavedStocks(db,query,limit=12){
 const q=String(query||"").trim().slice(0,30);
 if(!q)return [];
 const pattern="%"+q.replace(/[\\%_]/g,"\\$&")+"%";
 const result=await db.prepare(`SELECT stock,name,market,industry FROM companies
 WHERE stock LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
 ORDER BY CASE WHEN stock=? THEN 0 WHEN name=? THEN 1 WHEN stock LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END,stock LIMIT ?`)
 .bind(pattern,pattern,q,q,q+"%",Math.min(20,Math.max(1,limit))).all();
 return result.results||[];
}
export async function getSavedCompany(db,stock){
 return db.prepare("SELECT stock,name,market,industry,close,quote_date AS date,turnover,volume,per,pbr,dividend_yield AS dividendYield,valuation_date AS valuationDate FROM companies WHERE stock=?").bind(stock).first();
}
export async function getSavedProfile(db,stock){
 const r=await db.prepare("SELECT * FROM market_profiles WHERE stock=?").bind(stock).first();
 if(!r)return null;
 const parse=s=>{try{return JSON.parse(s)}catch{return null}};
 return {stock:r.stock,marketDate:r.market_date,financialPeriod:r.financial_period,
  technicalDate:r.technical_date,chipsDate:r.chips_date,fetchedAt:r.fetched_at,
  score:parse(r.score_json),metrics:parse(r.metrics_json),
  candles:parse(r.candles_json),datasetHealth:parse(r.dataset_health_json)};
}
// First pass covers every quoted security before retrying one failed ticker.
export async function claimNextCompany(db){
 const failureCooldown=new Date(Date.now()-6*3600000).toISOString();
 const refreshCooldown=new Date(Date.now()-20*3600000).toISOString();
 const claimed=await db.prepare(`UPDATE companies SET last_attempt=?
 WHERE stock=(SELECT stock FROM companies
  WHERE last_scan_at=(SELECT MAX(last_scan_at) FROM companies)
   AND close>0 AND quote_date IS NOT NULL
   AND ((last_attempt IS NULL)
    OR (last_profile_at IS NULL AND last_attempt<?)
    OR (last_profile_at IS NOT NULL AND last_attempt<? AND
      (last_error IS NOT NULL OR substr(last_profile_at,1,10)<quote_date))))
  ORDER BY CASE WHEN last_attempt IS NULL THEN 0
    WHEN last_profile_at IS NULL THEN 1 ELSE 2 END,
    COALESCE(last_profile_at,last_attempt,'') ASC,stock LIMIT 1)
 RETURNING stock,name,market,industry,close,quote_date AS date,turnover,volume,
 per,pbr,dividend_yield AS dividendYield,valuation_date AS valuationDate`)
 .bind(now(),failureCooldown,refreshCooldown).first();
 return claimed||null;
}
export async function saveResearch(db,company,clean,body){
 const ts=now(),s=body.score||{},date=body.finmind?.date||null;
 const fundamental=s.parts?.fundamental?.items||[],chips=s.parts?.chips?.items||[];
 const item=(rows,key)=>rows.find(x=>x.name===key)||null;
 const eps=item(fundamental,"EPS 與去年同季"),cash=item(fundamental,"營業現金流（初步）"),
  quality=item(fundamental,"獲利品質與負債"),revenue=item(fundamental,"單月營收年增率");
 const stats={marketDate:date,verified:body.verification?.state==="一致"&&body.official?.date===date,
  financialInsights:body.financialInsights||null,technicalDate:s.indicators?.date||null,
  incomeDate:body.financialInsights?.incomeDate||null,
  balanceDate:body.financialInsights?.balanceDate||null,
  grossMargin:body.financialInsights?.grossMargin??null,
  operatingMargin:body.financialInsights?.operatingMargin??null,
  netMargin:body.financialInsights?.netMargin??null,
  quarterlyRoe:body.financialInsights?.quarterlyRoe??null,
  currentRatio:body.financialInsights?.currentRatio??null,
  per:body.valuationLatest?.per??company.per??null,
  pbr:body.valuationLatest?.pbr??company.pbr??null,dividendYield:body.valuationLatest?.dividendYield??company.dividendYield??null,
  valuationDate:body.valuationLatest?.date??company.valuationDate??null,
  eps:eps?.value?.eps??null,epsYoY:eps?.value?.yoyPct??null,epsDate:eps?.date??null,
  cashFlow:cash?.value??null,cashDate:cash?.date??null,
  debtRatio:quality?.value?.debtRatioPct??null,cashConversion:quality?.value?.cashConversion??null,
  debtDate:quality?.date??null,revenueYoY:Number.parseFloat(revenue?.value)||
   (Number.parseFloat(revenue?.value)===0?0:null),revenueDate:revenue?.date??null,
  holderPct:body.holding?.share??null,holderDate:body.holding?.date??null,
  institutionalRatio:item(chips,"法人近五日淨買賣／成交量")?.value?.ratioPct??null,
  marginChange:item(chips,"融資餘額變化")?.value??null,
  technical:s.indicators||null,technicalMode:s.technicalMode||null};
 // Save statement source rows by dataset + report period; preserve actual dates and original fields.
 const statementSets=[["financial",clean.financials],["cashflow",clean.cashFlows],
  ["balance",clean.balance],["revenue",clean.revenues]];
 const statements=[];
 for(const [kind,rows] of statementSets){
  const groups=new Map();
  for(const row of rows||[]){
   if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.date||""))continue;
   if(!groups.has(row.date))groups.set(row.date,[]);
   groups.get(row.date).push(row);
  }
  const periods=[...groups.keys()].sort().slice(kind==="revenue"?-18:-9);
  for(const period of periods)statements.push(db.prepare(`INSERT INTO financial_reports
   (stock,dataset,report_period,rows_json,source,updated_at)
   VALUES (?,?,?,?,?,?) ON CONFLICT(stock,dataset,report_period) DO UPDATE SET
   rows_json=excluded.rows_json,source=excluded.source,updated_at=excluded.updated_at`)
   .bind(company.stock,kind,period,JSON.stringify(groups.get(period)),"FinMind",ts));
 }
 await runBatch(db,statements);
 const bars=(clean.prices||[]).slice(-130).filter(x=>x.date&&numeric(x.close)>0);
 await runBatch(db,bars.map(x=>db.prepare(`INSERT INTO market_bars
 (stock,date,open,high,low,close,volume,source)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(stock,date) DO UPDATE SET
 open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,
 volume=excluded.volume,source=excluded.source`)
 .bind(company.stock,x.date,numeric(x.open),numeric(x.high),numeric(x.low),
  numeric(x.close),numeric(x.volume),"FinMind")));
 const latestStmt=[eps?.date,cash?.date,quality?.date].filter(Boolean).sort().at(-1)||null;
 const technicalDate=s.indicators?.date||null;
 const chipsDate=stats.institutionalRatio!==null&&stats.marginChange!==null&&
  body.holding?.trend&&body.holding?.date?body.holding.date:null;
 await db.prepare(`INSERT INTO market_profiles
 (stock,market_date,financial_period,technical_date,chips_date,score_json,metrics_json,candles_json,dataset_health_json,fetched_at)
 VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stock) DO UPDATE SET
 market_date=excluded.market_date,financial_period=excluded.financial_period,
 technical_date=excluded.technical_date,chips_date=excluded.chips_date,
 score_json=excluded.score_json,metrics_json=excluded.metrics_json,
 candles_json=excluded.candles_json,dataset_health_json=excluded.dataset_health_json,fetched_at=excluded.fetched_at`)
 .bind(company.stock,date,latestStmt,technicalDate,chipsDate,JSON.stringify(s),
  JSON.stringify(stats),JSON.stringify(body.candles||[]),
  JSON.stringify(body.datasetHealth||[]),ts).run();
 await db.prepare("UPDATE companies SET last_profile_at=?,last_error=NULL WHERE stock=?")
  .bind(ts,company.stock).run();
 return {financialPeriod:latestStmt,technicalDate,chipsDate};
}
/** ETF archive stores fund price/technical information only, never issuer earnings. */
export async function saveETFResearch(db,company,body){
 if(!body||body.kind!=="etf"||body.stock!==company.stock)
  throw Error("ETF profile identity mismatch");
 const ts=now(),date=body.finmind?.date||null,technical=body.score?.parts?.technical||null;
 await db.prepare(`INSERT INTO market_profiles
 (stock,market_date,financial_period,technical_date,chips_date,score_json,metrics_json,candles_json,dataset_health_json,fetched_at)
 VALUES(?,?,NULL,?,NULL,?,?,?,?,?)
 ON CONFLICT(stock) DO UPDATE SET market_date=excluded.market_date,
 financial_period=NULL,technical_date=excluded.technical_date,chips_date=NULL,
 score_json=excluded.score_json,metrics_json=excluded.metrics_json,
 candles_json=excluded.candles_json,dataset_health_json=excluded.dataset_health_json,
 fetched_at=excluded.fetched_at`).bind(company.stock,date,
 body.score?.indicators?.date||null,JSON.stringify(body.score),
 JSON.stringify({kind:"etf",technicalDate:body.score?.indicators?.date||null,
  verified:body.verification?.state==="一致",quoteSource:body.official?.source||null}),
 JSON.stringify(body.candles||[]),JSON.stringify(body.datasetHealth||[]),ts).run();
 const bars=(body.candles||[]).filter(x=>x.date&&numeric(x.close)>0).slice(-120);
 await runBatch(db,bars.map(x=>db.prepare(`INSERT INTO market_bars
 (stock,date,open,high,low,close,volume,source) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(stock,date) DO UPDATE SET open=excluded.open,high=excluded.high,
 low=excluded.low,close=excluded.close,volume=excluded.volume,source=excluded.source`)
 .bind(company.stock,x.date,numeric(x.open),numeric(x.high),numeric(x.low),x.close,
  numeric(x.volume),"FinMind ETF historical quotes")));
 await db.prepare("UPDATE companies SET last_profile_at=?,last_error=NULL WHERE stock=?")
  .bind(ts,company.stock).run();
 return {technicalDate:body.score?.indicators?.date||null};
}
export async function recordResearchFailure(db,stock,message){
 await db.prepare("UPDATE companies SET last_error=? WHERE stock=?")
  .bind(String(message||"資料來源暫不可用").slice(0,240),stock).run();
}
export async function getIndustryPeers(db,company,period,limit=600){
 if(!company?.industry||!period)return [];
 const result=await db.prepare(`SELECT c.stock,c.market,c.industry,c.name,p.metrics_json,p.market_date
 FROM companies c JOIN market_profiles p ON p.stock=c.stock
 WHERE c.industry=? AND c.market=? AND p.financial_period IS NOT NULL AND
 json_extract(p.metrics_json,'$.verified')=1 AND
 p.market_date>=? ORDER BY c.stock LIMIT ?`)
 .bind(company.industry,company.market,new Date(Date.parse(period+"T00:00:00Z")-7*86400000).toISOString().slice(0,10),limit).all();
 return (result.results||[]).flatMap(x=>{try{return [{...x,marketDate:x.market_date,metrics:JSON.parse(x.metrics_json)}]}catch{return []}});
}
const weekDate=value=>{
 const digits=String(value??"").replace(/[^0-9]/g,"");
 return digits.length===8?digits.slice(0,4)+"-"+digits.slice(4,6)+"-"+digits.slice(6,8):
  digits.length===7?String(Number(digits.slice(0,3))+1911)+"-"+digits.slice(3,5)+"-"+digits.slice(5,7):null;
};
/** Three truly consecutive TDCC weeks are required; a lone week never earns a trend score. */
export function holdingFromWeeks(weeks,marketDate){
 const recent=[...weeks].filter(x=>x?.date&&x.date<=marketDate&&numeric(x.share)!==null&&x.share>=0&&x.share<=100)
  .sort((a,b)=>a.date.localeCompare(b.date));
 const latest=recent.at(-1);
 if(!latest)return null;
 const age=(Date.parse(marketDate+"T00:00:00Z")-Date.parse(latest.date+"T00:00:00Z"))/86400000;
 if(!Number.isFinite(age)||age<0||age>14)return null;
 let trend=null;
 if(recent.length>=3){
  const last=recent.slice(-3),intervals=last.slice(1).map((w,i)=>
   (Date.parse(w.date+"T00:00:00Z")-Date.parse(last[i].date+"T00:00:00Z"))/86400000);
  if(intervals.every(days=>days>=5&&days<=10)){
   const changes=last.slice(1).map((w,i)=>Math.round((w.share-last[i].share)*100)/100);
   trend={weeks:last,weeklyChanges:changes,changeTwoWeeks:Math.round((latest.share-last[0].share)*100)/100,
    risingWeeks:changes.filter(x=>x>0).length,fallingWeeks:changes.filter(x=>x<0).length};
  }
 }
 return {date:latest.date,share:latest.share,change:trend?.weeklyChanges.at(-1)??null,
  trend,previousDate:trend?.weeks.at(-2)?.date??null,source:"TDCC 集保戶股權分散表",
  sourceUrl:"https://openapi.tdcc.com.tw/v1/opendata/1-5",
  note:trend?"已核實同股票連續三週 400 張以上集保占比趨勢":
   "至少需三期連續有效週資料，單週占比不予趨勢計分"};
}
export async function syncHoldingSnapshots(db,marketDate){
 const rows=await getHoldingRows(),byStock=new Map(),ts=now();
 const companies=await db.prepare("SELECT stock FROM companies").all();
 const known=new Set((companies.results||[]).map(x=>x.stock));
 const cutoff=new Date(Date.parse(marketDate+"T00:00:00Z")-35*86400000).toISOString().slice(0,10);
 for(const row of rows){
  const stock=String(row["證券代號"]??row.stock_id??"").trim();
  const date=weekDate(row["資料日期"]??row.date);
  const level=Number(row["持股分級"]??row.HoldingSharesLevel);
  const rawPct=String(row["占集保庫存數比例%"]??row.percent??"").trim();
  const pct=rawPct===""||rawPct==="-"?NaN:Number(rawPct.replaceAll(",",""));
  if(!known.has(stock)||!date||date<cutoff||date>marketDate||
    !Number.isInteger(level)||level<12||level>15||!Number.isFinite(pct)||pct<0||pct>100)continue;
  if(!byStock.has(stock))byStock.set(stock,new Map());
  const weeks=byStock.get(stock);
  if(!weeks.has(date))weeks.set(date,new Map());
  const levels=weeks.get(date);
  // Duplicate tiers invalidate that week instead of double-counting.
  levels.set(level,levels.has(level)?null:pct);
 }
 const weekly=[],updatedStocks=new Set();
 for(const [stock,dates] of byStock){
  for(const [date,levels] of dates){
   if(levels.size!==4||[12,13,14,15].some(l=>typeof levels.get(l)!=="number"))continue;
   const share=[12,13,14,15].reduce((sum,l)=>sum+levels.get(l),0);
   if(share>100)continue;
   updatedStocks.add(stock);
   weekly.push(db.prepare(`INSERT INTO holder_weeks(stock,source_date,share_pct,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(stock,source_date) DO UPDATE SET
    share_pct=excluded.share_pct,updated_at=excluded.updated_at`)
    .bind(stock,date,Math.round(share*100)/100,ts));
  }
 }
 await runBatch(db,weekly);
 const result=await db.prepare(`SELECT stock,source_date,share_pct FROM (
  SELECT stock,source_date,share_pct,
   ROW_NUMBER() OVER(PARTITION BY stock ORDER BY source_date DESC) AS rn
  FROM holder_weeks WHERE source_date>=?) WHERE rn<=3 ORDER BY stock,source_date`)
  .bind(cutoff).all();
 const history=new Map();
 for(const r of result.results||[]){
  if(!history.has(r.stock))history.set(r.stock,[]);
  history.get(r.stock).push({date:r.source_date,share:r.share_pct});
 }
 const snapshots=[];
 for(const stock of updatedStocks){
  const h=holdingFromWeeks(history.get(stock)||[],marketDate);
  if(!h)continue;
  snapshots.push(db.prepare(`INSERT INTO holder_snapshots(stock,source_date,share_pct,trend_json,updated_at)
   VALUES(?,?,?,?,?) ON CONFLICT(stock) DO UPDATE SET
   source_date=excluded.source_date,share_pct=excluded.share_pct,trend_json=excluded.trend_json,updated_at=excluded.updated_at`)
   .bind(stock,h.date,h.share,JSON.stringify(h),ts));
 }
 await runBatch(db,snapshots);
 return snapshots.length;
}
export async function savedHolding(db,stock,marketDate=null){
 const r=await db.prepare("SELECT trend_json FROM holder_snapshots WHERE stock=?").bind(stock).first();
 try{
  const held=r?JSON.parse(r.trend_json):null;
  return held&&marketDate?holdingFromWeeks(held.trend?.weeks||[{date:held.date,share:held.share}],marketDate):held;
 }catch{return null}
}
