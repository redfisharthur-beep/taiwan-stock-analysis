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
 ["Reuters 路透社","https://www.reuters.com/"],
 ["Goodinfo! 台灣股市資訊網","https://goodinfo.tw/"]
];
export const newsSources=()=>SOURCE_LINKS.map(([name,url])=>({name,url,status:"not_necessarily_checked"}));
const roc=x=>{const s=String(x??"").replace(/[^0-9]/g,"");
 if(s.length===7)return String(Number(s.slice(0,3))+1911)+"-"+s.slice(3,5)+"-"+s.slice(5,7);
 if(s.length===8)return s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8);return null};
const norm=x=>String(x??"").replace(/\s+/g," ").trim();
export function eventKind(title){
 const t=norm(title);
 // Strict case-specific language, not stock-price sentiment.
 if(/(?:取消|終止|未取得|澄清|否認)/.test(t))return null;
 if(/(?:取得|獲得).{0,8}(?:重大訂單|長期供貨合約)/.test(t))return "order_won";
 if(/(?:撤銷|終止).{0,8}(?:重大訂單|重大合約)/.test(t))return "order_cancelled";
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
export function corroborate(events,articles,stock){
 const valid=(Array.isArray(articles)?articles:[]).filter(a=>a.stock===stock&&PUBLISHERS.has(a.publisher)&&
  typeof a.url==="string"&&a.url.startsWith("https://")&&a.originalPublisher===a.publisher&&
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
 if(!verified.length)return {status:"unverified",items:[],events,sourceCount:0};
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
export async function researchNews(stock,marketDate,market,env,prefetched=null){
 const official=await officialNews(stock,marketDate,market,prefetched);
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
 const events=corroborate(official.events,articles,stock);
 const result=scoreNews(events);
 return {...result,checked:[{name:market==="上市"?"臺灣證券交易所／MOPS":"櫃買中心／MOPS",
  status:official.error?"unavailable":"checked",url:market==="上市"?OFFICIAL.listed:OFFICIAL.otc},
  ...["中央社","MoneyDJ 理財網","Reuters 路透社"].map(name=>({name,
    status:articles.some(a=>a.publisher===name)?"provided":"not_connected",url:SOURCE_LINKS.find(x=>x[0]===name)[1]})),
  ...["Goodinfo! 台灣股市資訊網"].map(name=>({name,status:"reference_only",
    url:"https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID="+stock}))],
  warnings:[official.error,feedError].filter(Boolean),
  note:result.status==="unverified"?
   "沒有完成官方公告與獨立報導的同事件核對，消息面不評分；未找到新聞不代表沒有風險。":"僅反映已核實的事件類別，不預測股價"};
}
