// Official MOPS disclosures via TWSE / TPEx open data, plus optional properly licensed
// independent news feed. One syndicated item counts as ONE originating publisher.
const OFFICIAL={
 listed:"https://openapi.twse.com.tw/v1/opendata/t187ap04_L",
 otc:"https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O"
};
const SOURCE_LINKS=[
 ["公開資訊觀測站","https://mops.twse.com.tw/"],
 ["臺灣證券交易所",OFFICIAL.listed],
 ["證券櫃檯買賣中心",OFFICIAL.otc],
 ["中央社","https://www.cna.com.tw/"],
 ["MoneyDJ 理財網","https://www.moneydj.com/"],
 ["Reuters 路透社","https://www.reuters.com/"]
];
export const newsSources=()=>SOURCE_LINKS.map(([name,url])=>({name,url,status:"not_necessarily_checked"}));
const roc=x=>{const s=String(x??"").replace(/[^0-9]/g,"");
 if(s.length===7)return String(Number(s.slice(0,3))+1911)+"-"+s.slice(3,5)+"-"+s.slice(5,7);
 if(s.length===8)return s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8);return null};
const norm=x=>String(x??"").replace(/\s+/g," ").trim();
export function eventKind(title){
 const t=norm(title);
 // Strict case-specific language, not stock-price sentiment.
 if(/(?:未取得|澄清|否認)/.test(t))return null;
 if(/(?:撤銷|終止|取消).{0,8}(?:重大訂單|重大合約)/.test(t))return "order_cancelled";
 if(/(?:取得|獲得).{0,8}(?:重大訂單|長期供貨合約)/.test(t))return "order_won";
 if(/(?:重大訴訟).{0,10}(?:敗訴|須賠償)/.test(t))return "adverse_litigation";
 if(/(?:財務報告|財報).{0,10}(?:重編|更正)/.test(t))return "financial_restatement";
 return null;
}
const types={order_won:{impact:"可能正面",score:4},order_cancelled:{impact:"可能負面",score:0},
 adverse_litigation:{impact:"可能負面",score:0},financial_restatement:{impact:"可能負面",score:0}};
export function parseDisclosures(rows,stock,marketDate,source,url){
 if(!Array.isArray(rows))return [];
 return rows.filter(x=>String(x["公司代號"]??x["公司代碼"]??"").trim()===stock)
 .map(x=>({stock,title:norm(x["主旨 "]??x["主旨"]??""),date:roc(x["發言日期"]),
  eventDate:roc(x["事實發生日"]),source,url}))
 .filter(x=>x.title&&x.date&&x.date<=marketDate&&
  (Date.parse(marketDate+"T00:00:00Z")-Date.parse(x.date+"T00:00:00Z"))/86400000<=30)
 .map(x=>({...x,kind:eventKind(x.title)}));
}
async function retrieve(url,init={},max=2500000){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6500);
 try{const res=await fetch(url,{...init,signal:ctrl.signal,headers:{Accept:"application/json",...(init.headers||{})}});
  if(!res.ok)throw Error("HTTP "+res.status);
  if(Number(res.headers.get("content-length")||0)>max)throw Error("payload too large");
  const bytes=await res.arrayBuffer();if(bytes.byteLength>max)throw Error("payload too large");
  return JSON.parse(new TextDecoder().decode(bytes));
 }finally{clearTimeout(timer)}
}
export async function loadOfficialDisclosures(market){
 const url=market==="上市"?OFFICIAL.listed:OFFICIAL.otc;
 try{return {rows:await retrieve(url),error:null}}catch(e){return {rows:[],error:"重大訊息來源暫無法讀取："+String(e.message||e)}}
}
export async function officialNews(stock,marketDate,market,prefetched=null){
 const url=market==="上市"?OFFICIAL.listed:OFFICIAL.otc;
 const fetched=prefetched??await loadOfficialDisclosures(market);
 return {events:parseDisclosures(fetched.rows,stock,marketDate,"MOPS（"+market+"）",url),error:fetched.error};
}
const PUBLISHERS=new Set(["中央社","MoneyDJ 理財網","Reuters 路透社"]);
const publisherHosts={"中央社":["cna.com.tw"],"MoneyDJ 理財網":["moneydj.com"],
 "Reuters 路透社":["reuters.com","reutersconnect.com"]};
