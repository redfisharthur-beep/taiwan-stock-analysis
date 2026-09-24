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
