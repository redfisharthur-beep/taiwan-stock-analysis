// Additional, non-scored fundamental indicators computed only from actually received FinMind statements.
// Missing or non-comparable fields remain null; cash-flow amounts can be year-to-date cumulative.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const aliases={
 revenue:["Revenue","OperatingRevenue","TotalRevenue","RevenueFromContractsWithCustomers","OperatingRevenues"],
 grossProfit:["GrossProfit","GrossProfitLoss"],
 operatingIncome:["OperatingIncome","OperatingProfit","OperatingIncomeLoss"],
 netIncome:["NetIncome","NetIncomeLoss","ProfitLoss","NetIncomeLossAttributableToOwnersOfParent","ProfitLossAttributableToOwnersOfParent","ProfitLossFromContinuingOperations"],
 equity:["Equity","StockholdersEquity","TotalEquity","EquityAttributableToOwnersOfParent","StockholdersEquityAttributableToOwnersOfParent"],
 currentAssets:["CurrentAssets"],
 currentLiabilities:["CurrentLiabilities"],
 totalAssets:["Assets"],
 totalLiabilities:["Liabilities"]
};
const round=n=>Math.round(n*100)/100;
const series=(rows,type,date)=>rows.find(x=>x.date===date&&(aliases[type]||[]).some(key=>key.toLowerCase()===String(x.type||"").toLowerCase()))?.value??null;
const ratio=(a,b,multiplier=100)=>finite(a)&&finite(b)&&b>0?round(a/b*multiplier):null;
const latestQuarter=rows=>[...new Set(rows.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date||""))
 .map(x=>x.date))].sort().at(-1)||null;
// Select the newest actually comparable period, not a newer EPS-only statement date.
export function summarizeFinancialStatements({financials=[],balance=[],cashFlows=[],revenues=[]}={}){
 const incomeDates=[...new Set(financials.map(x=>x.date).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x||"")))].sort().reverse();
 const marginDate=incomeDates.find(d=>{
  const revenue=series(financials,"revenue",d);
  return finite(revenue)&&revenue>0&&finite(series(financials,"netIncome",d));
 })||null;
 const incomeDate=marginDate||latestQuarter(financials);
 const balanceDate=latestQuarter(balance),cashDate=latestQuarter(cashFlows),
  revenueDate=latestQuarter(revenues);
 const fin=(key,date=incomeDate)=>date?series(financials,key,date):null;
 const bal=(key,date=balanceDate)=>date?series(balance,key,date):null;
 const revenue=fin("revenue"),gross=fin("grossProfit"),operating=fin("operatingIncome"),
  net=fin("netIncome"),assets=bal("totalAssets"),liabilities=bal("totalLiabilities");
 const currentAssets=bal("currentAssets"),currentLiabilities=bal("currentLiabilities");
 const matchingEquity=bal("equity",incomeDate);
 const reportedNet=marginDate?fin("netIncome",marginDate):null;
 const cash=cashFlows.find(x=>x.date===cashDate&&x.type==="CashFlowsFromOperatingActivities")?.value??null;
 const latest=revenues.find(x=>x.date===revenueDate),prior=latest&&revenues.find(x=>
  Number(x.revenue_year)===Number(latest.revenue_year)-1&&Number(x.revenue_month)===Number(latest.revenue_month));
 return {incomeDate,balanceDate,cashDate,revenueDate,
  revenue:finite(revenue)?revenue:null,grossProfit:finite(gross)?gross:null,
  operatingIncome:finite(operating)?operating:null,netIncome:finite(net)?net:null,
  grossMargin:ratio(gross,revenue),operatingMargin:ratio(operating,revenue),
  netMargin:ratio(net,revenue),
  // A matching reporting date is required; a missing equity is not zero.
  quarterlyRoe:marginDate?ratio(reportedNet,matchingEquity):null,
  currentRatio:ratio(currentAssets,currentLiabilities,1),
  debtRatio:ratio(liabilities,assets),operatingCashFlow:finite(cash)?cash:null,
  monthlyRevenueYoY:finite(latest?.revenue)&&finite(prior?.revenue)&&prior.revenue>0?
   round((latest.revenue/prior.revenue-1)*100):null,
  missingReasons:{
   netMargin:!marginDate?"同一期營收與稅後淨利資料不足":null,
   quarterlyRoe:!marginDate?"同一期稅後淨利資料不足":
    !finite(matchingEquity)||matchingEquity<=0?"同一期權益資料不足":null
  },
  note:"淨利率採同一報表期間的營收與淨利；ROE僅在報表期間相同且權益為正時顯示，未證實單季口徑不推算成年化報酬。"};
}