function publisherUrlMatches(article){
 try{const host=new URL(article.url).hostname.toLowerCase();
  return (publisherHosts[article.publisher]||[]).some(domain=>host===domain||host.endsWith("."+domain));
 }catch{return false}
}
export function corroborate(events,articles,stock){
 const valid=(Array.isArray(articles)?articles:[]).filter(a=>a.stock===stock&&PUBLISHERS.has(a.publisher)&&
  typeof a.url==="string"&&a.url.startsWith("https://")&&publisherUrlMatches(a)&&a.originalPublisher===a.publisher&&
  typeof a.publishedAt==="string"&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(a.publishedAt)&&
  typeof a.title==="string"&&a.title.length>=10);
 return events.map(e=>{
  const evidence=valid.filter(a=>a.eventType===e.kind&&e.kind&&Math.abs(Date.parse(a.publishedAt)-Date.parse(e.date))<=3*86400000);
  const unique=[...new Map(evidence.map(a=>[a.publisher,a])).values()];
  return {...e,verification:unique.length?"independent_corrob":"official_only",
    evidence:unique.map(a=>({publisher:a.publisher,title:a.title,url:a.url,date:a.publishedAt}))};
 });
}
export function scoreNews(events){
 const verified=events.filter(e=>e.kind&&e.verification==="independent_corrob"&&types[e.kind]);
 if(!verified.length){
  // A real, dated official MOPS filing verifies that the event was announced,
  // even when no licensed independent article is available. This is only
  // a partial source-verification observation, not sentiment or future return.
  const official=[...events].filter(e=>e.date&&e.title&&String(e.source||"").startsWith("MOPS")&&
   (e.verification==="official_only"||e.verification==="independent_corrob"))
   .sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(official)return {status:"official_event_only",events,sourceCount:1,
   items:[{name:"重大公告與事件",max:5,score:2,value:official.title,
    date:official.date,source:official.source,
    note:"已核對 MOPS 公告存在、公司與日期；獨立新聞尚未核實，2 分僅代表官方事件資料有據，不評估股價方向"}]};
  return {status:"unverified",items:[],events,sourceCount:0};
 }
 const current=[...verified].sort((a,b)=>b.date.localeCompare(a.date))[0];
 const info=types[current.kind];
 return {status:"corroborated_event",event:current,impact:info.impact,
   items:[{name:"重大公告與事件",max:5,score:info.score,value:current.title,date:current.date,
     source:current.source,note:"官方重大訊息及獨立媒體同事件核對；事件對股價的影響仍可能不同"},
    {name:"獨立新聞來源",max:3,score:info.score===0?0:3,
     value:current.evidence.map(x=>x.publisher).join("、"),date:current.date,source:"具授權獨立新聞",
     note:"有不同原始採訪或發稿來源；同一篇轉載不重複計數"}],
   events,sourceCount:current.evidence.length+1};
}
// Public news-discovery metadata only (headline, publisher URL and timestamp).
// Do not treat search matches as verified facts, independent reporting or a sentiment score.
/**
 * Discover titles and ORIGINAL publisher URLs through GDELT's metadata API.
 * Does not fetch Reuters/CNA/MoneyDJ article bodies, bypass access controls,
 * treat aggregation as licensed content, or score mere headlines as verified facts.
 */
