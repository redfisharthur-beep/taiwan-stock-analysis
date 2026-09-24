// Additional, non-scored fundamental indicators computed only from actually received FinMind statements.
// Missing or non-comparable fields remain null; cash-flow amounts can be year-to-date cumulative.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const aliases={
 revenue:["Revenue","OperatingRevenue","TotalRevenue"],
 grossProfit:["GrossProfit","GrossProfitLoss"],
 operatingIncome:["OperatingIncome","OperatingProfit","OperatingIncomeLoss"],
 netIncome:["NetIncome","NetIncomeLoss","ProfitLoss"],
 equity:["Equity","StockholdersEquity","TotalEquity"],
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
export function summarizeFinancialStatements({financials=[],balance=[],cashFlows=[],revenues=[]}={}){
 const incomeDate=latestQuarter(financials),balanceDate=latestQuarter(balance),
  cashDate=latestQuarter(cashFlows),revenueDate=latestQuarter(revenues);
 const fin=key=>series(financials,key,incomeDate),bal=key=>series(balance,key,balanceDate);
 const revenue=fin("revenue"),gross=fin("grossProfit"),operating=fin("operatingIncome"),
  net=fin("netIncome"),equity=bal("equity"),assets=bal("totalAssets"),liabilities=bal("totalLiabilities");
 const currentAssets=bal("currentAssets"),currentLiabilities=bal("currentLiabilities");
 const cash=cashFlows.find(x=>x.date===cashDate&&x.type==="CashFlowsFromOperatingActivities")?.value??null;
 const latest=revenues.find(x=>x.date===revenueDate),prior=latest&&revenues.find(x=>
  Number(x.revenue_year)===Number(latest.revenue_year)-1&&Number(x.revenue_month)===Number(latest.revenue_month));
 return {incomeDate,balanceDate,cashDate,revenueDate,
  revenue:finite(revenue)?revenue:null,grossProfit:finite(gross)?gross:null,
  operatingIncome:finite(operating)?operating:null,netIncome:finite(net)?net:null,
  grossMargin:ratio(gross,revenue),operatingMargin:ratio(operating,revenue),
  netMargin:ratio(net,revenue),quarterlyRoe:incomeDate===balanceDate?ratio(net,equity):null,
  currentRatio:ratio(currentAssets,currentLiabilities,1),
  debtRatio:ratio(liabilities,assets),operatingCashFlow:finite(cash)?cash:null,
  monthlyRevenueYoY:finite(latest?.revenue)&&finite(prior?.revenue)&&prior.revenue>0?
   round((latest.revenue/prior.revenue-1)*100):null,
  note:"ROE 為同報告期淨利／期末權益的簡化季度比率，非年化；現金流可能為年初至當季累計，須核對來源、合併口徑及期間；金融業指標另行解讀。"};
}
