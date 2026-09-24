// 即時計算的候選觀察名單：不使用 D1、不儲存任何歷史榜單。
const KEYS=["fundamental","news","chips","technical"];
export function coverageSignature(score){
 if(!score?.parts)return "";
 return KEYS.flatMap(key=>(score.parts[key]?.items||[]).filter(x=>x.score!==null)
   .map(x=>key+":"+x.name)).join("|");
}
export function explainHighScore(item){
 const v=item.value;
 switch(item.name){
 case "單月營收年增率":return "最新營收年增 "+v+"。";
 case "EPS 與去年同季":return v&&typeof v==="object"?
   "單季 EPS "+v.eps+" 元，同比 "+(v.yoyPct===null?"待核":v.yoyPct+"%")+"。":"";
 case "營業現金流（初步）":return "最近一期營業現金流 "+v+"（原始財報金額）。";
 case "獲利品質與負債":return v&&typeof v==="object"?
   "現金／稅前淨利 "+v.cashConversion+" 倍，負債比 "+v.debtRatioPct+"%。":"";
 case "估值／本益比":return v&&typeof v==="object"?
   "本益比 "+v.per+" 倍，近一年相對分位 "+v.oneYearPercentile+"%。":"";
 case "法人近五日淨買賣／成交量":return v&&typeof v==="object"?
   "法人五日淨買賣占同期間成交量 "+v.ratioPct+"%。":"";
 case "400張以上持股三週趨勢":return v&&typeof v==="object"?
   "集保400張以上占比 "+v.holderPct+"%，近兩週變化 "+v.changeTwoWeeksPct+" 個百分點。":"";
 case "融資餘額變化":return "最近融資餘額增減 "+v+"（原始資料單位）。";
 case "均線趨勢":return v&&typeof v==="object"?
   "還原收盤 "+v.close+"、20日均線 "+v.ma20+"、60日均線 "+v.ma60+"。":"";
 case "RSI(14)":return "RSI（還原價）"+v+"。";
 case "MACD":return v&&typeof v==="object"?"MACD "+v.macd+"，訊號線 "+v.signal+"。":"";
 case "量價":return "成交量相對前20日均量 "+v+" 倍。";
 case "波動幅度與60日最大回撤":return v&&typeof v==="object"?
   "近20日年化波動 "+v.annualizedVolatility20Pct+"%，60日最大回撤 "+v.maxDrawdown60Pct+"%。":"";
 default:return item.note||"依明列的子項標準計分。";
 }
}
export function selectDailyLeaders(records,{marketDate,candidateCount=0}={}){
 const valid=(Array.isArray(records)?records:[]).filter(r=>r&&r.verification?.state==="一致" &&
  r.finmind?.date===marketDate&&r.official?.date===marketDate&&
  r.score?.coveredPoints>0&&Number.isFinite(r.score.observedPoints)&&
  String(r.stock||"").length===4&&[...String(r.stock)].every(ch=>ch>="0"&&ch<="9"));
 const groups=new Map();
 for(const r of valid){const key=coverageSignature(r.score);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 // 權重覆蓋內容相同才可以比較；候選樣本不足五檔時，寧缺勿補。
 const cohort=[...groups.values()].sort((a,b)=>b.length-a.length ||
   (b[0]?.score.coveredPoints||0)-(a[0]?.score.coveredPoints||0) ||
   String(a[0]?.stock).localeCompare(String(b[0]?.stock)))[0]||[];
 const ranked=[...cohort].sort((a,b)=>b.score.observedPoints-a.score.observedPoints||
  a.stock.localeCompare(b.stock)).slice(0,5);
 return {marketDate:marketDate||null,scope:"official_liquidity_prescreen_sample",published:false,
  candidateCount,analyzedCount:records?.length||0,verifiedCount:valid.length,
  verifiedComparableCount:cohort.length,coveragePoints:cohort[0]?.score.coveredPoints??0,
  stocks:ranked.map((r,i)=>({rank:i+1,stock:r.stock,name:r.name,market:r.market,
   close:r.finmind.close,date:marketDate,score:null,observedPoints:r.score.observedPoints,
   coveredPoints:r.score.coveredPoints,parts:Object.fromEntries(Object.entries(r.score.parts)
    .map(([k,v])=>[k,{earned:v.earned,covered:v.covered,max:v.max}])),
   reasons:Object.values(r.score.parts).flatMap(p=>p.items
    .filter(item=>item.score!==null&&item.max>0&&item.score>=item.max*.7)
    .map(item=>({name:item.name,score:item.score,max:item.max,value:item.value,
     date:item.date,source:item.source,note:item.note,reason:explainHighScore(item)}))).slice(0,6)}))};
}