const preferredHosts=[
 ["中央社","cna.com.tw"],["MoneyDJ 理財網","moneydj.com"],["Reuters 路透社","reuters.com"]
];
function discoveryPublisher(articleUrl){
 try{
  const url=new URL(articleUrl);
  if(url.protocol!=="https:")return null;
  const host=url.hostname.toLowerCase();
  const found=preferredHosts.find(([,domain])=>host===domain||host.endsWith("."+domain));
  return {publisher:found?.[0]||host,host,preferred:!!found};
 }catch{return null}
}
export async function discoverNews(stockName,marketDate,fetcher=fetch){
 const name=String(stockName||"").trim().slice(0,24);
 if(name.length<2||!marketDate)return {articles:[],status:"missing_company_name"};
 const url=new URL("https://api.gdeltproject.org/api/v2/doc/doc");
 url.searchParams.set("query",'"'+name.replaceAll('"',"")+'"');
 url.searchParams.set("mode","artlist");url.searchParams.set("format","json");
 url.searchParams.set("timespan","2weeks");url.searchParams.set("maxrecords","50");
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6500);
 try{
  const resp=await fetcher(url.toString(),{signal:ctrl.signal,headers:{Accept:"application/json"}});
  if(!resp.ok)return {articles:[],status:"unavailable"};
  const bytes=await resp.arrayBuffer();if(bytes.byteLength>600000)return {articles:[],status:"unavailable"};
  const payload=JSON.parse(new TextDecoder().decode(bytes));
  const list=Array.isArray(payload.articles)?payload.articles:[];
  const seen=new Set();
  const items=list.filter(a=>typeof a.url==="string"&&
    typeof a.title==="string"&&a.title.length>=10&&typeof a.seendate==="string")
   .map(a=>{
    const publisher=discoveryPublisher(a.url);
    if(!publisher)return null;
    const date=a.seendate.slice(0,4)+"-"+a.seendate.slice(4,6)+"-"+a.seendate.slice(6,8);
    return {title:a.title.trim().slice(0,180),url:a.url,publisher:publisher.publisher,
     preferredPublisher:publisher.preferred,date,verification:"headline_metadata_only"};
   }).filter(a=>a&&a.date<=marketDate&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(a.date))
   .filter(a=>{const key=a.url.replace(/[#?].*$/,"").toLowerCase();if(seen.has(key))return false;seen.add(key);return true})
   .sort((a,b)=>(Number(b.title.includes(name))-Number(a.title.includes(name)))||
    Number(b.preferredPublisher)-Number(a.preferredPublisher)||b.date.localeCompare(a.date))
   .slice(0,10);
  return {articles:items,status:items.length?"discovered":"no_matches",
   method:"GDELT 原始新聞網址、標題與首次發現日；非全文爬取或獨立核實"};
 }catch{return {articles:[],status:"unavailable"}}
 finally{clearTimeout(timer)}
}
export async function researchNews(stock,marketDate,market,env,prefetched=null,stockName=""){
 const official=await officialNews(stock,marketDate,market,prefetched);
 const discovery=env.DISABLE_NEWS_DISCOVERY==="true"?{articles:[],status:"skipped_in_bulk"}:
  await discoverNews(stockName,marketDate);
 let articles=[],feedError=null;
 if(env.NEWS_FEED_URL&&env.NEWS_FEED_TOKEN){
  try{const src=new URL(env.NEWS_FEED_URL);
   if(src.protocol!=="https:")throw Error("news feed URL must be HTTPS");
   src.searchParams.set("stock",stock);
   const payload=await retrieve(src.toString(),{headers:{Authorization:"Bearer "+env.NEWS_FEED_TOKEN}},400000);
   if(!Array.isArray(payload.articles))throw Error("news feed missing articles");
   articles=payload.articles;
  }catch(e){feedError="授權新聞來源暫無法取得："+String(e.message||e)}
 }
 articles=articles.filter(a=>typeof a.publishedAt==="string"&&a.publishedAt<=marketDate);
 const events=corroborate(official.events,articles,stock);
 const result=scoreNews(events);
 if(result.status==="unverified"&&official.events.length===0&&articles.length){
   const independent=articles.filter(a=>a.stock===stock&&PUBLISHERS.has(a.publisher)&&a.originalPublisher===a.publisher&&
     typeof a.url==="string"&&a.url.startsWith("https://")&&publisherUrlMatches(a)&&typeof a.title==="string"&&a.title.length>=10&&
     typeof a.publishedAt==="string"&&a.publishedAt<=marketDate&&eventKind(a.title)===a.eventType);
   const byKind=new Map();
   for(const a of independent){const key=a.eventType+"|"+a.publishedAt;if(!byKind.has(key))byKind.set(key,[]);byKind.get(key).push(a)}
   const group=[...byKind.values()].find(group=>new Set(group.map(x=>x.publisher)).size>=2);
   if(group){result.status="independent_media_only";result.impact=types[group[0].eventType]?.impact||"影響待查";
    result.items=[{name:"獨立新聞來源",max:3,score:result.impact==="可能負面"?0:2,
      value:group[0].title,date:group[0].publishedAt,source:"兩個獨立原始媒體",
      note:"暫未取得公司重大公告；只核對兩個獨立新聞原始來源，尚不能確認影響幅度"}];
    result.mediaEvidence=group.map(a=>({publisher:a.publisher,title:a.title,url:a.url,date:a.publishedAt}));
   }
 }

 // Licensed-provider industry evidence is optional. Require two independent
 // original publishers reporting the SAME identified sector event. Merely having
 // any two finance headlines about a stock must never produce an industry score.
 const sector=articles.filter(a=>a.stock===stock&&a.eventType==="industry_event"&&
  typeof a.industryEventId==="string"&&a.industryEventId.length>=5&&a.industryEventId.length<=120&&
  PUBLISHERS.has(a.publisher)&&a.originalPublisher===a.publisher&&
  typeof a.url==="string"&&a.url.startsWith("https://")&&publisherUrlMatches(a)&&
  typeof a.title==="string"&&a.title.length>=10&&
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(a.publishedAt||"")&&
  (Date.parse(marketDate+"T00:00:00Z")-Date.parse(a.publishedAt+"T00:00:00Z"))/86400000<=14);
 const bySectorEvent=new Map();
 for(const article of sector){
  if(!bySectorEvent.has(article.industryEventId))bySectorEvent.set(article.industryEventId,[]);
  bySectorEvent.get(article.industryEventId).push(article);
 }
 const confirmedSector=[...bySectorEvent.values()].map(group=>
  [...new Map(group.map(a=>[a.publisher,a])).values()])
  .find(group=>group.length>=2&&
   Math.max(...group.map(a=>Date.parse(a.publishedAt)))-
   Math.min(...group.map(a=>Date.parse(a.publishedAt)))<=3*86400000);
 if(confirmedSector){
  const date=confirmedSector.map(x=>x.publishedAt).sort().at(-1);
  result.items=[...(result.items||[]),{name:"產業事件",max:2,score:2,
   value:confirmedSector[0].title,date,source:"授權新聞：兩個獨立原始媒體",
   note:"兩個原始媒體報導同一有明確事件 ID 的產業事件；僅表示資料核對，不代表股價方向"}];
 }
 return {...result,discovery,checked:[
  {name:"公開資訊觀測站",status:official.error?"unavailable":"checked",url:"https://mops.twse.com.tw/"},
  {name:"臺灣證券交易所",status:market==="上市"?(official.error?"unavailable":"checked"):"other_market",url:OFFICIAL.listed},
  {name:"證券櫃檯買賣中心",status:market==="上櫃"?(official.error?"unavailable":"checked"):"other_market",url:OFFICIAL.otc},
  ...["中央社","MoneyDJ 理財網","Reuters 路透社"].map(name=>({name,
    status:articles.some(a=>a.publisher===name)?"provided":
     discovery.articles?.some(a=>a.publisher===name)?"discovered":"not_connected",
    url:SOURCE_LINKS.find(x=>x[0]===name)[1]})),
],
  warnings:[official.error,feedError].filter(Boolean),
  note:result.status==="unverified"?
   "沒有完成同事件跨來源核對；未找到新聞不代表沒有風險。":
   result.status==="official_event_only"?"已有真實官方事件，媒體與產業交叉查證尚未完成。":
   result.status==="independent_media_only"?"兩個獨立媒體同事件，但公司公告仍待確認；低權重暫評。":
   "僅反映已核實的事件類別，不預測股價"};
}
