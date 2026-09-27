/**
 * Five comparable display positions, but not identical investment models:
 * companies use documented 40/30/30 comprehensive scores; ETFs use only
 * their applicable 30-point technical model, normalized to 100. Missing
 * indicators remain 0 points and coverage is shown separately.
 * A normalized ETF number is never misrepresented as issuer fundamentals.
 */
export function mergeVerifiedResearch({stocks=[],etfs=[]}={}){
 const verifiedStocks=stocks.filter(x=>x?.kind==="stock"&&Number.isFinite(x.score)&&
  x.coveredPoints>0&&x.scoreModel==="company_40_30_30");
 const verifiedETFs=etfs.filter(x=>x?.kind==="etf"&&
  x.technicalCoverage>0&&Number.isFinite(x.technicalScore)&&
  x.technicalScore>=0&&x.technicalScore<=30&&
  x.scoreModel==="etf_technical_30").map(x=>({
   ...x,score:Math.round(x.technicalScore/30*10000)/100,
   coveredPoints:Math.round(x.technicalCoverage/30*100),
   scoreModel:"etf_technical_30_normalized"
  }));
 return [...verifiedStocks,...verifiedETFs]
  .sort((a,b)=>b.score-a.score||a.stock.localeCompare(b.stock))
  .slice(0,5).map((x,i)=>({...x,rank:i+1}));
}
