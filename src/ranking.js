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
 case "單月營收年增率":return "最近公布的單月營收年增率 "+v+"，符合此子項預設的成長區間。";
 case "單季 EPS":return "最近公布之單季每股盈餘 "+v+" 元，依預設 EPS 級距計分；尚未完成同產業校準。";
 case "近五交易日法人淨買賣":return "最近五交易日法人合計淨買賣 "+v+" 股；此數字尚未按流通股數標準化。";
 case "均線趨勢":return v&&typeof v==="object"?
  "收盤 "+v.close+" 元，20日均線 "+v.ma20+" 元，60日均線 "+v.ma60+" 元，依價格與均線位置計分。":"";
 case "RSI(14)":return "14日 RSI 為 "+v+"，依預設 RSI 區間計分。";
 case "MACD":return v&&typeof v==="object"?"MACD "+v.macd+"、訊號線 "+v.signal+"，依兩線關係計分。":"";
 case "量價":return "成交量為先前20交易日均量的 "+v+" 倍，搭配價格與均線評估。";
 case "估值／本益比":return "本益比 "+v+" 倍，依預設估值區間計分；跨產業不宜直接比較。";
 default:return item.note||"依預設研究規則計分。";
 }
}
export function selectDailyLeaders(records,{marketDate,candidateCount=0}={}){
 const valid=(Array.isArray(records)?records:[]).filter(r=>r&&r.verification?.state==="一致" &&
  r.finmind?.date===marketDate&&r.official?.date===marketDate&&
  r.score?.coveredPoints>0&&Number.isFinite(r.score.observedPoints)&&
  String(r.stock||"").length===4&&[...String(r.stock)].every(ch=>ch>="0"&&ch<="9")&&!(r.sourceWarnings||[]).length);
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
