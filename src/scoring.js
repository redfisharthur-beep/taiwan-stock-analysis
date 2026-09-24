// 固定權重：基本 50、消息 10、籌碼 20、技術 20；缺值不視為 0，不重新加權。
export const WEIGHTS={fundamental:50,news:10,chips:20,technical:20};
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
export const num=x=>{if(x===null||x===undefined||x===""||x==="--"||x==="-")return null;
 const n=Number(String(x).replaceAll(",","").trim());return Number.isFinite(n)?n:null};
const age=(now,date)=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(now||"")&&
 /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date||"")?
 Math.round((Date.parse(now+"T00:00:00Z")-Date.parse(date+"T00:00:00Z"))/86400000):null;
const fresh=(now,date,days)=>{const n=age(now,date);return n!==null&&n>=0&&n<=days};
const part=(name,max,score,value,date,source,note)=>({
 name,max,score:finite(score)?round(Math.max(0,Math.min(max,score))):null,
 value:value??null,date:date??null,source:source??null,note:note??""});
const recent=(rows,date,days)=>[...rows].filter(r=>r&&fresh(date,r.date,days))
 .sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null;
export function movingAvg(rows,n,key="close"){const a=rows.slice(-n).map(r=>num(r[key]));
 return a.length===n&&a.every(finite)?a.reduce((x,y)=>x+y,0)/n:null}
export function rsi(closes,n=14){if(closes.length<n+1)return null;let gain=0,loss=0;
 for(let i=closes.length-n;i<closes.length;i++){const diff=closes[i]-closes[i-1];
 gain+=Math.max(0,diff);loss+=Math.max(0,-diff)}
 return gain+loss===0?50:loss===0?100:100-100/(1+gain/loss)}
function ema(a,n){if(a.length<n)return [];let first=a.slice(0,n).reduce((x,y)=>x+y,0)/n;
 const out=[first],factor=2/(n+1);
 for(let i=n;i<a.length;i++)out.push(a[i]*factor+out.at(-1)*(1-factor));return out}
