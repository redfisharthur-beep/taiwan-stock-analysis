// TDCC official weekly distribution, open-data dataset 1-5.
// Levels 12–15 = accounts with 400,001 shares or more (400 lots).
const url="https://openapi.tdcc.com.tw/v1/opendata/1-5";
const num=x=>{const n=Number(String(x??"").replaceAll(",","").trim());return Number.isFinite(n)?n:null};
const cleanDate=x=>{const s=String(x??"").replace(/[^0-9]/g,"");return s.length===8?s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8):null};
export function concentration(rows,stock,marketDate){
 const found=(rows||[]).filter(x=>String(x["證券代號"]??x.stock_id??"").trim()===stock)
  .map(x=>({date:cleanDate(x["資料日期"]??x.date),level:num(x["持股分級"]??x.HoldingSharesLevel),
   pct:num(x["占集保庫存數比例%"]??x.percent),shares:num(x["股數"]??x.unit)}))
  .filter(x=>x.date&&x.level>=1&&x.level<=17&&x.pct!==null&&x.pct>=0&&x.pct<=100&&x.shares!==null&&x.shares>=0);
 const dates=[...new Set(found.map(x=>x.date))].filter(d=>d<=marketDate).sort();
 const date=dates.at(-1);
 if(!date||Math.round((Date.parse(marketDate)-Date.parse(date))/86400000)>35)return null;
 const same=found.filter(x=>x.date===date),large=same.filter(x=>x.level>=12&&x.level<=15);
 if(large.length!==4||new Set(large.map(x=>x.level)).size!==4)return null;
 const share=large.reduce((a,x)=>a+x.pct,0);
 if(!(share>=0&&share<=100))return null;
 const before=dates.at(-2),prev=found.filter(x=>x.date===before&&x.level>=12&&x.level<=15);
 const prevShare=prev.length===4&&new Set(prev.map(x=>x.level)).size===4?
   prev.reduce((a,x)=>a+x.pct,0):null;
 const change=prevShare===null?null:Math.round((share-prevShare)*100)/100;
 return {date,share:Math.round(share*100)/100,change,previousDate:prevShare===null?null:before,
  source:"TDCC 集保戶股權分散表",sourceUrl:url,
  note:"400張以上集保庫存占比，不等於前十大股東持股；不同產業或公司不宜直接比較"};
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
