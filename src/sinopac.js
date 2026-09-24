// Private Cloudflare -> Render Shioaji bridge. Never put broker credentials in Workers or browser.
// Broker quotes are OWNER ONLY until redistribution permissions have been confirmed.
export const sinopacReady=env=>
  !!(env.SJ_GATEWAY_URL&&env.SJ_BRIDGE_TOKEN&&env.SJ_OWNER_TEST_TOKEN);

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
