// 資料庫中的實際查詢樣本；不可把樣本榜單當成全市場排名。
export function coverageSignature(score){
  if(!score?.parts)return "";
  return ["fundamental","news","chips","technical"].flatMap(key=>
    (score.parts[key]?.items||[]).filter(x=>x.score!==null).map(x=>key+":"+x.name)
  ).join("|");
}
export function selectDailyLeaders(records,{marketDate,universeSize=null,universeProcessed=null}={}){
 const rows=(Array.isArray(records)?records:[]).filter(r=>r&&r.verification?.state==="一致" &&
    r.finmind?.date===marketDate && r.official?.date===marketDate && r.score && r.score.coveredPoints>0 &&
    Number.isFinite(r.score.observedPoints) && r.stock && !r.sourceWarnings?.length);
 const groups=new Map();
 for(const r of rows){const sig=coverageSignature(r.score);if(!groups.has(sig))groups.set(sig,[]);groups.get(sig).push(r);}
 const cohort=[...groups.values()].sort((a,b)=>b.length-a.length||b[0]?.score.coveredPoints-a[0]?.score.coveredPoints)[0]||[];
 const fullyValidated=universeSize>0&&universeProcessed===universeSize&&
  rows.length>=5&&rows.every(x=>x.score.complete&&Number.isFinite(x.score.score));
 // 正式榜單必須全市場已處理且排名候選完整 100 分，不能由部分樣本冒充。
 const pool=fullyValidated?rows:cohort;
 const ranked=[...pool].sort((a,b)=>(fullyValidated?b.score.score-a.score.score:b.score.observedPoints-a.score.observedPoints)||
    a.stock.localeCompare(b.stock)).slice(0,5);
 return {marketDate:marketDate||null,scope:fullyValidated?"full_market":"verified_sample",published:fullyValidated&&ranked.length===5,
   universeSize,universeProcessed,analyzedCount:records?.length||0,verifiedComparableCount:pool.length,
   coveragePoints:fullyValidated?100:(cohort[0]?.score.coveredPoints??0),
   stocks:ranked.map((r,i)=>({rank:i+1,stock:r.stock,name:r.name,market:r.market,close:r.finmind.close,date:marketDate,
      score:fullyValidated?r.score.score:null,observedPoints:r.score.observedPoints,coveredPoints:r.score.coveredPoints,
      parts:Object.fromEntries(Object.entries(r.score.parts).map(([k,v])=>[k,{earned:v.earned,covered:v.covered,max:v.max}])),
      reasons:Object.values(r.score.parts).flatMap(p=>p.items.filter(i=>i.score!==null&&i.score>=i.max*0.7)
       .map(i=>({name:i.name,score:i.score,max:i.max,value:i.value,date:i.date,source:i.source,note:i.note}))).slice(0,6)}))};
}
export async function readTopFive(db){
 if(!db)return {ready:false,reason:"尚未綁定 Cloudflare D1 資料庫（DB），無法保存每日榜單。",stocks:[]};
 try{
 const query=await db.prepare("SELECT payload FROM stock_snapshots ORDER BY updated_at DESC LIMIT 5000").all();
 const records=(query.results||[]).map(r=>{try{return JSON.parse(r.payload)}catch{return null}}).filter(Boolean);
 const marketDate=records.map(x=>x?.verification?.state==="一致"?x.finmind.date:"").sort().at(-1)||null;
 const data=selectDailyLeaders(records,{marketDate});
 return {ready:true,...data,reason:!data.stocks.length?"尚無同一交易日、同口徑且已驗證的可比較股票。":data.published?"已完成全市場正式排名。":"僅為已查詢且可比較的樣本觀察名單；非全市場前五，完整100分及全面掃描尚未完成。"};
 }catch(err){return {ready:false,reason:"排行榜資料庫尚未建立資料表或讀取異常："+String(err.message||err),stocks:[]}}
}
export async function saveSnapshot(db,record){
 if(!db||record.verification?.state!=="一致"||!record.finmind?.date||record.finmind.date!==record.official?.date)return false;
 await db.prepare("INSERT INTO stock_snapshots (stock,market_date,updated_at,payload) VALUES (?,?,?,?) ON CONFLICT(stock) DO UPDATE SET market_date=excluded.market_date,updated_at=excluded.updated_at,payload=excluded.payload")
  .bind(record.stock,record.finmind.date,new Date().toISOString(),JSON.stringify(record)).run();
 return true;
}
