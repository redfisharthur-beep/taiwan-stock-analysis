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
export async function holdingForStock(stock,marketDate,rows=null){
 const raw=rows??await getHoldingRows();return concentration(raw,stock,marketDate);
}
