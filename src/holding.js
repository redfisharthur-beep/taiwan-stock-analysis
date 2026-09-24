// TDCC official weekly distribution, open-data dataset 1-5.
// Levels 12–15 = accounts with 400,001 shares or more (400 lots).
const url="https://openapi.tdcc.com.tw/v1/opendata/1-5";
const num=x=>{const n=Number(String(x??"").replaceAll(",","").trim());return Number.isFinite(n)?n:null};
const cleanDate=x=>{const s=String(x??"").replace(/[^0-9]/g,"");return s.length===8?s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8):s.length===7?String(Number(s.slice(0,3))+1911)+"-"+s.slice(3,5)+"-"+s.slice(5,7):null};
export function concentration(rows,stock,marketDate){
 const found=(rows||[]).filter(x=>String(x["證券代號"]??x.stock_id??"").trim()===stock)
  .map(x=>({date:cleanDate(x["資料日期"]??x.date),level:num(x["持股分級"]??x.HoldingSharesLevel),
   pct:num(x["占集保庫存數比例%"]??x.percent),shares:num(x["股數"]??x.unit)}))
  .filter(x=>x.date&&x.level>=1&&x.level<=17&&x.pct!==null&&x.pct>=0&&x.pct<=100&&x.shares!==null&&x.shares>=0);
 const dates=[...new Set(found.map(x=>x.date))].filter(d=>d<=marketDate).sort();
 const weeks=dates.slice(-4).map(date=>{
  const tier=found.filter(x=>x.date===date&&x.level>=12&&x.level<=15);
  if(tier.length!==4||new Set(tier.map(x=>x.level)).size!==4)return null;
  const share=tier.reduce((a,x)=>a+x.pct,0);
  return share>=0&&share<=100?{date,share:Math.round(share*100)/100}:null;
 }).filter(Boolean);
 if(weeks.length===0)return null;
 const latest=weeks.at(-1),age=Math.round((Date.parse(marketDate)-Date.parse(latest.date))/86400000);
 if(age<0||age>14)return null;
 // For a trend score require three consecutive weekly snapshots, not a single concentration point.
 let trend=null;
 if(weeks.length>=3){
  const recent=weeks.slice(-3);
  const intervals=recent.slice(1).map((w,i)=>Math.round((Date.parse(w.date)-Date.parse(recent[i].date))/86400000));
  if(intervals.every(d=>d>=5&&d<=10)){
   const changes=recent.slice(1).map((w,i)=>Math.round((w.share-recent[i].share)*100)/100);
   trend={weeks:recent,weeklyChanges:changes,changeTwoWeeks:Math.round((latest.share-recent[0].share)*100)/100,
    risingWeeks:changes.filter(v=>v>0).length,fallingWeeks:changes.filter(v=>v<0).length};
  }
 }
 return {date:latest.date,share:latest.share,change:trend?.weeklyChanges.at(-1)??null,
  trend,previousDate:trend?.weeks.at(-2)?.date??null,
  source:"TDCC 集保戶股權分散表",sourceUrl:url,
  note:trend?"近三週400張以上集保占比與連續增減，非前十大股東、也非股價預測":
   "至少需三期連續有效週資料才能評股權趨勢；單週比例只顯示不給分"};
}
function parseCSV(source){const lines=source.replace(/^\uFEFF/,"").split(/\r?\n/);
 if(lines.length<2)throw Error("empty CSV");
 const cells=line=>{const out=[];let cur="",quoted=false;for(let i=0;i<line.length;i++){
  const c=line[i];if(c==='"'&&quoted&&line[i+1]==='"'){cur+='"';i++}
  else if(c==='"')quoted=!quoted;else if(c===","&&!quoted){out.push(cur);cur=""}
  else cur+=c;}out.push(cur);return out};
 const headers=cells(lines[0]);return lines.slice(1).filter(Boolean).map(line=>
  Object.fromEntries(cells(line).map((v,i)=>[headers[i],v])));
}
export async function getHoldingRows(fetcher=fetch){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
 try{const res=await fetcher(url,{signal:controller.signal,headers:{Accept:"application/json,text/csv"}});
  if(!res.ok)throw Error("HTTP "+res.status);
  const size=Number(res.headers.get("content-length")||0);
  if(size>12000000)throw Error("TDCC response too large");
  const buffer=await res.arrayBuffer();
  if(buffer.byteLength>12000000)throw Error("TDCC response too large");
  const text=new TextDecoder("utf-8").decode(buffer);
  const data=text.trimStart().startsWith("[")?JSON.parse(text):parseCSV(text);
  if(!Array.isArray(data))throw Error("TDCC response format changed");
  return data;
 }finally{clearTimeout(timer)}
}
/**
 * Historical TDCC 1-5 weekly snapshots, re-published under the government open-data
 * license. This is a third-party mirror, not a direct official TDCC historic API.
 * Validate date, stock, four distinct tiers and three consecutive reporting weeks.
 */
