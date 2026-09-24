// Base coverage requires 40+30+30=100. Verified news is a signed bonus/penalty, never a coverage requirement.
export const WEIGHTS={fundamental:40,news:0,chips:30,technical:30};
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
export const num=x=>{if(x===null||x===undefined||x===""||x==="--"||x==="-")return null;
 const n=Number(String(x).replaceAll(",","").trim());return Number.isFinite(n)?n:null};
const age=(now,date)=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(now||"")&&
 /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date||"")?
 Math.round((Date.parse(now+"T00:00:00Z")-Date.parse(date+"T00:00:00Z"))/86400000):null;
const fresh=(now,date,days)=>{const n=age(now,date);return n!==null&&n>=0&&n<=days};
const part=(name,max,score,value,date,source,note)=>({
 name,max,score:finite(score)?(max===0?round(Math.max(-5,Math.min(5,score))):round(Math.max(0,Math.min(max,score)))):null,
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
const statementType=(row,types)=>types.some(x=>String(row.type||"").toLowerCase()===x.toLowerCase());
const latestValid=(rows,marketDate,days)=>recent(rows.filter(x=>finite(num(x.value))),marketDate,days);
function financialQuality(financials,cashFlows,balance,marketDate){
 const cash=latestValid(cashFlows.filter(x=>statementType(x,["CashFlowsFromOperatingActivities"])),marketDate,210);
 const liabilities=latestValid(balance.filter(x=>statementType(x,["Liabilities","TotalLiabilities","LiabilitiesTotal"])),marketDate,210);
 const assets=liabilities?balance.find(x=>x.date===liabilities.date&&statementType(x,["Assets","TotalAssets"])&&num(x.value)>0):null;
 const debtRatio=assets&&liabilities?num(liabilities.value)/num(assets.value)*100:null;
 // Both numerator and denominator must come from the SAME cash-flow reporting period.
 // A quarterly profit line cannot be divided into year-to-date operating cash flow.
 const beforeTax=cash?cashFlows.find(x=>x.date===cash.date&&statementType(x,["NetIncomeBeforeTax","ProfitLossBeforeTax"])&&finite(num(x.value))):null;
 const conversion=cash&&num(beforeTax?.value)>0?num(cash.value)/num(beforeTax.value):null;
 const valid=finite(conversion)&&finite(debtRatio)&&debtRatio>=0&&debtRatio<=100&&
  fresh(marketDate,liabilities.date,210)&&fresh(marketDate,cash.date,210);
 return {date:cash?.date??null,debtDate:liabilities?.date??null,
  debtRatio:finite(debtRatio)?round(debtRatio):null,
  cashConversion:finite(conversion)?round(conversion):null,
  score:valid?(conversion>=1?5:conversion>=.7?4:conversion>=.4?2:0)+
   (debtRatio<=30?5:debtRatio<=50?4:debtRatio<=70?2:0):null,
  note:!cash?"近期營業現金流缺漏":
   !beforeTax?"同一期現金流量表缺稅前淨利":
   !assets||!liabilities?"同一期資產負債表缺總資產或總負債":
   !valid?"財報報告期間過舊或數值不可比較":
   "現金流／稅前淨利為同一期累計口徑，負債比為報表期末比率"};
}
function institutionalRatio(institutional,prices,marketDate){
 const days=[...prices].filter(x=>x.date<=marketDate).sort((a,b)=>a.date.localeCompare(b.date));
 if(days.length<5)return null;
 // Institutional data updates later than close. Use the five latest CONSECUTIVE
 // trading sessions for which all institutional rows are actually published.
 // Permit two later price sessions only; never claim a delayed sample is current.
 const reported=new Set(institutional.filter(r=>r.date<=marketDate&&
  num(r.buy)!==null&&num(r.sell)!==null).map(r=>r.date));
 let latest=-1;
 for(let i=days.length-1;i>=0;i--){if(reported.has(days[i].date)){latest=i;break}}
 if(latest<4||days.length-1-latest>2)return null;
 const period=days.slice(latest-4,latest+1);
 if(!fresh(marketDate,period.at(-1).date,10))return null;
 let net=0,total=0;
 for(const day of period){
  if(!(num(day.volume)>0))return null;
  const records=institutional.filter(r=>r.date===day.date&&num(r.buy)!==null&&num(r.sell)!==null);
  if(!records.length)return null;
  const categories=records.map(r=>String(r.name||""));
  if(new Set(categories).size!==categories.length)return null;
  net+=records.reduce((sum,r)=>sum+num(r.buy)-num(r.sell),0);
  total+=num(day.volume);
 }
 return total>0?{date:period.at(-1).date,net:round(net),volume:round(total),
  ratio:round(net/total*100),tradingDates:period.map(x=>x.date),
  delayedTradingSessions:days.length-1-latest}:null;
}
export function scoreStock({
 prices=[],adjusted=[],revenues=[],financials=[],institutional=[],valuation=[],
 cashFlows=[],balance=[],margin=[],official=null,newsResearch=null,brokerTechnicalPrices=[]
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
 const brokerRows=[...brokerTechnicalPrices].sort((a,b)=>a.date.localeCompare(b.date));
 const validBroker=brokerRows.length>=61&&brokerRows.at(-1).date===date&&
   brokerRows.every(r=>num(r.close)>0&&r.volume===null);
 const technicalMode=cleanAdj?"adjusted":raw.length>=61?"raw":
   validBroker?"broker_raw":"unavailable";
 const tech=technicalMode==="adjusted"?indicators(cleanAdj):
   technicalMode==="raw"?indicators(raw):
   technicalMode==="broker_raw"?indicators(brokerRows):null;
 const technicalSource=technicalMode==="adjusted"?"FinMind TaiwanStockPriceAdj":
   technicalMode==="broker_raw"?"Sinopac Shioaji kbars（未還原；已核對）":"FinMind TaiwanStockPrice";
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
 const margins=[...margin].filter(r=>finite(num(r.financing))&&finite(num(r.previousFinancing))&&fresh(date,r.date,10))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const marginLatest=margins.at(-1)||null,marginChange=marginLatest?
  num(marginLatest.financing)-num(marginLatest.previousFinancing):null;
 const marginPct=marginLatest&&num(marginLatest.previousFinancing)>0?
  marginChange/num(marginLatest.previousFinancing)*100:null;
 const marginScore=marginChange===null?null:marginChange<0?(marginPct!==null&&marginPct<=-2?5:4):
  marginChange===0?2:1;
 const matched=name=>newsResearch?.items?.find(x=>x.name===name)||null;
 const event=matched("重大公告與事件"),report=matched("獨立新聞來源"),
  sector=matched("產業事件");
 const fundamental=[
  part("單月營收年增率",8,yoy===null?null:yoy>=20?8:yoy>=10?6:yoy>=0?5:yoy>=-10?2:1,
   yoy===null?null:round(yoy)+"%",lastRev?.date,"FinMind","比較去年同月；逾90天不計分"),
  part("EPS 與去年同季",8,epsScore===null?null:round(epsScore*.8),eps?{eps:epsValue,yoyPct:epsGrowth===null?null:round(epsGrowth)}:null,
   eps?.date,"FinMind","以單季EPS及同季年增計分；配股／分割後歷史值可能不可比"),
  part("營業現金流（初步）",8,cashScore===null?null:round(cashScore*.8),cashValue,operating?.date,operating?"FinMind":null,
   "營業現金流正負及同年同期，單位為原始財報金額"),
  part("獲利品質與負債",8,quality.score===null?null:round(quality.score*.8),
   quality.debtRatio===null&&quality.cashConversion===null?null:
    {cashConversion:quality.cashConversion,debtRatioPct:quality.debtRatio},
   quality.date,quality.debtRatio===null&&quality.cashConversion===null?null:"FinMind",
   quality.note+"；金融業需依其專用財務口徑解讀"),
  part("估值／本益比",8,perScore===null?null:round(perScore*.8),currentPER?{per:num(currentPER.per),
    oneYearPercentile:perPercentile}:null,currentPER?.date,
   currentPER?"FinMind":null,"近12個月個股自身本益比分位；須至少60筆有效歷史，未作跨產業比較")
 ];
 const newsEvents=(newsResearch?.events||[]).filter(e=>
  ["order_won","order_cancelled","adverse_litigation","financial_restatement"].includes(e.kind)&&
  ["official_only","independent_corrob"].includes(e.verification)&&e.date&&
  e.date<=date&&fresh(date,e.date,30));
 const newsLatest=[...newsEvents].sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
 const newsDelta=newsLatest?
  (newsLatest.kind==="order_won"?1:-1)*
  (newsLatest.verification==="independent_corrob"?5:2):0;
 // News score is signed. part() clamps 0..max, so it cannot encode deductions.
 const news=[{...part("消息事件調整",0,0,newsLatest?.title||"無已核實加減分事件",
  newsLatest?.date||null,newsLatest?.source||null,
  newsLatest?"已核實事件："+(newsDelta>0?"加分":"扣分"):"無已核實加減分事件"),score:newsDelta}];
 const chips=[
  part("法人近五日淨買賣／成交量",20,flowScore===null?null:round(flowScore*2),flowStats?
   {netShares:flowStats.net,totalShares:flowStats.volume,ratioPct:flowStats.ratio,
    tradingDates:flowStats.tradingDates,delayedSessions:flowStats.delayedTradingSessions}:null,
   flowStats?.date,flowStats?"FinMind":null,
   "以最近五個連續已公布法人資料的交易日計算；若成交行情較新最多容許兩個交易日落差，絕不補造未公告日期"),
  part("融資餘額變化",10,marginScore===null?null:round(marginScore*2),marginChange,marginLatest?.date,marginLatest?"FinMind":null,
   "單日融資餘額變化；不代表下一日股價方向")
 ];
 const techNote=technicalMode==="adjusted"?
  "採用已對齊交易日的還原收盤價；成交量來自同日原始行情":
  technicalMode==="raw"?
  "使用真實未還原日行情計算，可能受除權息、減資或股票分割影響；未冒充還原價":
  technicalMode==="broker_raw"?
  "FinMind歷史筆數不足；採同日核對的永豐完整分K彙整未還原日線。無已驗證成交量單位，量價項目待評；除權息可能影響指標":
  "原始、還原與可核對的永豐日行情均不足61筆，尚無法計算完整技術指標";
 const riskScore=tech?tech.volatility20<=25&&tech.maxDrawdown60<=10?5:
  tech.volatility20<=35&&tech.maxDrawdown60<=15?4:
  tech.volatility20<=45&&tech.maxDrawdown60<=22?3:1:null;
 const technical=[
  part("均線趨勢",9,tech===null?null:tech.close>tech.ma20&&tech.ma20>tech.ma60?9:tech.close>tech.ma20?6:1,
   tech?{close:tech.close,ma20:tech.ma20,ma60:tech.ma60}:null,tech?.date,tech?technicalSource:null,techNote),
  part("RSI(14)",5,tech===null?null:tech.rsi>=45&&tech.rsi<=65?5:
   tech.rsi>70||tech.rsi<30?1:3,tech?.rsi,tech?.date,tech?technicalSource:null,techNote),
  part("MACD",5,tech===null?null:tech.macd>tech.signal?5:2,
   tech?{macd:tech.macd,signal:tech.signal,cross:tech.macdCross}:null,tech?.date,tech?technicalSource:null,techNote),
  part("量價",5,tech?.volumeRatio===null||!tech?null:
   tech.volumeRatio>=1.2&&tech.close>tech.ma20?5:tech.volumeRatio<.5?1:3,
   tech?.volumeRatio,tech?.date,tech?technicalSource:null,techNote),
  part("波動幅度與60日最大回撤",6,riskScore===null?null:round(riskScore*1.2),tech?
   {annualizedVolatility20Pct:tech.volatility20,maxDrawdown60Pct:tech.maxDrawdown60}:null,
   tech?.date,tech?technicalSource:null,
   tech?"20日報酬波動年化與60日歷史峰值回撤；僅風險觀察，不預測未來。"+techNote:techNote)
 ];
 const groups={fundamental,news,chips,technical};
 const parts=Object.fromEntries(Object.entries(groups).map(([key,items])=>
  [key,{max:WEIGHTS[key],earned:round(items.reduce((sum,i)=>sum+(i.score??0),0)),
   covered:items.reduce((sum,i)=>sum+(i.score===null?0:i.max),0),items}]));
 const coreKeys=["fundamental","technical","chips"];
 const coveredPoints=coreKeys.reduce((sum,k)=>sum+parts[k].covered,0);
 const observedPoints=round(coreKeys.reduce((sum,k)=>sum+parts[k].earned,0));
 const complete=coveredPoints===100;
 // A verified news adjustment never fills missing fundamental/technical/chip coverage.
 // Clamp the final presentation to the standard 0–100 scale.
 const score=complete?round(Math.max(0,Math.min(100,observedPoints+newsDelta))):null;
 return {score,baseScore:complete?observedPoints:null,newsDelta,
  scoreModelVersion:"chips_flow20_margin10_v1",
  observedPoints,coveredPoints,
  coveragePercent:coveredPoints,complete,parts,indicators:tech,
  latestPriceDate:date,technicalMode,
  metrics:{quality,perPercentile,per:currentPER?num(currentPER.per):null},
  diagnostics:{
    technical:{mode:technicalMode,rawCount:raw.length,rawDate:date,
      adjustedCount:adj.length,adjustedDate:adj.at(-1)?.date??null,
      brokerCount:brokerRows.length,brokerDate:brokerRows.at(-1)?.date??null,
      alignedCount:aligned.length,reason:techNote}
  },
  disclaimer:"基本面40、技術30、籌碼30（法人20＋融資10）；適用資料齊全才顯示總分。消息僅依已核實公告加減，不補造缺值。"};
}
