// Potential valuation screens only; do not claim calculated intrinsic value or guaranteed undervaluation.
const f=x=>typeof x==="number"&&Number.isFinite(x);
const item=(r,name)=>r.score?.parts?.fundamental?.items?.find(x=>x.name===name);
export function valueWatchlist(records,{marketDate,candidateCount=0}={}){
 const rows=(records||[]).filter(r=>r.verification?.state==="一致"&&r.official?.date===marketDate&&
  r.finmind?.date===marketDate&&r.score&&r.stock);
 const examined=rows.map(r=>{
   const pe=item(r,"估值／本益比"),eps=item(r,"單季 EPS"),cash=item(r,"營業現金流（初步）"),
     revenue=item(r,"單月營收年增率");
   const latest=r.valuationLatest||null;
   // Value checklist: positive profitability, positive cash flow, at least two valuation observations.
   const reasons=[];let points=0;
   if(f(latest?.per)&&latest.per>0&&latest.per<=18){points+=latest.per<=12?30:20;reasons.push("本益比 "+latest.per+" 倍")}
   if(f(latest?.pbr)&&latest.pbr>0&&latest.pbr<=1.8){points+=latest.pbr<=1.2?25:15;reasons.push("股價淨值比 "+latest.pbr+" 倍")}
   if(f(latest?.dividendYield)&&latest.dividendYield>=3&&latest.dividendYield<=20){
    points+=latest.dividendYield>=4?15:10;reasons.push("殖利率 "+latest.dividendYield+"%")}
   const valuationSignals=reasons.length;
   if(f(eps?.value)&&eps.value>0){points+=15;reasons.push("EPS 為正")}
   if(f(cash?.value)&&cash.value>0){points+=10;reasons.push("營業現金流為正")}
   if(f(Number.parseFloat(revenue?.value))&&Number.parseFloat(revenue.value)>=0){points+=5;reasons.push("月營收年增非負")}
   if(valuationSignals<2||!(eps?.value>0)||!(cash?.value>0))return null;
   // Same data date + valuation thresholds: screen score NOT comprehensive 100-point investment score.
   return {stock:r.stock,name:r.name,market:r.market,date:marketDate,close:r.finmind.close,
     per:latest.per,pbr:latest.pbr,dividendYield:latest.dividendYield,
     valueChecklist:points,reason:reasons.slice(0,4),valuationDate:latest.date,
     confidence:"初步估值觀察，非內在價值估算；尚無同行比較和完整負債分析"};
 }).filter(Boolean);
 const order=examined.sort((a,b)=>b.valueChecklist-a.valueChecklist||a.stock.localeCompare(b.stock)).slice(0,5);
 return {ready:true,marketDate,candidateCount,validatedCount:rows.length,
  eligibleCount:examined.length,scope:"same_official_liquidity_sample",stocks:order.map((r,i)=>({...r,rank:i+1})),
  note:"僅對本次已評候選股做初步低估值篩選；不代表已算出內在價值或全市場最便宜五檔。"};
}