export async function archivedHoldingForStock(stock,marketDate,fetcher=fetch){
 if(!/^[0-9]{4}$/.test(stock)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(marketDate||""))return null;
 const base="https://api.github.com/repos/wirelessr/tdcc-opendata-archive/contents/snapshots/";
 const archive="https://raw.githubusercontent.com/wirelessr/tdcc-opendata-archive/main/snapshots/";
 const year=marketDate.slice(0,4);
 const timer=ms=>{const c=new AbortController(),id=setTimeout(()=>c.abort(),ms);
  return {signal:c.signal,stop:()=>clearTimeout(id)}};
 let index;
 const catalog=timer(6500);
 try{
  const response=await fetcher(base+year,{headers:{Accept:"application/vnd.github+json"},signal:catalog.signal});
  if(!response.ok)return null;
  index=await response.json();
 }catch{return null}finally{catalog.stop()}
 if(!Array.isArray(index))return null;
 const dates=index.map(x=>String(x.name||"").replace(/\\.csv$/,"")).filter(x=>
  /^\\d{4}-\\d{2}-\\d{2}$/.test(x)&&x<=marketDate).sort().slice(-3);
 if(dates.length!==3)return null;
 const weekGaps=dates.slice(1).map((d,i)=>(Date.parse(d)-Date.parse(dates[i]))/86400000);
 if(weekGaps.some(days=>days<5||days>10))return null;
 const selected=await Promise.all(dates.map(async date=>{
  const req=timer(6500);
  try{
   const url=archive+year+"/"+date+".csv",response=await fetcher(url,{signal:req.signal});
   if(!response.ok||Number(response.headers?.get?.("content-length")||0)>4000000)return [];
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength>4000000)return [];
   const csv=new TextDecoder("utf-8").decode(bytes).replace(/^\\uFEFF/,"");
   const lines=csv.split(/\\r?\\n/);
   const matching=lines.slice(1).filter(line=>line.split(",",2)[1]?.trim()===stock);
   if(!matching.length)return [];
   return parseCSV([lines[0],...matching].join("\\n"));
  }catch{return []}finally{req.stop()}
 }));
 const rows=selected.flat();
 const holding=concentration(rows,stock,marketDate);
 if(!holding?.trend||holding.trend.weeks.length!==3)return null;
 // If a source returns old/inconsistent dates, do not accept a manufactured trend.
 if(dates.some((d,i)=>holding.trend.weeks[i].date!==d))return null;
 return {...holding,source:"TDCC 開放資料三週公開備份（非官方即時 API）",
  sourceUrl:"https://github.com/wirelessr/tdcc-opendata-archive",
  note:"以公眾備份的三期實際 TDCC 開放資料計算，資料由第三方鏡像保存；非即時持股與未來股價預測"};
}
export async function holdingForStock(stock,marketDate,rows=null){
 const raw=rows??await getHoldingRows();return concentration(raw,stock,marketDate);
}
