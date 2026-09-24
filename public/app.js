import {setupKline} from "./chart.js";
const $=id=>document.getElementById(id);
const el=(tag,text="",cls="")=>{const x=document.createElement(tag);x.textContent=String(text??"");if(cls)x.className=cls;return x;};
const fmt=value=>typeof value==="object"?Object.entries(value||{}).map(([k,v])=>k+" "+v).join("、"):String(value??"—");
let current=null;
function message(node,text,bad=false){node.textContent=text;node.className="notice"+(bad?" bad":"");}
function groupCard(name,part){
 const box=el("section","","panel score-card"),head=el("div","","card-head");
 head.append(el("h3",name),el("span",part.earned+" / "+part.max+" 分 · 涵蓋 "+part.covered+"/"+part.max,"pill"));box.append(head);
 const highlights=part.items.filter(i=>i.score!==null).sort((a,b)=>b.score/b.max-a.score/a.max).slice(0,2);
 box.append(el("p",highlights.length?highlights.map(i=>i.name+"："+fmt(i.value)).join(" · "):"尚無可核對資料","score-highlights"));
 const missing=part.items.filter(i=>i.score===null);
 if(missing.length)box.append(el("p","待補："+missing.map(i=>i.name).join("、"),"muted"));
 const details=el("details","","score-detail"),summary=el("summary","查看計分明細");details.append(summary);
 for(const item of part.items){
  const row=el("div","","score-row"),label=el("div","","row-head");
  label.append(el("span",item.name),el("strong",item.score===null?"待補":item.score+" / "+item.max));
  row.append(label,el("small",item.value===null?"":fmt(item.value)),el("small",item.score===null?
   "尚未評分："+(item.note||"目前無可用資料"):(item.source||"來源未標示")+" · "+(item.date||"日期未明")+" · "+item.note));
  details.append(row);
 }box.append(details);return box;
}
function sourceRow(parent,label,url){source(parent,label,url);}
function source(parent,label,url){
 const row=el("div",label+" ","source-line");
 if(url){const a=el("a","查看 ↗");a.href=url;a.target="_blank";a.rel="noopener noreferrer";row.append(a);}parent.append(row);
}
function present(d){
 current=d;$("result").hidden=false;
 $("market").textContent=d.market+" · "+d.stock;
 $("stock-name").textContent=(d.name||"股票")+" "+d.stock;
 $("asof").textContent="查詢時間："+new Date(d.asOf).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"});
 $("close").textContent=d.finmind.close.toLocaleString("zh-TW");
 $("price-date").textContent="行情 "+d.finmind.date;
 message($("verify"),d.verification.state==="一致"?"官方與 FinMind 同日價格一致":
  "行情待核對："+d.verification.state,d.verification.state==="不一致");
 const stats=$("overview");stats.replaceChildren();
 for(const [name,value] of [["綜合分數",d.score.score===null?"未完成":d.score.score+" 分"],
  ["已評子項小計",d.score.observedPoints+" 分"],["資料涵蓋權重",d.score.coveredPoints+" / 100"]]){
  const x=el("div","","metric");x.append(el("span",name),el("b",value));stats.append(x);
 }
 $("warnings").textContent=d.sourceWarnings.length?"部分來源暫未取得，詳見「資料來源與更新說明」。":
  d.score?.technicalMode==="raw"?"技術面採未還原日行情；除權息可能影響長期指標。":"";
 setupKline($("kline"),$("kline-tip"),d.candles||[]);
 const parts=$("parts");parts.replaceChildren();
 for(const [key,label] of [["fundamental","基本面"],["news","消息面"],["chips","籌碼面"],["technical","技術分析"]])
  parts.append(groupCard(label,d.score.parts[key]));
 const news=d.newsResearch||{status:"unverified",events:[],checked:[]};
 $("news-status").textContent=news.status==="corroborated_event"?
  "官方公告＋獨立媒體核對："+(news.impact||"影響待觀察")+"（非股價預測）":
  news.status==="independent_media_only"?"兩家獨立媒體同事件（尚無官方公告）："+(news.impact||"待判讀"):
  "尚無完成跨來源確認的重大事件，消息面維持待評。";
 const ev=$("news-evidence");ev.replaceChildren();
 for(const event of (news.events||[]).slice(0,6)){
  const row=el("div","","source-line"),link=el("a",event.title||"公司公告");
  link.href=event.url;link.target="_blank";link.rel="noopener noreferrer";
  row.append(link,el("small"," · "+(event.date||"日期不明")+" · "+(event.verification==="independent_corrob"?"已有獨立來源核對":"尚未完成獨立查證")));
  for(const item of event.evidence||[]){
   const a=el("a",item.publisher+"（"+item.date+"）");a.href=item.url;a.target="_blank";a.rel="noopener noreferrer";
   row.append(el("br"),a);
  }ev.append(row);
 }
 for(const item of news.mediaEvidence||[]){const row=el("div","","source-line"),link=el("a",item.publisher+" · "+item.title);
  link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";
  row.append(link,el("small"," · "+item.date+"（媒體報導，官方待核對）"));ev.append(row);
 }
 if(!ev.children.length)ev.append(el("p","最近沒有可顯示的已取得公告；不代表公司沒有消息。","muted"));
 const discovery=news.discovery||{articles:[],status:"not_checked"};
 if(discovery.articles?.length){
   ev.append(el("p","其他財經報導線索（僅找到標題與原始連結，尚未交叉核實）：","muted"));
   for(const article of discovery.articles.slice(0,5)){
    const row=el("div","","source-line"),link=el("a",article.title);
    link.href=article.url;link.target="_blank";link.rel="noopener noreferrer";
    row.append(link,el("small"," · "+article.publisher+" · "+article.date+" · 未核實"));ev.append(row);
   }
 }
 const checked=$("news-source-status");checked.replaceChildren();
 for(const source of (news.checked||[])){
  const name=source.name;
  const status=source.status==="checked"?"已讀取官方公告":
   source.status==="provided"?"已收到授權新聞資料":
   source.status==="unavailable"?"暫無法讀取":
   source.status==="other_market"?"另一市場，非本股來源":
   source.status==="reference_only"?"非獨立消息證據":"尚未連結授權新聞";
  sourceRow(checked,name+"："+status,source.url);
 }
 const sources=$("sources");sources.replaceChildren();
 const health=$("data-health");health.replaceChildren();
 const mode=d.score?.technicalMode||"unavailable";
 health.append(el("p","技術分析資料："+(mode==="adjusted"?"使用還原價":
  mode==="raw"?"使用未還原日行情（除權息可能影響指標）":"歷史行情不足，尚未計分"),"muted"));
 for(const dataset of d.datasetHealth||[]){
  const status=dataset.status==="ok"?"已取得 "+dataset.records+" 筆":
   dataset.status==="empty"?"本次查無資料":"取得失敗";
  health.append(el("p",dataset.name+"："+
   status+(dataset.latestDate?" · 最新 "+dataset.latestDate:"")+
   (dataset.status==="ok"?"":" · "+dataset.message),"muted"));
 }
 if(d.missingMetrics?.length)health.append(el("p","尚待完成："+d.missingMetrics.map(x=>x.name).join("、"),"muted"));
 source(sources,"FinMind · "+d.finmind.date,"https://finmindtrade.com/");
 if(d.official)source(sources,d.official.source+" · "+(d.official.date||"日期未提供"),d.official.url);
 source(sources,"公開資訊觀測站（事件須核實才計分）",d.links.mops);
 for(const warning of d.sourceWarnings||[])sources.append(el("p","資料更新提示："+warning,"muted"));
 history.replaceState(null,"","?stock="+encodeURIComponent(d.stock));
}
$("search").addEventListener("submit",async e=>{
 e.preventDefault();const stock=$("ticker").value.trim();
 if(!/^\d{4,6}$/.test(stock)){$("status").textContent="請輸入正確股票代號。";return;}
 const btn=$("submit");btn.disabled=true;$("status").textContent="正在整理最新資料…";$("result").hidden=true;
 try{
  const response=await fetch("/api/analyze?stock="+encodeURIComponent(stock));
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"資料取得失敗");
  present(data);$("status").textContent="查詢完成，請查看資料日期與涵蓋度。";
  $("result").scrollIntoView({behavior:"smooth",block:"start"});
 }catch(error){$("status").textContent="查詢未完成："+error.message;}finally{btn.disabled=false;}
});
async function refreshValue(exclude=[]){
  let v={stocks:[],eligibleCount:0,candidateCount:0},valueMarketDate=null;
  try{
    const excluded=exclude.slice(0,5).join(",");
    const reply=await fetch("/api/value5?exclude="+encodeURIComponent(excluded));
    const result=await reply.json();
    if(!reply.ok)throw Error(result.reason||"價值觀察資料暫時不可用");
    v=result.value||v;v.candidateCount=result.candidateCount||0;valueMarketDate=result.marketDate||valueMarketDate;
  }catch(error){$("value-status").textContent="價值觀察資料暫不可用："+error.message;return;}
  const target=$("value-list");
  target.replaceChildren();$("value-date").textContent=valueMarketDate||"尚無資料";
  $("value-status").textContent=v.stocks?.length?
    "價值候選 "+(v.candidateCount||0)+" 檔 · 符合初步估值條件 "+v.eligibleCount+
    " 檔。不是全市場估算的內在價值排名。":
    "本次候選股中，尚無同時通過估值、獲利及現金流檢查的五檔。";
  for(const row of (v.stocks||[])){
   const card=el("article","","daily-item"),badge=el("div",String(row.rank),"daily-rank"),
    body=el("div"),right=el("div","","daily-score");
   body.append(el("div",(row.name||"股票")+" "+row.stock,"daily-name"),
    el("div",row.date+" · "+row.market+" · 收盤 "+row.close+" 元","daily-sub"));
   const tags=el("div","","daily-parts");
   for(const reason of row.reason||[])tags.append(el("span",reason));
   body.append(tags,el("p","僅符合初步低估值條件；尚未計算內在價值。","daily-reason"));
   right.append(el("strong",row.valueChecklist+" / 100"),
    el("small","價值篩選條件分 · 非預期報酬"));
   const button=el("button","查看分析 →","daily-action");button.type="button";
   button.addEventListener("click",()=>{$("ticker").value=row.stock;$("search").requestSubmit();});
   right.append(button);card.append(badge,body,right);target.append(card);
  }
}
async function refreshDaily(){
 const status=$("daily-status"),list=$("daily-list"),stamp=$("daily-date");list.replaceChildren();
 try{
  const response=await fetch("/api/top5");if(!response.ok)throw Error("資料服務暫不可用");
  const d=await response.json();stamp.textContent=d.marketDate||"尚無資料";
  if(!d.ready||!d.stocks?.length){status.textContent=d.reason||"目前沒有足夠資料，暫不顯示名單。";await refreshValue([]);return;}
  status.textContent="候選 "+(d.candidateCount||0)+" 檔 · 可比較 "+d.verifiedComparableCount+
   " 檔 · 涵蓋 "+d.coveragePoints+"/100（尚非全市場排名）";
  for(const stock of d.stocks){
   const card=el("article","","daily-item"),rank=el("div",String(stock.rank),"daily-rank"),
    body=el("div"),points=el("div","","daily-parts"),right=el("div","","daily-score");
   body.append(el("div",(stock.name||"股票")+" "+stock.stock,"daily-name"),
    el("div",stock.date+" · "+stock.market,"daily-sub"));
   for(const [key,label] of [["fundamental","基本"],["news","消息"],["chips","籌碼"],["technical","技術"]]){
    const p=stock.parts[key];points.append(el("span",label+" "+(p.covered?p.earned+"/"+p.covered:"待補")));
   }body.append(points);
   for(const reason of (stock.reasons||[]).slice(0,2))
    body.append(el("p",(reason.reason||reason.name)+"（"+reason.score+"/"+reason.max+" 分）","daily-reason"));
   right.append(el("strong",stock.observedPoints+" 分"),
    el("small","已評項目 · "+stock.coveredPoints+"/100"));
   const button=el("button","查看分析 →","daily-action");button.type="button";
   button.addEventListener("click",()=>{$("ticker").value=stock.stock;$("search").requestSubmit();});
   right.append(button);card.append(rank,body,right);list.append(card);
  }
  await refreshValue((d.stocks||[]).map(x=>x.stock));
 }catch(error){stamp.textContent="暫無資料";status.textContent="今日資料暫未取得，請稍後重新整理。";await refreshValue([]);}
}
const hero=$("hero-image");hero.addEventListener("load",()=>{
 if(hero.naturalWidth>0){hero.hidden=false;$("hero-title").hidden=true;}
});hero.addEventListener("error",()=>{hero.hidden=true;$("hero-title").hidden=false;});
if(hero.complete&&hero.naturalWidth>0){hero.hidden=false;$("hero-title").hidden=true;}
const requested=new URLSearchParams(location.search).get("stock");
if(requested&&/^\d{4,6}$/.test(requested)){$("ticker").value=requested;$("search").requestSubmit();}
refreshDaily();
let width=0;window.addEventListener("resize",()=>{
 const w=Math.round($("kline").getBoundingClientRect().width);
 if(current&&!$("result").hidden&&w!==width){width=w;setupKline($("kline"),$("kline-tip"),current.candles||[]);}
});
