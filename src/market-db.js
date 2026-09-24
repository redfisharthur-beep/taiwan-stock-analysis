// SQLite D1 storage; all statements use bound parameters. Missing binding stays read-only/fallback.
import {concentration,getHoldingRows} from "./holding.js";
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
  r.screen?.date||r.date||null,ts));
 await runBatch(db,rows);
 await db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES ('universe',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
  .bind(JSON.stringify({date:universe.marketDate,count:universe.universeCount,markets:universe.markets,
   warning:universe.warnings}),ts).run();
 return universe.universeCount;
}
export async function getMarketSummary(db){
 const [company,profile,state]=await Promise.all([
  db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN quote_date=(SELECT MAX(quote_date) FROM companies) AND close<500 AND close>0 AND turnover>0 AND volume>0 THEN 1 ELSE 0 END) AS eligible FROM companies").first(),
  db.prepare("SELECT COUNT(*) AS profiles,SUM(CASE WHEN financial_period IS NOT NULL THEN 1 ELSE 0 END) AS finance,SUM(CASE WHEN technical_date IS NOT NULL THEN 1 ELSE 0 END) AS technical,SUM(CASE WHEN chips_date IS NOT NULL THEN 1 ELSE 0 END) AS chips,MAX(fetched_at) AS lastResearch FROM market_profiles").first(),
  db.prepare("SELECT value,updated_at FROM sync_state WHERE key='universe'").first()]);
 let original=null;try{original=state?.value?JSON.parse(state.value):null;}catch{}
 return {configured:true,total:company?.total||0,eligible:company?.eligible||0,
  profiles:profile?.profiles||0,finance:profile?.finance||0,technical:profile?.technical||0,
  chips:profile?.chips||0,lastResearch:profile?.lastResearch||null,
  marketDate:original?.date||null,markets:original?.markets||[],warnings:original?.warning||[],
  updatedAt:state?.updated_at||null,complete:!!original?.count&&profile?.profiles>=original.count};
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
export async function getDailySaved(db,limit=5){
 const date=(await db.prepare("SELECT MAX(quote_date) AS latest FROM companies").first())?.latest;
 if(!date)return {marketDate:null,stocks:[],source:"database"};
 const result=await db.prepare(`SELECT c.stock,c.name,c.market,c.industry,c.close,c.quote_date AS date,
 c.turnover,c.volume,c.per,c.pbr,c.dividend_yield AS dividendYield,c.valuation_date AS valuationDate,
 p.market_date AS profileDate,p.metrics_json,p.score_json,p.financial_period,p.technical_date,p.chips_date
 FROM companies c LEFT JOIN market_profiles p ON p.stock=c.stock
 WHERE c.quote_date=? AND c.close>0 AND c.close<500 AND c.turnover>0 AND c.volume>0
 ORDER BY (CASE WHEN c.per>0 AND c.per<=12 THEN 4 WHEN c.per>0 AND c.per<=18 THEN 3 WHEN c.per>0 AND c.per<=25 THEN 2 WHEN c.per>0 THEN 1 ELSE 0 END)
 +(CASE WHEN c.pbr>0 AND c.pbr<=1.2 THEN 4 WHEN c.pbr>0 AND c.pbr<=1.8 THEN 3 WHEN c.pbr>0 AND c.pbr<=2.5 THEN 2 WHEN c.pbr>0 THEN 1 ELSE 0 END)
 +(CASE WHEN c.dividend_yield>=4 AND c.dividend_yield<=20 THEN 3 WHEN c.dividend_yield>=3 AND c.dividend_yield<=20 THEN 2 WHEN c.dividend_yield>=0 AND c.dividend_yield<=20 THEN 1 ELSE 0 END) DESC,
 c.turnover DESC,c.stock LIMIT ?`).bind(date,limit).all();
 const rows=(result.results||[]).map(row=>{
  let metrics=null,score=null;try{metrics=JSON.parse(row.metrics_json)}catch{}try{score=JSON.parse(row.score_json)}catch{}
  return {...row,screen:{per:row.per,pbr:row.pbr,dividendYield:row.dividendYield,date:row.valuationDate},
   profile:row.profileDate===date?{metrics,score}:null};
 });
 return {marketDate:date,stocks:rows,source:"database"};
}
export async function claimNextCompany(db){
 const cutoff=new Date(Date.now()-30*60000).toISOString();
 const claimed=await db.prepare(`UPDATE companies SET last_attempt=?
 WHERE stock=(SELECT stock FROM companies WHERE close>0 AND quote_date IS NOT NULL
 AND (last_attempt IS NULL OR last_attempt<?)
 ORDER BY COALESCE(last_profile_at,'') ASC,COALESCE(last_attempt,'') ASC,stock LIMIT 1)
 RETURNING stock,name,market,industry,close,quote_date AS date,turnover,volume,per,pbr,dividend_yield AS dividendYield,valuation_date AS valuationDate`)
 .bind(now(),cutoff).first();
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
export async function recordResearchFailure(db,stock,message){
 await db.prepare("UPDATE companies SET last_error=? WHERE stock=?")
  .bind(String(message||"資料來源暫不可用").slice(0,240),stock).run();
}
export async function getIndustryPeers(db,company,period,limit=600){
 if(!company?.industry||!period)return [];
 const result=await db.prepare(`SELECT c.stock,c.market,c.industry,c.name,p.metrics_json,p.market_date
 FROM companies c JOIN market_profiles p ON p.stock=c.stock
 WHERE c.industry=? AND c.market=? AND p.financial_period IS NOT NULL AND
 p.market_date>=? ORDER BY c.stock LIMIT ?`)
 .bind(company.industry,company.market,new Date(Date.parse(period+"T00:00:00Z")-7*86400000).toISOString().slice(0,10),limit).all();
 return (result.results||[]).flatMap(x=>{try{return [{...x,marketDate:x.market_date,metrics:JSON.parse(x.metrics_json)}]}catch{return []}});
}
export async function syncHoldingSnapshots(db,marketDate){
 const rows=await getHoldingRows();
 const grouped=new Map();
 for(const row of rows){
  const stock=String(row["證券代號"]??row.stock_id??"").trim();
  if(!/^[0-9]{4}$/.test(stock))continue;
  if(!grouped.has(stock))grouped.set(stock,[]);
  grouped.get(stock).push(row);
 }
 const ts=now(),statements=[];
 for(const [stock,groups] of grouped){
  const h=concentration(groups,stock,marketDate);
  if(!h)continue;
  statements.push(db.prepare(`INSERT INTO holder_snapshots(stock,source_date,share_pct,trend_json,updated_at)
   VALUES(?,?,?,?,?) ON CONFLICT(stock) DO UPDATE SET
   source_date=excluded.source_date,share_pct=excluded.share_pct,trend_json=excluded.trend_json,updated_at=excluded.updated_at`)
   .bind(stock,h.date,h.share,JSON.stringify(h),ts));
 }
 await runBatch(db,statements);
 return statements.length;
}
export async function savedHolding(db,stock){
 const r=await db.prepare("SELECT trend_json FROM holder_snapshots WHERE stock=?").bind(stock).first();
 try{return r?JSON.parse(r.trend_json):null}catch{return null}
}
