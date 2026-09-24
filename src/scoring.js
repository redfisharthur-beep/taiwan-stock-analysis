// v0.2 研究型分數：缺資料不視為 0，也不將未涵蓋的項目重新加權。
export const WEIGHTS = { fundamental:50, news:10, chips:20, technical:20 };
const finite=x=>typeof x==="number"&&Number.isFinite(x);
export const num=x=>{ if(x===null||x===undefined||x===""||x==="--"||x==="-")return null; const n=Number(String(x).replaceAll(",","").trim());return Number.isFinite(n)?n:null };
const round=x=>Math.round(x*100)/100;
export function movingAvg(rows,n,key="close"){const a=rows.slice(-n).map(r=>num(r[key]));return a.length===n&&a.every(finite)?a.reduce((x,y)=>x+y,0)/n:null}
export function rsi(closes,period=14){if(closes.length<period+1)return null;let g=0,l=0;for(let i=closes.length-period;i<closes.length;i++){const d=closes[i]-closes[i-1];g+=Math.max(0,d);l+=Math.max(0,-d)} if(g+l===0)return 50;return l===0?100:100-100/(1+g/l)}
function ema(values,n){if(values.length<n)return [];let initial=values.slice(0,n).reduce((a,b)=>a+b,0)/n;const out=[initial],alpha=2/(n+1);for(let i=n;i<values.length;i++)out.push(values[i]*alpha+out.at(-1)*(1-alpha));return out}
export function indicators(prices){const rows=[...prices].sort((a,b)=>a.date.localeCompare(b.date));if(rows.length<60||rows.some(r=>!finite(num(r.close))||num(r.close)<=0))return null;const closes=rows.map(r=>num(r.close)),latest=rows.at(-1),ma20=movingAvg(rows,20),ma60=movingAvg(rows,60),rs=rsi(closes),fast=ema(closes,12),slow=ema(closes,26);const line=slow.map((v,i)=>fast[i+14]-v),signal=ema(line,9),prev=line.at(-2)-signal.at(-2),now=line.at(-1)-signal.at(-1),todayVol=num(latest.volume),averageVol=movingAvg(rows.slice(0,-1),20,"volume");return {date:latest.date,close:closes.at(-1),ma20:round(ma20),ma60:round(ma60),rsi:round(rs),macd:round(line.at(-1)),signal:round(signal.at(-1)),volumeRatio:averageVol>0&&todayVol!==null?round(todayVol/averageVol):null,macdCross:prev<=0&&now>0?"golden":prev>=0&&now<0?"death":"none"}}
const item=(name,max,score,value,date,source,note)=>({name,max,score:finite(score)?round(Math.max(0,Math.min(max,score))):null,value:value??null,date:date??null,source:source??null,note:note??""});
// 僅使用與行情時間相近且已發布的資料；過舊或不具可比性的數據不給覆蓋分。
const dayDiff=(a,b)=>a&&b&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(a)&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b)?
  Math.round((Date.parse(a+"T00:00:00Z")-Date.parse(b+"T00:00:00Z"))/86400000):null;
