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
 const broker=d.brokerVerification||{state:"not_configured"};
 const brokerLabels={matched:"永豐完整日線與官方／FinMind 同日收盤一致（不重複給分）",
  mismatch:"永豐完整日線與其他來源同日價格有差異，保留官方及FinMind原始分數",
  finmind_missing:"永豐資料有取得，但FinMind同日原始行情不足，未視為三方一致",
  different_date:"永豐未取得同一已完成交易日，不比較不同日期",
  unavailable:"永豐歷史行情暫不可用，原本分析照常進行",
  not_configured:"永豐連線尚未設定完整",
  invalid_data:"永豐回傳資料格式異常，不加入分析",
  not_checked:"本次尚未執行永豐歷史資料核對"};
 health.append(el("p","永豐 Shioaji 後端自動核對："+(brokerLabels[broker.state]||"核對未完成")+
   (broker.useInPublicScoring?" · 已允許使用核對後券商日線作技術資料後備":
    " · 未核准公開再展示時不把私人券商行情帶入公開計分"),"muted"));
 if(broker.indicatorReview){
  const check=broker.indicatorReview;
  health.append(el("p","永豐技術指標交叉核對："+(
   check.state==="consistent"?"同日同價格口徑，已核對 "+check.matched+" 項指標一致":
   check.state==="differences"?"已核對 "+check.checked+" 項，其中 "+check.matched+" 項在容許誤差內一致；請查看差異":
   check.reason||"價格口徑不同，不能直接比較")+"。"+(check.reason||""),"muted"));
 }
 const mode=d.score?.technicalMode||"unavailable";
 health.append(el("p","技術分析資料："+(mode==="adjusted"?"使用還原價":
  mode==="raw"?"使用FinMind未還原日行情（除權息可能影響指標）":
  mode==="broker_raw"?"使用經同日核對的永豐未還原分K彙整日線（不含未驗證單位的成交量）":"歷史行情不足，尚未計分"),"muted"));
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
 const btn=$("submit");btn.disabled=true;$("status").hidden=false;$("status").textContent="正在整理最新資料…";$("result").hidden=true;
 try{
  const response=await fetch("/api/analyze?stock="+encodeURIComponent(stock));
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"資料取得失敗");
  present(data);$("status").textContent="";$("status").hidden=true;
  $("result").scrollIntoView({behavior:"smooth",block:"start"});
 }catch(error){$("status").textContent="查詢未完成："+error.message;}finally{btn.disabled=false;}
});
const showNumber=n=>Number.isFinite(n)?n.toLocaleString("zh-TW"):"—";
const showMetric=(n,unit="")=>typeof n==="number"&&Number.isFinite(n)?showNumber(n)+unit:"待查";
function addChecks(parent,checks=[]){
 const list=el("div","","daily-checks");
 for(const check of checks){
  const state=["pass","fail","unknown"].includes(check.status)?check.status:"unknown";
  const word=state==="pass"?"符合":state==="fail"?"未達":"待查";
  list.append(el("span",check.label+" · "+word,"daily-check "+state));
 }
 parent.append(list);
}
function renderStockCard(stock){
 const card=el("article","","daily-item"),rank=el("div",String(stock.rank),"daily-rank"),
  body=el("div"),right=el("div","","daily-score"),screen=stock.screening||{};
 const name=el("div","","daily-name");
 name.append(document.createTextNode((stock.name||"股票")+" "+stock.stock));
 if(stock.valuationFlag==="undervalued"){
  const badge=el("span","被低估","value-tag");badge.title="符合本站相對估值及已取得財報條件，並非內在價值估算或買入建議";
  name.append(badge);
 }
 body.append(name,el("div",stock.market+" · 最近收盤 "+showMetric(stock.close," 元"),"daily-sub"));
 const tags=el("div","","daily-parts");
 tags.append(el("span","本益比 "+showMetric(screen.per," 倍")),
  el("span","淨值比 "+showMetric(screen.pbr," 倍")),
  el("span","殖利率 "+showMetric(screen.dividendYield,"%")));
 body.append(tags);
 if(stock.financials){
  const f=stock.financials;
  const summary=el("p","財報："+(f.reportPeriod||"報告期未明")+
   "｜EPS "+showMetric(f.eps," 元")+"｜營業現金流 "+(f.operatingCashFlow===null?"待查":f.operatingCashFlow>0?"為正":f.operatingCashFlow===0?"持平":"為負")+
   "｜負債比 "+showMetric(f.debtRatioPct,"%"),"daily-reason");
  body.append(summary);
 }else body.append(el("p","財報尚待核對，不能只憑低本益比判斷價值。","daily-reason"));
 addChecks(body,stock.checks||[]);
 if(stock.valuationFlag!=="undervalued"&&stock.valuationNote)
  body.append(el("p",stock.valuationNote,"daily-reason"));
 right.append(el("strong",showMetric(stock.close," 元")),
  el("small",stock.detailVerified?"資料已交叉核對":"個股詳細資料待補"));
 const button=el("button","查看分析 →","daily-action");
 button.type="button";
 button.addEventListener("click",()=>{$("ticker").value=stock.stock;$("search").requestSubmit();});
 right.append(button);card.append(rank,body,right);return card;
}
async function refreshDaily(){
 const status=$("daily-status"),list=$("daily-list");
 list.replaceChildren();status.hidden=true;status.textContent="";
 try{
  const response=await fetch("/api/top5");
  const d=await response.json();
  if(!response.ok)throw Error(d.reason||"資料服務暫不可用");
  const rows=d.stocks||[];
  if(!rows.length){status.textContent=d.reason||"暫無符合價格與成交條件的股票。";status.hidden=false;return;}
  for(const stock of rows)list.append(renderStockCard(stock));
  if(!d.universe?.marketComplete){
   status.textContent="部分市場或公司名冊資料尚未齊備；請以個股來源為準。";status.hidden=false;
  }
 }catch(error){status.textContent="每日觀察暫時無法更新："+error.message;status.hidden=false;}
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
