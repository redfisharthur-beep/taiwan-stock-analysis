// 觀察符合估值條件的候選：未建立合理價模型，不宣稱股票真正低估。
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const entry=(record,name)=>record.score?.parts?.fundamental?.items?.find(x=>x.name===name);
export function valueWatchlist(records,{marketDate,candidateCount=0}={}){
 const rows=(records||[]).filter(r=>r.verification?.state==="一致"&&
  r.official?.date===marketDate&&r.finmind?.date===marketDate&&r.score&&r.stock);
 const eligible=rows.map(r=>{
  const price=r.valuationLatest,metrics=r.score.metrics||{};
  const eps=entry(r,"EPS 與去年同季"),cash=entry(r,"營業現金流（初步）");
  const quality=entry(r,"獲利品質與負債"),revenue=entry(r,"單月營收年增率");
  if(!price||!finite(price.per)||price.per<=0||!finite(price.pbr)||price.pbr<=0||
    !finite(metrics.perPercentile)||metrics.perPercentile>60||!finite(eps?.value?.eps)||
    eps.value.eps<=0||!finite(cash?.value)||cash.value<=0||
    !finite(quality?.score)||quality.score<6||!finite(quality.value?.debtRatioPct)||
    quality.value.debtRatioPct>70)return null;
  const valuationSignals=[],reasons=[];
  let points=0;
  if(price.per<=18){points+=price.per<=12?25:15;valuationSignals.push("本益比 "+price.per+" 倍")}
  if(price.pbr<=1.8){points+=price.pbr<=1.2?20:12;valuationSignals.push("淨值比 "+price.pbr+" 倍")}
  if(finite(price.dividendYield)&&price.dividendYield>=3&&price.dividendYield<=20){
    points+=price.dividendYield>=4?10:6;valuationSignals.push("殖利率 "+price.dividendYield+"%")}
  if(valuationSignals.length<2)return null;
  points+=10+10+ (quality.score>=8?20:12);
  reasons.push(...valuationSignals.slice(0,2),"近一年本益比分位 "+metrics.perPercentile+"%",
   "EPS／營業現金流為正，負債比 "+quality.value.debtRatioPct+"%");
  const rev=Number.parseFloat(revenue?.value);
  if(finite(rev)&&rev>=0)points+=5;
  return {stock:r.stock,name:r.name,market:r.market,date:marketDate,close:r.finmind.close,
   per:price.per,pbr:price.pbr,dividendYield:price.dividendYield,
   valuationDate:price.date,valueChecklist:Math.min(100,points),reason:reasons,
   quality:{debtRatioPct:quality.value.debtRatioPct,
    cashConversion:quality.value.cashConversion,earningsDate:quality.date},
   confidence:"符合相對估值、正獲利、現金流和初步負債檢查；不是合理價或未來報酬預測"};
 }).filter(Boolean);
 const order=eligible.sort((a,b)=>b.valueChecklist-a.valueChecklist||a.stock.localeCompare(b.stock)).slice(0,5);
 return {ready:true,marketDate,candidateCount,validatedCount:rows.length,eligibleCount:eligible.length,
  scope:"preselected_value_sample",stocks:order.map((r,i)=>({...r,rank:i+1})),
  note:"初步價值篩選要求至少兩個估值訊號、相對本益比、正EPS與現金流、負債及現金獲利品質；不代表全市場低估排名。"};
}
