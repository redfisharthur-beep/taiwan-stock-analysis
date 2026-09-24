// Private Cloudflare -> Render Shioaji bridge. Never put broker credentials in Workers or browser.
// Broker quotes are OWNER ONLY until redistribution permissions have been confirmed.
export const sinopacReady=env=>
  !!(env.SJ_GATEWAY_URL&&typeof env.SJ_BRIDGE_TOKEN==="string"&&env.SJ_BRIDGE_TOKEN.length>=32);

const encoder=new TextEncoder();
async function tokenMatch(provided,expected){
 if(typeof provided!=="string"||typeof expected!=="string"||expected.length<32)return false;
 const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",encoder.encode(provided)),
   crypto.subtle.digest("SHA-256",encoder.encode(expected))]);
 const x=new Uint8Array(a),y=new Uint8Array(b);
 return x.reduce((diff,n,i)=>diff|(n^y[i]),0)===0;
}
export async function validateOwner(request,env){
 const header=request.headers.get("Authorization")||"";
 return header.startsWith("Bearer ")&&await tokenMatch(header.slice(7),env.SJ_OWNER_TEST_TOKEN);
}
export async function privateBrokerSnapshot(stock,env,fetcher=fetch){
 if(!sinopacReady(env))return {status:"not_configured",message:"Render gateway secrets missing"};
 if(!/^[0-9]{4}$/.test(stock))return {status:"invalid_code",message:"4-digit stock code required"};
 let host;
 try{host=new URL(String(env.SJ_GATEWAY_URL));}
 catch{return {status:"bad_config",message:"Render URL invalid"}}
 // Never fetch an arbitrary address, even if an environment variable is accidentally changed.
 if(host.protocol!=="https:"||host.username||host.password||host.port||host.search||host.hash||
    host.pathname!=="/"||!host.hostname.endsWith(".onrender.com"))
   return {status:"bad_config",message:"Gateway URL must be HTTPS *.onrender.com origin"};
 const url=host.origin+"/internal/quote/"+stock;
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),25000);
 try{
  const res=await fetcher(url,{redirect:"error",signal:ctrl.signal,
   headers:{"Accept":"application/json","X-Bridge-Token":env.SJ_BRIDGE_TOKEN}});
  if(!res.ok)return {status:"unavailable",upstreamStatus:res.status,
   message:res.status===429?"券商快照查詢冷卻中":"Render/永豐行情暫不可用，請查看 Render 日誌"};
  if(!/application\/json/i.test(res.headers.get("content-type")||""))return {status:"invalid_data",message:"Gateway returned non-JSON"};
  const data=await res.json();
  if(data.stock!==stock||!["TSE","OTC"].includes(data.exchange)||
    !(typeof data.price==="number"&&Number.isFinite(data.price)&&data.price>0)||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(String(data.observedAt||""))||
    data.kind!=="snapshot_not_official_close")
    return {status:"invalid_data",message:"Missing verified quote fields or timestamp"};
  return {status:"ok",stock,exchange:data.exchange,price:data.price,
   observedAt:data.observedAt,source:"Sinopac Shioaji",kind:"snapshot_not_official_close",
   notice:"券商快照不是盤中即時推播，也不能直接視為官方收盤價；僅供持有人私人測試。"};
 }catch{return {status:"unavailable",message:"無法連線到 Render，若使用免費主機可能正在休眠"}}
 finally{clearTimeout(timer)}
}