const fresh=(marketDate,dataDate,days)=>{const age=dayDiff(marketDate,dataDate);return age!==null&&age>=0&&age<=days};
export function scoreStock({prices=[],revenues=[],financials=[],institutional=[],official=null,valuation=[],cashFlows=[],margin=[],holding=null,newsResearch=null}){
 const tech=indicators(prices), latest=prices.at(-1)||null, lastRev=[...revenues].sort((a,b)=>a.date.localeCompare(b.date)).at(-1), earlier=lastRev&&revenues.find(r=>Number(r.revenue_year)===Number(lastRev.revenue_year)-1&&Number(r.revenue_month)===Number(lastRev.revenue_month));
 const yoy=lastRev&&earlier&&num(earlier.revenue)>0?((num(lastRev.revenue)/num(earlier.revenue))-1)*100:null;
 const epsRows=financials.filter(r=>String(r.type).toLowerCase()==="eps"&&finite(num(r.value))).sort((a,b)=>a.date.localeCompare(b.date));const eps=epsRows.at(-1)||null;
 const recent=[...institutional].filter(r=>r.date&&finite(num(r.buy))&&finite(num(r.sell))).sort((a,b)=>a.date.localeCompare(b.date)),dates=[...new Set(recent.map(r=>r.date))].slice(-5);
 const flows=dates.length>=5?recent.filter(r=>dates.includes(r.date)).reduce((sum,r)=>sum+(num(r.buy)-num(r.sell)),0):null;
 const marketDate=latest?.date??null;
 const valuations=[...valuation].filter(r=>num(r.per)>0&&fresh(marketDate,r.date,10)).sort((a,b)=>a.date.localeCompare(b.date));
 const val=valuations.at(-1)||null,pe=val?num(val.per):null;
 const operating=[...cashFlows].filter(r=>r.type==="CashFlowsFromOperatingActivities"&&finite(num(r.value))&&fresh(marketDate,r.date,600)).sort((a,b)=>a.date.localeCompare(b.date));
 const cash=operating.filter(r=>fresh(marketDate,r.date,180)).at(-1)||null;
 const lastYearCash=cash&&operating.find(r=>r.date===(String(Number(cash.date.slice(0,4))-1)+cash.date.slice(4)))||null;
 const cashValue=cash?num(cash.value):null;
 const cashScore=cashValue===null?null:cashValue<=0?1:lastYearCash&&num(lastYearCash.value)>0&&cashValue>num(lastYearCash.value)?10:7;
 const margins=[...margin].filter(r=>finite(num(r.financing))&&finite(num(r.previousFinancing))&&fresh(marketDate,r.date,10)).sort((a,b)=>a.date.localeCompare(b.date));
 const marginLatest=margins.at(-1)||null;
 const financeChange=marginLatest?num(marginLatest.financing)-num(marginLatest.previousFinancing):null;
 const financeChangePct=marginLatest&&num(marginLatest.previousFinancing)>0?financeChange/num(marginLatest.previousFinancing)*100:null;
 const marginScore=financeChange===null?null:financeChange<0?(financeChangePct!==null&&financeChangePct<=-2?5:4):financeChange===0?2:1;
 const largeShare=holding?.share;
 const deltaShare=holding?.change;
 const concentrationScore=typeof largeShare==="number"&&largeShare>=0&&largeShare<=100?
  deltaShare!==null&&deltaShare!==undefined&&deltaShare>=2&&largeShare>=50?5:
  deltaShare!==null&&deltaShare!==undefined&&deltaShare>=1&&largeShare>=35?4:
  largeShare>=35?3:largeShare>=20?2:1:null;
 const matchedEvent=name=>newsResearch?.items?.find(x=>x.name===name)||null;
 const officialEvent=matchedEvent("重大公告與事件"),independentEvent=matchedEvent("獨立新聞來源");
 const fundamental=[
 item("單月營收年增率",15,yoy===null?null:yoy>=20?15:yoy>=10?12:yoy>=0?9:yoy>=-10?5:1,yoy===null?null:round(yoy)+"%",lastRev?.date,"FinMind","同月份與前一年比較"),
 item("單季 EPS",15,eps===null?null:num(eps.value)>0?num(eps.value)>=5?15:10:0,eps?num(eps.value):null,eps?.date,"FinMind","EPS 絕對值僅供初步觀察，未作同產業比較"),
 item("營業現金流（初步）",10,cashScore,cashValue,cash?.date,cash?"FinMind":"",cash?"最近一期營業現金流；正數獲7分，同期年增再加3分，尚未納入完整負債比。":"最近180天無可用營業現金流資料"),
 item("估值／本益比",10,pe===null?null:pe<=12?10:pe<=20?7:pe<=35?4:1,pe,val?.date,val?"FinMind":"",val?"採最近10日內的 PER；尚未做產業比較，虧損公司不適用。":"最近10日無可用正數 PER，未給分")];
 const news=[item("重大公告與事件",5,officialEvent?.score??null,officialEvent?.value??null,
 officialEvent?.date,officialEvent?.source,officialEvent?.note||"尚無完成跨來源查證的明確重大事件；沒有新聞不等於沒有風險"),
 item("獨立新聞來源",3,independentEvent?.score??null,independentEvent?.value??null,
 independentEvent?.date,independentEvent?.source,independentEvent?.note||"中央社、MoneyDJ、Reuters 等原始授權新聞尚未完成同事件核對"),
 item("產業事件",2,null,null,null,null,"尚無跨來源確認的產業事件，暫不給分")];
 const chips=[item("近五交易日法人淨買賣",10,flows===null?null:flows>0?8:flows===0?5:2,flows,dates.at(-1),"FinMind","各類法人合計；尚未按流通股數標準化"),item("400張以上股權集中度",5,concentrationScore,
 holding?{largeHolderPct:holding.share,weeklyChangePct:holding.change}:null,
 holding?.date,holding?.source||null,
 holding?.note||"尚未從 TDCC 官方每週股權分散表取得有效資料，暫不給分"),item("融資餘額變化",5,marginScore,financeChange,marginLatest?.date,marginLatest?"FinMind":"",marginLatest?"以單日融資餘額增減作初步觀察，不代表買賣訊號；融券資訊僅保留原始數據。":"最近10日沒有可用融資融券資料")];
 const technical=[item("均線趨勢",8,tech===null?null:tech.close>tech.ma20&&tech.ma20>tech.ma60?8:tech.close>tech.ma20?5:2,tech?{close:tech.close,ma20:tech.ma20,ma60:tech.ma60}:null,tech?.date,"FinMind","未調整除權息／減資"),item("RSI(14)",4,tech===null?null:tech.rsi>=45&&tech.rsi<=65?4:tech.rsi>70||tech.rsi<30?1:2,tech?.rsi,tech?.date,"FinMind","極端 RSI 不直接等於買賣訊號"),item("MACD",4,tech===null?null:tech.macd>tech.signal?4:1,tech?{macd:tech.macd,signal:tech.signal,cross:tech.macdCross}:null,tech?.date,"FinMind","歷史資料未進行公司行動調整"),item("量價",4,tech?.volumeRatio===null||!tech?null:tech.volumeRatio>=1.2&&tech.close>tech.ma20?4:tech.volumeRatio<0.5?1:2,tech?.volumeRatio,tech?.date,"FinMind","以近二十交易日成交股數作比較")];
 const groups={fundamental,news,chips,technical};const parts=Object.fromEntries(Object.entries(groups).map(([key,items])=>[key,{max:WEIGHTS[key],earned:round(items.reduce((s,i)=>s+(i.score??0),0)),covered:items.reduce((s,i)=>s+(i.score===null?0:i.max),0),items}]));
 const covered=Object.values(parts).reduce((s,p)=>s+p.covered,0),earned=round(Object.values(parts).reduce((s,p)=>s+p.earned,0));
 return {score:covered===100?earned:null,observedPoints:earned,coveredPoints:covered,coveragePercent:covered,complete:covered===100,parts,indicators:tech,latestPriceDate:latest?.date||null,disclaimer:"僅供資料研究；缺資料不補 0 分、不重新加權。分數不是報酬率或投資建議。"};
}
