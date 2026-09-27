const finite=x=>typeof x==="number"&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
const norm=x=>String(x??"").replace(/\s+/g,"").toLowerCase();

const NET_INCOME_KEYS=[
 "incomeaftertaxes","netincome","netincomeloss","profitloss",
 "netincomelossattributabletoownersofparent","profitlossattributabletoownersofparent"
];
const EQUITY_METHOD_HINTS=[
 "shareofprofit","shareofloss","associates","jointventures","equitymethod",
 "權益法","關聯企業","合資損益"
];
const OCI_HINTS=[
 "othercomprehensiveincome","totalcomprehensiveincome","其他綜合損益","其他綜合利益"
];

const matchAny=(row,hints)=>{
 const text=norm(row?.type)+"|"+norm(row?.originName);
 return hints.some(x=>text.includes(norm(x)));
};
const netIncomeAt=(rows,date)=>{
 const hit=rows.find(r=>r.date===date&&NET_INCOME_KEYS.includes(norm(r.type)));
 return finite(hit?.value)?hit.value:null;
};
const latestDates=rows=>[...new Set(rows.map(x=>x.date).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x))))].sort();

export function assessAccountingRisk(financials=[]){
 const equityRows=financials.filter(r=>finite(r.value)&&matchAny(r,EQUITY_METHOD_HINTS));
 const ociRows=financials.filter(r=>finite(r.value)&&matchAny(r,OCI_HINTS)&&
  !norm(r.type).includes("totalcomprehensiveincome"));

 const eqDates=latestDates(equityRows);
 const eqDate=eqDates.at(-1)||null;
 const eqValue=eqDate?equityRows.filter(r=>r.date===eqDate).reduce((s,r)=>s+r.value,0):null;
 const eqNet=eqDate?netIncomeAt(financials,eqDate):null;
 const equityMethodRatioPct=finite(eqValue)&&finite(eqNet)&&Math.abs(eqNet)>0?
  Math.abs(eqValue)/Math.abs(eqNet)*100:null;

 let equityPenalty=0;
 if(equityMethodRatioPct!==null){
  if(equityMethodRatioPct>=70)equityPenalty=14;
  else if(equityMethodRatioPct>=50)equityPenalty=10;
  else if(equityMethodRatioPct>=30)equityPenalty=6;
  else if(equityMethodRatioPct>=15)equityPenalty=3;
 }

 const ociDates=latestDates(ociRows).slice(-6);
 const ociSeries=ociDates.map(date=>{
  const value=ociRows.filter(r=>r.date===date).reduce((s,r)=>s+r.value,0);
  const net=netIncomeAt(financials,date);
  return {date,value,ratioPct:finite(net)&&Math.abs(net)>0?value/Math.abs(net)*100:null};
 }).filter(x=>finite(x.ratioPct));
 let ociPenalty=0,ociVolatility=null,ociSignFlips=0;
 if(ociSeries.length>=2){
  const ratios=ociSeries.map(x=>x.ratioPct);
  const mean=ratios.reduce((a,b)=>a+b,0)/ratios.length;
  ociVolatility=Math.sqrt(ratios.reduce((s,x)=>s+(x-mean)**2,0)/ratios.length);
  for(let i=1;i<ratios.length;i++)if(Math.sign(ratios[i])!==0&&Math.sign(ratios[i-1])!==0&&
    Math.sign(ratios[i])!==Math.sign(ratios[i-1]))ociSignFlips++;
  const latestAbs=Math.abs(ratios.at(-1));
  if(ociVolatility>=100||latestAbs>=150)ociPenalty=8;
  else if(ociVolatility>=60||latestAbs>=100)ociPenalty=6;
  else if(ociVolatility>=30||latestAbs>=60)ociPenalty=3;
  if(ociSignFlips>=2)ociPenalty=Math.min(8,ociPenalty+2);
 }

 const penalty=Math.min(20,equityPenalty+ociPenalty);
 return {
  penalty,
  equityMethod:{date:eqDate,profit:eqValue,netIncome:eqNet,
   ratioPct:equityMethodRatioPct===null?null:round(equityMethodRatioPct),penalty:equityPenalty,
   level:equityPenalty>=10?"高":equityPenalty>=6?"中":equityPenalty>0?"低":"無明顯"},
  oci:{samples:ociSeries.length,latestDate:ociSeries.at(-1)?.date||null,
   latestRatioPct:ociSeries.length?round(ociSeries.at(-1).ratioPct):null,
   volatilityPct:ociVolatility===null?null:round(ociVolatility),
   signFlips:ociSignFlips,penalty:ociPenalty,
   level:ociPenalty>=6?"高":ociPenalty>=3?"中":ociPenalty>0?"低":"無明顯"},
  note:penalty?
   "已對權益法獲利依賴與其他綜合損益波動額外扣除風險分；此為會計品質風險指標，不代表獲利不實。":
   "目前資料未顯示足以扣分的權益法獲利依賴或 OCI 波動；缺值不視為零風險。"
 };
}