// Automatic, server-side EOD history comparison. No personal account/trade fields are used.
export async function privateBrokerHistory(stock,marketDate,env,fetcher=fetch){
 if(!sinopacReady(env))return {status:"not_configured"};
 if(!/^[0-9]{4}$/.test(stock)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(marketDate))
  return {status:"invalid_request"};
 let host;
 try{host=new URL(String(env.SJ_GATEWAY_URL))}catch{return {status:"bad_config"}}
 if(host.protocol!=="https:"||host.username||host.password||host.port||host.search||host.hash||
   host.pathname!=="/"||!host.hostname.endsWith(".onrender.com"))
  return {status:"bad_config"};
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),50000);
 try{
  const u=host.origin+"/internal/history/"+stock+"?date_to="+marketDate;
  const res=await fetcher(u,{redirect:"error",signal:ctrl.signal,
   headers:{"Accept":"application/json","X-Bridge-Token":env.SJ_BRIDGE_TOKEN}});
  if(!res.ok)return {status:"unavailable",httpStatus:res.status};
  if(!/application\/json/i.test(res.headers.get("content-type")||""))return {status:"invalid_data"};
  const data=await res.json();
  if(data.stock!==stock||data.kind!=="unadjusted_completed_intraday_aggregate"||
    data.through!==marketDate||!Array.isArray(data.bars)||data.bars.length>90)
   return {status:"invalid_data"};
  const seen=new Set(),bars=[];
  for(const row of data.bars){
   if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.date)||row.date>marketDate||
      seen.has(row.date)||!Number.isInteger(row.minuteBars)||row.minuteBars<1||
      ![row.open,row.high,row.low,row.close].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>0)||
      row.high<Math.max(row.open,row.close,row.low)||row.low>Math.min(row.open,row.close))
     return {status:"invalid_data"};
   seen.add(row.date);
   bars.push({date:row.date,open:row.open,high:row.high,low:row.low,close:row.close,
    // Shioaji minute volumes may use a different unit from FinMind Trading_Volume.
    // Never plug broker minute volumes into price-volume scoring without unit verification.
    volume:null});
  }
  bars.sort((a,b)=>a.date.localeCompare(b.date));
  return {status:bars.length?"ok":"empty",bars,through:marketDate,
   methodology:"Shioaji completed intraday minutes aggregated into unadjusted daily bars"};
 }catch{return {status:"unavailable"}}
 finally{clearTimeout(timer)}
}
export function reconcileBrokerHistory(broker,official,finmindPrices){
 if(broker?.status!=="ok")return {state:broker?.status||"not_checked",reason:"永豐歷史日線尚未取得或未完成"};
 if(!official?.date||!Number.isFinite(official.close))
  return {state:"official_unavailable",reason:"無法取得官方當日收盤價"};
 const b=broker.bars.find(row=>row.date===official.date);
 const f=finmindPrices.find(row=>row.date===official.date);
 if(!b)return {state:"different_date",reason:"永豐沒有同一已完成交易日的日線；沒有比較不同日期"};
 if(!f||!Number.isFinite(f.close))
  return {state:"finmind_missing",reason:"FinMind 尚無相同日期的原始行情；未視為三方一致"};
 const eq=(x,y)=>Math.abs(x-y)<0.0001;
 return {state:eq(b.close,official.close)&&eq(f.close,official.close)?"matched":"mismatch",
  date:official.date,reason:eq(b.close,official.close)&&eq(f.close,official.close)?
   "官方、FinMind 原始收盤與永豐完整日線同日收盤一致；不重複加分":
   "同日收盤出現差異；請檢查集合競價、分K完整度及來源欄位，官方價不被券商覆蓋"};
}

export function compareRawTechnicalIndicators(finmind,broker){
 if(!finmind||!broker||!finmind.date||finmind.date!==broker.date)
  return {state:"not_comparable",reason:"來源日期不同，或資料不足；不跨口徑核對指標"};
 const tolerances={ma20:.08,ma60:.08,rsi:1.5,macd:.15,signal:.15,
  volatility20:3,maxDrawdown60:2};
 const results=Object.entries(tolerances).map(([indicator,tolerance])=>({
  indicator,consistent:
    typeof finmind[indicator]==="number"&&Number.isFinite(finmind[indicator])&&
    typeof broker[indicator]==="number"&&Number.isFinite(broker[indicator])&&
    Math.abs(finmind[indicator]-broker[indicator])<=tolerance
 }));
 const matched=results.filter(x=>x.consistent).length;
 return {state:matched===results.length?"consistent":"differences",
  checked:results.length,matched,
  divergentMetrics:results.filter(x=>!x.consistent).map(x=>x.indicator),
  reason:matched===results.length?
   "同日未還原價的均線、RSI、MACD與歷史波動等指標在預設容許誤差內一致；不重複給分":
   "同日未還原指標存在差異；可能涉及分K缺筆、收盤集合競價或股本調整，原評分維持不變"};
}
