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

/**
 * 每日觀察名單內的「被低估」研究標記；只有同日可核對行情、個股自身
 * 歷史本益比分位、估值與實際財報同時具備時才顯示。沒有推算內在價值。
 * EPS 與現金流須來自各自最新有效報告期，後者通常為累計數，不冒充單季。
 */
export function assessUndervaluation(stock,detail,marketDate){
 const valuation=stock?.screening||{};
 const fundamental=detail?.score?.parts?.fundamental?.items||[];
 const item=name=>fundamental.find(x=>x.name===name);
 const eps=item("EPS 與去年同季"),cash=item("營業現金流（初步）"),quality=item("獲利品質與負債");
 const historical=detail?.score?.metrics?.perPercentile;
 const sameDate=detail?.verification?.state==="一致"&&
  detail?.official?.date===marketDate&&detail?.finmind?.date===marketDate;
 const financials=sameDate?{
  reportPeriod:/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(eps?.date||"")?
   eps.date.slice(0,4)+" Q"+Math.ceil(Number(eps.date.slice(5,7))/3):null,
  eps:typeof eps?.value?.eps==="number"?eps.value.eps:null,
  epsYoYPct:typeof eps?.value?.yoyPct==="number"?eps.value.yoyPct:null,
  epsDate:eps?.date||null,
  operatingCashFlow:typeof cash?.value==="number"?cash.value:null,
  cashFlowDate:cash?.date||null,
  debtRatioPct:typeof quality?.value?.debtRatioPct==="number"?quality.value.debtRatioPct:null,
  debtDate:quality?.date||null,
  cashConversion:typeof quality?.value?.cashConversion==="number"?quality.value.cashConversion:null
 }:null;
 const basic=valuation.per>0&&valuation.per<=18&&valuation.pbr>0&&valuation.pbr<=1.8;
 const financialOk=financials?.eps>0&&financials?.operatingCashFlow>0&&
  financials?.debtRatioPct>=0&&financials?.debtRatioPct<=70&&
  financials?.cashConversion>=0.7;
 const historicalOk=typeof historical==="number"&&Number.isFinite(historical)&&historical<=25;
 const undervalued=!!(sameDate&&basic&&financialOk&&historicalOk);
 const valuationNote=undervalued?"通過相對估值及財報初步檢查；不等於合理價或保證獲利。":
  !sameDate?"財報或同日歷史行情待核對，暫不標記被低估。":
  !basic?"本益比或淨值比未達相對估值門檻。":
  !historicalOk?"自身歷史本益比缺乏足夠樣本，或尚未落在較低區間。":
  !financialOk?"最新財報的 EPS、現金流或財務結構尚未符合條件。":
  "資料不足，暫不標記被低估。";
 return {valuationFlag:undervalued?"undervalued":"unconfirmed",
  valuationNote,financials,relativePerPercentile:typeof historical==="number"?historical:null};
}
