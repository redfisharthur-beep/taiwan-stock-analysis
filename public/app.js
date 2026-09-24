import {setupKline} from "./chart.js";
const $=id=>document.getElementById(id);
const el=(tag,text="",cls="")=>{const x=document.createElement(tag);x.textContent=String(text??"");if(cls)x.className=cls;return x;};
const fmt=value=>typeof value==="object"?Object.entries(value||{}).map(([k,v])=>k+" "+v).join("、"):String(value??"—");
let current=null;
function message(node,text,bad=false){node.textContent=text;node.className="notice"+(bad?" bad":"");}
function groupCard(name,part){
 const box=el("section","","panel score-card"),head=el("div","","card-head");
 head.append(el("h3",name),el("span",part.covered?part.earned+" / "+part.covered:"待補資料","pill"));box.append(head);
 const highlights=part.items.filter(i=>i.score!==null).sort((a,b)=>b.score/b.max-a.score/a.max).slice(0,2);
 box.append(el("p",highlights.length?highlights.map(i=>i.name+"："+fmt(i.value)).join(" · "):"尚無可核對資料","score-highlights"));
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
function showGoodinfo(d){
 const g=d.goodinfo||{status:"unavailable",message:"Goodinfo 暫時無法取得"};
 const labels={matched:"同日一致",mismatch:"數值不同",different_day:"日期不同",
  unverified:"待核對",unavailable:"暫不可用",not_checked:"未查詢",available:"已取得"};
 $("goodinfo-badge").textContent=labels[g.status]||"待核對";
 const text=g.status==="matched"?"同日收盤價一致 · 官方、FinMind、Goodinfo":
   g.status==="mismatch"?"同日價格不同，請以原始來源確認":
   g.status==="different_day"?"日期不同，暫不比較":
   g.status==="unavailable"?"Goodinfo 暫時無法取得；不影響其他資料顯示":
   g.message||"尚未完成核對";
 message($("goodinfo-result"),text,g.status==="mismatch");
 $("goodinfo").href=g.url||d.links.goodinfo;
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
  ["已評項目",d.score.observedPoints+" 分"],["資料涵蓋",d.score.coveredPoints+" / 100"]]){
  const x=el("div","","metric");x.append(el("span",name),el("b",value));stats.append(x);
 }
 $("warnings").textContent=d.sourceWarnings.length?"部分來源暫未取得，詳見下方明細。":"";
 setupKline($("kline"),$("kline-tip"),d.candles||[]);
 const parts=$("parts");parts.replaceChildren();
 for(const [key,label] of [["fundamental","基本面"],["news","消息面"],["chips","籌碼面"],["technical","技術分析"]])
  parts.append(groupCard(label,d.score.parts[key]));
 showGoodinfo(d);
 const news=d.newsResearch||{status:"unverified",events:[],checked:[]};
 $("news-status").textContent=news.status==="corroborated_event"?
  "已核對："+(news.impact||"影響待觀察")+"（非股價預測）":
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
 if(!ev.children.length)ev.append(el("p","最近沒有可顯示的已取得公告；不代表公司沒有消息。","muted"));
 const checked=$("news-source-status");checked.replaceChildren();
 for(const source of (news.checked||[])){
  const name=source.name==="Goodinfo! 台灣股市資訊網"?"Goodinfo（本頁僅行情核對）":source.name;
  const status=source.status==="checked"?"已讀取官方公告":
   source.status==="provided"?"已收到授權新聞資料":
   source.status==="unavailable"?"暫無法讀取":
   source.status==="reference_only"?"非獨立消息證據":"尚未連結授權新聞";
  sourceRow(checked,name+"："+status,source.url);
 }
 const sources=$("sources");sources.replaceChildren();
 source(sources,"FinMind · "+d.finmind.date,"https://finmindtrade.com/");
 if(d.official)source(sources,d.official.source+" · "+(d.official.date||"日期未提供"),d.official.url);
 source(sources,"Goodinfo · "+(d.goodinfo?.day||"日期未確認"),d.links.goodinfo);
 source(sources,"公開資訊觀測站（目前僅提供原始公告連結，尚未自動評分）",d.links.mops);
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
async function refreshDaily(){
 const status=$("daily-status"),list=$("daily-list"),stamp=$("daily-date");list.replaceChildren();
 try{
  const response=await fetch("/api/top5");if(!response.ok)throw Error("資料服務暫不可用");
  const d=await response.json();stamp.textContent=d.marketDate||"尚無資料";
  if(!d.ready||!d.stocks?.length){status.textContent=d.reason||"目前沒有足夠資料，暫不顯示名單。";return;}
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
    body.append(el("p",reason.name+" · "+reason.score+"/"+reason.max+" 分","daily-reason"));
   right.append(el("strong",stock.observedPoints+" 分"),
    el("small","已評項目 · "+stock.coveredPoints+"/100"));
   const button=el("button","查看分析 →","daily-action");button.type="button";
   button.addEventListener("click",()=>{$("ticker").value=stock.stock;$("search").requestSubmit();});
   right.append(button);card.append(rank,body,right);list.append(card);
  }
  const v=d.value||{stocks:[]},target=$("value-list");
  target.replaceChildren();$("value-date").textContent=d.marketDate||"尚無資料";
  $("value-status").textContent=v.stocks?.length?
    "本次候選 "+(d.candidateCount||0)+" 檔 · 符合初步估值條件 "+v.eligibleCount+
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
 }catch(error){stamp.textContent="暫無資料";status.textContent="今日資料暫未取得，請稍後重新整理。";$("value-status").textContent="價值觀察資料暫不可用。";}
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