export function indicators(prices){
 const rows=[...prices].sort((a,b)=>a.date.localeCompare(b.date));
 if(rows.length<61||rows.some(r=>!finite(num(r.close))||num(r.close)<=0))return null;
 const close=rows.map(r=>num(r.close)),latest=rows.at(-1),ma20=movingAvg(rows,20),ma60=movingAvg(rows,60);
 const fast=ema(close,12),slow=ema(close,26),macd=slow.map((v,i)=>fast[i+14]-v);
 const signal=ema(macd,9),crossNow=macd.at(-1)-signal.at(-1),crossBefore=macd.at(-2)-signal.at(-2);
 const volumes=rows.slice(-21,-1).map(r=>num(r.volume));
 const ratio=volumes.length===20&&volumes.every(x=>x!==null&&x>=0)&&volumes.some(x=>x>0)&&num(latest.volume)!==null?
 num(latest.volume)/(volumes.reduce((a,b)=>a+b,0)/20):null;
 const returns=close.slice(-21).map((v,i,a)=>i?v/a[i-1]-1:null).slice(1);
 const mean=returns.reduce((a,b)=>a+b,0)/returns.length;
 const volatility=Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/returns.length)*Math.sqrt(252)*100;
 let peak=0,drawdown=0;
 for(const v of close.slice(-60)){peak=Math.max(peak,v);drawdown=Math.max(drawdown,(peak-v)/peak*100)}
 return {date:latest.date,close:close.at(-1),ma20:round(ma20),ma60:round(ma60),
  rsi:round(rsi(close)),macd:round(macd.at(-1)),signal:round(signal.at(-1)),
  macdCross:crossBefore<=0&&crossNow>0?"golden":crossBefore>=0&&crossNow<0?"death":"none",
  volumeRatio:ratio===null?null:round(ratio),volatility20:round(volatility),maxDrawdown60:round(drawdown)};
}
function quarterValue(rows,date,type){return rows.find(r=>r.date===date&&r.type===type)?.value??null}
function financialQuality(financials,cashFlows,balance,marketDate){
 const cash=recent(cashFlows.filter(r=>r.type==="CashFlowsFromOperatingActivities"&&finite(num(r.value))),
  marketDate,180);
 const liabilities=recent(balance.filter(r=>r.type==="Liabilities"&&num(r.value)>=0),marketDate,180);
 const assets=liabilities?balance.find(r=>r.date===liabilities.date&&r.type==="Assets"&&num(r.value)>0):null;
 const borrowRatio=assets&&liabilities?num(liabilities.value)/num(assets.value)*100:null;
 // Within the same cash-flow statement/reporting period, compare operating cash flow to pre-tax income.
 const beforeTax=cash?quarterValue(cashFlows,cash.date,"NetIncomeBeforeTax"):null;
 const conversion=cash&&num(beforeTax)>0?num(cash.value)/num(beforeTax):null;
 const valid=conversion!==null&&finite(borrowRatio)&&borrowRatio>=0&&borrowRatio<=100&&
   fresh(marketDate,liabilities.date,180);
 return {date:valid?cash.date:null,debtDate:valid?liabilities.date:null,
  debtRatio:valid?round(borrowRatio):null,cashConversion:valid?round(conversion):null,
  score:valid?Math.min(5,conversion>=1?5:conversion>=.7?4:conversion>=.4?2:0)+
   (borrowRatio<=30?5:borrowRatio<=50?4:borrowRatio<=70?2:0):null};
}
function institutionalRatio(institutional,prices,marketDate){
 const p=[...prices].filter(x=>x.date<=marketDate).sort((a,b)=>a.date.localeCompare(b.date)).slice(-5);
 if(p.length!==5||!fresh(marketDate,p.at(-1).date,4))return null;
 let net=0,total=0;
 for(const day of p){
  if(!(num(day.volume)>0))return null;
  const records=institutional.filter(r=>r.date===day.date&&num(r.buy)!==null&&num(r.sell)!==null);
  if(!records.length)return null;
  net+=records.reduce((sum,r)=>sum+num(r.buy)-num(r.sell),0);total+=num(day.volume);
 }
 if(total<=0)return null;
 return {date:p.at(-1).date,net:round(net),volume:round(total),ratio:round(net/total*100)};
}
export function scoreStock({
 prices=[],adjusted=[],revenues=[],financials=[],institutional=[],valuation=[],
 cashFlows=[],balance=[],margin=[],official=null,holding=null,newsResearch=null
}={}){
 const raw=[...prices].sort((a,b)=>a.date.localeCompare(b.date)),latest=raw.at(-1)||null;
 const date=latest?.date||null;
 // Never compare adjusted prices with official raw closing prices. Only use matching dates for technicals.
 const adj=[...adjusted].filter(r=>r.date<=date&&num(r.close)>0).sort((a,b)=>a.date.localeCompare(b.date));
 const rawDates=new Map(raw.map(p=>[p.date,p]));
 // Prefer the complete adjusted series if it is fresh. A delayed/limited adjusted dataset
 // must not suppress valid technical research derived from the separately verified raw OHLC.
 const aligned=adj.filter(r=>rawDates.has(r.date)).map(r=>({
   ...r,volume:rawDates.get(r.date).volume
 }));
 const cleanAdj=aligned.length>=61&&aligned.at(-1).date===date?aligned:null;
 const technicalMode=cleanAdj?"adjusted":raw.length>=61?"raw":"unavailable";
 const tech=technicalMode==="adjusted"?indicators(cleanAdj):
   technicalMode==="raw"?indicators(raw):null;
 const technicalSource=technicalMode==="adjusted"?"FinMind TaiwanStockPriceAdj":"FinMind TaiwanStockPrice";
 const lastRev=recent(revenues.filter(r=>num(r.revenue)>0),date,90);
 const yearAgo=lastRev&&revenues.find(r=>Number(r.revenue_year)===Number(lastRev.revenue_year)-1&&
  Number(r.revenue_month)===Number(lastRev.revenue_month));
 const yoy=lastRev&&num(yearAgo?.revenue)>0?(num(lastRev.revenue)/num(yearAgo.revenue)-1)*100:null;
 const epsRows=financials.filter(r=>String(r.type).toLowerCase()==="eps"&&finite(num(r.value)))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const eps=recent(epsRows,date,180),prevEps=eps&&epsRows.find(r=>r.date===String(Number(eps.date.slice(0,4))-1)+eps.date.slice(4));
 const epsValue=eps?num(eps.value):null;
 const epsGrowth=epsValue!==null&&num(prevEps?.value)>0?(epsValue/num(prevEps.value)-1)*100:null;
 const epsScore=epsValue===null?null:epsValue<=0?0:epsGrowth===null?null:epsGrowth>=20?10:epsGrowth>=0?8:4;
 const operating=recent(cashFlows.filter(r=>r.type==="CashFlowsFromOperatingActivities"&&finite(num(r.value))),date,180);
 const oldCash=operating&&cashFlows.find(r=>r.date===String(Number(operating.date.slice(0,4))-1)+operating.date.slice(4)&&
  r.type==="CashFlowsFromOperatingActivities");
 const cashValue=operating?num(operating.value):null;
 const cashScore=cashValue===null?null:cashValue<=0?1:num(oldCash?.value)>0&&cashValue>num(oldCash.value)?10:7;
 const quality=financialQuality(financials,cashFlows,balance,date);
 const perRows=[...valuation].filter(r=>num(r.per)>0&&r.date<=date&&fresh(date,r.date,410))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const currentPER=recent(perRows,date,10);
 // Relative valuation only against own 12-month distribution; no cross-industry score is inferred.
 const pastPER=perRows.filter(r=>r.date<=currentPER?.date&&fresh(currentPER.date,r.date,370));
 const perPercentile=currentPER&&pastPER.length>=60?
   round(pastPER.filter(r=>num(r.per)<=num(currentPER.per)).length/pastPER.length*100):null;
 const perScore=perPercentile===null?null:perPercentile<=20?10:perPercentile<=40?8:
  perPercentile<=60?6:perPercentile<=80?3:1;
 const flowStats=institutionalRatio(institutional,raw,date);
 const flowScore=flowStats===null?null:flowStats.ratio>=4?10:flowStats.ratio>=2?8:
  flowStats.ratio>0?6:flowStats.ratio===0?5:flowStats.ratio>=-2?3:1;
 const trend=holding?.trend;
 const holderScore=!trend?null:trend.risingWeeks===2&&trend.changeTwoWeeks>=1?5:
  trend.risingWeeks===2?4:trend.fallingWeeks===0?3:trend.changeTwoWeeks>=0?2:1;
 const margins=[...margin].filter(r=>finite(num(r.financing))&&finite(num(r.previousFinancing))&&fresh(date,r.date,10))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const marginLatest=margins.at(-1)||null,marginChange=marginLatest?
  num(marginLatest.financing)-num(marginLatest.previousFinancing):null;
 const marginPct=marginLatest&&num(marginLatest.previousFinancing)>0?
  marginChange/num(marginLatest.previousFinancing)*100:null;
 const marginScore=marginChange===null?null:marginChange<0?(marginPct!==null&&marginPct<=-2?5:4):
  marginChange===0?2:1;
 const matched=name=>newsResearch?.items?.find(x=>x.name===name)||null;
 const event=matched("重大公告與事件"),report=matched("獨立新聞來源");
 const fundamental=[
  part("單月營收年增率",10,yoy===null?null:yoy>=20?10:yoy>=10?8:yoy>=0?6:yoy>=-10?3:1,
   yoy===null?null:round(yoy)+"%",lastRev?.date,"FinMind","比較去年同月；逾90天不計分"),
  part("EPS 與去年同季",10,epsScore,eps?{eps:epsValue,yoyPct:epsGrowth===null?null:round(epsGrowth)}:null,
   eps?.date,"FinMind","以單季EPS及同季年增計分；配股／分割後歷史值可能不可比"),
  part("營業現金流（初步）",10,cashScore,cashValue,operating?.date,operating?"FinMind":null,
   "營業現金流正負及同年同期，單位為原始財報金額"),
  part("獲利品質與負債",10,quality.score,quality.score===null?null:
   {cashConversion:quality.cashConversion,debtRatioPct:quality.debtRatio},quality.date,
   quality.score===null?null:"FinMind","同一期現金流／稅前淨利比與負債／總資產；金融業應使用不同模型"),
  part("估值／本益比",10,perScore,currentPER?{per:num(currentPER.per),
    oneYearPercentile:perPercentile}:null,currentPER?.date,
   currentPER?"FinMind":null,"近12個月個股自身本益比分位；須至少60筆有效歷史，未作跨產業比較")
 ];
 const news=[
  part("重大公告與事件",5,event?.score??null,event?.value??null,event?.date,event?.source,
   event?.note||"尚無經跨來源確認的重大事件"),
  part("獨立新聞來源",3,report?.score??null,report?.value??null,report?.date,report?.source,
   report?.note||"原始獨立媒體事件尚未完成核實"),
  part("產業事件",2,null,null,null,null,"產業事件尚無可核實的資料")
 ];
 const chips=[
  part("法人近五日淨買賣／成交量",10,flowScore,flowStats?
   {netShares:flowStats.net,totalShares:flowStats.volume,ratioPct:flowStats.ratio}:null,
   flowStats?.date,flowStats?"FinMind":null,"同五個交易日法人買賣超占總成交股數比例；缺任一天資料即不計分"),
  part("400張以上持股三週趨勢",5,holderScore,trend?
   {holderPct:holding.share,weeklyChangesPct:trend.weeklyChanges,
    changeTwoWeeksPct:trend.changeTwoWeeks}:null,holding?.date,holding?.source,
   holding?.note||"需TDCC三期連續週資料；單次高持股不給分"),
  part("融資餘額變化",5,marginScore,marginChange,marginLatest?.date,marginLatest?"FinMind":null,
   "單日融資餘額變化；不代表下一日股價方向")
 ];
 const techNote=technicalMode==="adjusted"?
  "採用已對齊交易日的還原收盤價；成交量來自同日原始行情":
  technicalMode==="raw"?
  "使用真實未還原日行情計算，可能受除權息、減資或股票分割影響；未冒充還原價":
  "原始與還原日行情均不足61筆，尚無法計算完整技術指標";
 const riskScore=tech?tech.volatility20<=25&&tech.maxDrawdown60<=10?5:
  tech.volatility20<=35&&tech.maxDrawdown60<=15?4:
  tech.volatility20<=45&&tech.maxDrawdown60<=22?3:1:null;
 const technical=[
  part("均線趨勢",6,tech===null?null:tech.close>tech.ma20&&tech.ma20>tech.ma60?6:tech.close>tech.ma20?4:1,
   tech?{close:tech.close,ma20:tech.ma20,ma60:tech.ma60}:null,tech?.date,tech?technicalSource:null,techNote),
  part("RSI(14)",3,tech===null?null:tech.rsi>=45&&tech.rsi<=65?3:
   tech.rsi>70||tech.rsi<30?1:2,tech?.rsi,tech?.date,tech?technicalSource:null,techNote),
  part("MACD",3,tech===null?null:tech.macd>tech.signal?3:1,
   tech?{macd:tech.macd,signal:tech.signal,cross:tech.macdCross}:null,tech?.date,tech?technicalSource:null,techNote),
  part("量價",3,tech?.volumeRatio===null||!tech?null:
   tech.volumeRatio>=1.2&&tech.close>tech.ma20?3:tech.volumeRatio<.5?1:2,
   tech?.volumeRatio,tech?.date,tech?technicalSource:null,techNote),
  part("波動幅度與60日最大回撤",5,riskScore,tech?
   {annualizedVolatility20Pct:tech.volatility20,maxDrawdown60Pct:tech.maxDrawdown60}:null,
   tech?.date,tech?technicalSource:null,
   tech?"20日報酬波動年化與60日歷史峰值回撤；僅風險觀察，不預測未來":techNote)
 ];
 const groups={fundamental,news,chips,technical};
 const parts=Object.fromEntries(Object.entries(groups).map(([key,items])=>
  [key,{max:WEIGHTS[key],earned:round(items.reduce((sum,i)=>sum+(i.score??0),0)),
   covered:items.reduce((sum,i)=>sum+(i.score===null?0:i.max),0),items}]));
 const coveredPoints=Object.values(parts).reduce((sum,p)=>sum+p.covered,0);
 const observedPoints=round(Object.values(parts).reduce((sum,p)=>sum+p.earned,0));
 return {score:coveredPoints===100?observedPoints:null,observedPoints,coveredPoints,
  coveragePercent:coveredPoints,complete:coveredPoints===100,parts,indicators:tech,
  latestPriceDate:date,technicalMode,
  metrics:{quality,perPercentile,per:currentPER?num(currentPER.per):null},
  diagnostics:{
    technical:{mode:technicalMode,rawCount:raw.length,rawDate:date,
      adjustedCount:adj.length,adjustedDate:adj.at(-1)?.date??null,
      alignedCount:aligned.length,reason:techNote}
  },
  disclaimer:"資料涵蓋率與實際得分分開；缺資料不補0分、不重新加權，分數不代表未來報酬。"};
}
