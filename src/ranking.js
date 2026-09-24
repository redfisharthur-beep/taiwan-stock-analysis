// 資料庫中的實際查詢樣本；不可把樣本榜單當成全市場排名。
export function explainHighScore(item){
 const value=item.value;
 switch(item.name){
  case "單月營收年增率": return "同月份營收年增 "+value+"，達到此指標的評分門檻。";
  case "單季 EPS":return "最近一季每股盈餘 "+value+" 元，依設定的 EPS 分級獲分；尚未同業標準化。";
  case "近五交易日法人淨買賣":return "最近五個交易日法人合計淨買賣 "+value+" 股；須注意成交量、法人類別與買超持續性。";
  case "均線趨勢":return value&&typeof value==="object"?
    "收盤 "+value.close+" 元；20日均線 "+value.ma20+" 元；60日均線 "+value.ma60+" 元，依價格與均線排序獲分。":"";
  case "RSI(14)":return "RSI 為 "+value+"，依預設區間 45～65 取得此項評分；不代表未來必然上漲。";
  case "MACD":return value&&typeof value==="object"?
    "MACD "+value.macd+"、訊號線 "+value.signal+"，以兩線位置判定動能。":"";
  case "量價":return "今日成交量相對前20交易日均量為 "+value+" 倍，搭配當日收盤與均線位置評估。";
  case "估值／本益比":return "目前本益比 "+value+" 倍，依預設估值級距評分；須和同業及獲利品質共同檢視。";
  default:return item.note||"依預先設定的公開評分規則取得分數。";
 }
}
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
       .map(i=>({name:i.name,score:i.score,max:i.max,value:i.value,date:i.date,source:i.source,note:i.note,reason:explainHighScore(i)}))).slice(0,6)}))};
}
export async function readTopFive(db){
 if(!db)return {ready:false,reason:"尚未綁定 Cloudflare D1 資料庫（DB），無法保存每日榜單。",stocks:[]};
 try{
 const query=await db.prepare("SELECT payload FROM stock_snapshots WHERE market_date=(SELECT MAX(market_date) FROM stock_snapshots) ORDER BY updated_at DESC LIMIT 1500").all();
 const records=(query.results||[]).map(r=>{try{return JSON.parse(r.payload)}catch{return null}}).filter(Boolean);
 const marketDate=records.map(x=>x?.verification?.state==="一致"?x.finmind.date:"").sort().at(-1)||null;
 const data=selectDailyLeaders(records,{marketDate});
 return {ready:true,...data,reason:!data.stocks.length?"尚無同一交易日、同口徑且已驗證的可比較股票。":data.published?"已完成全市場正式排名。":"僅為已查詢且可比較的樣本觀察名單；非全市場前五，完整100分及全面掃描尚未完成。"};
 }catch(err){return {ready:false,reason:"排行榜資料庫尚未建立資料表或讀取異常："+String(err.message||err),stocks:[]}}
}
export async function saveSnapshot(db,record){
 if(!db||record.verification?.state!=="一致"||!record.finmind?.date||record.finmind.date!==record.official?.date)return false;
 await db.prepare("INSERT INTO stock_snapshots (stock,market_date,updated_at,payload) VALUES (?,?,?,?) ON CONFLICT(stock) DO UPDATE SET market_date=excluded.market_date,updated_at=excluded.updated_at,payload=excluded.payload")
  .bind(record.stock,record.finmind.date,new Date().toISOString(),JSON.stringify({...record,candles:[]})).run();
 return true;
}
