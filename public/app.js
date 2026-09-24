import {setupKline} from "./chart.js";
const $=id=>document.getElementById(id);
const el=(tag,text="",cls="")=>{const x=document.createElement(tag);x.textContent=String(text??"");if(cls)x.className=cls;return x;};
const fmt=value=>typeof value==="object"&&value!==null?
 Object.entries(value).map(([k,v])=>k+" "+(v??"待查")).join("、"):String(value??"—");
let current=null;
function message(node,text,bad=false){node.textContent=text;node.className="notice"+(bad?" bad":"");}
const numberText=(n,unit="")=>typeof n==="number"&&Number.isFinite(n)?
 n.toLocaleString("zh-TW",{maximumFractionDigits:2})+unit:"待查";
const metricDetails=item=>{
 const v=item.value,rows=[];
 const add=(label,value,note="",unit="")=>{
  if(value!==null&&value!==undefined&&value!=="")
   rows.push({label,value:typeof value==="number"?numberText(value,unit):String(value),note});
 };
 switch(item.name){
 case "單月營收年增率": {
  const yoy=Number.parseFloat(v);
  add("",v,Number.isFinite(yoy)?yoy>0?"營收較去年同月增加":yoy<0?"營收較去年同月減少":"營收與去年同月持平":"與去年同月比較");
  break;
 }
 case "EPS 與去年同季":
  add("每股盈餘",v?.eps,"本季每股獲利"," 元");
  add("年增率",v?.yoyPct,"與去年同季比較","%");break;
 case "營業現金流（初步）":
  add("",v,"本期營業現金流");break;
 case "獲利品質與負債":
  add("現金轉換倍數",v?.cashConversion,"營業現金流 ÷ 稅前淨利"," 倍");
  add("負債比",v?.debtRatioPct,"總負債占總資產","%");break;
 case "估值／本益比":
  add("本益比",v?.per,"股價 ÷ 每股盈餘"," 倍");
  add("近一年分位",v?.oneYearPercentile,"相對自身近一年本益比","%");break;
 case "均線趨勢":
  add("收盤價",v?.close,typeof v?.ma20==="number"?
   (v.close>v.ma20?"高於20日均線":v.close<v.ma20?"低於20日均線":"與20日均線持平"):"最新收盤價");
  add("20日均線",v?.ma20,typeof v?.ma60==="number"?
   (v.ma20>v.ma60?"高於60日均線":v.ma20<v.ma60?"低於60日均線":"與60日均線持平"):"近20日平均收盤價");
  add("60日均線",v?.ma60,"近60日平均收盤價");break;
 case "RSI(14)":
  add("",v,typeof v==="number"?(v>=70?"動能偏強":v<=30?"動能偏弱":"動能介於30至70之間"):"14日動能指標");break;
 case "MACD":
  add("MACD",v?.macd,typeof v?.signal==="number"?
   (v.macd>v.signal?"高於訊號線":v.macd<v.signal?"低於訊號線":"與訊號線持平"):"短長期均線動能差");
  add("訊號線",v?.signal,"觀察動能交叉");break;
 case "量價":
  add("",v,typeof v==="number"?(v>1?"成交量高於近20日平均":v<1?"成交量低於近20日平均":"成交量等於近20日平均"):"當日量 ÷ 近20日均量"," 倍");break;
 case "波動幅度與60日最大回撤":
  add("20日年化波動率",v?.annualizedVolatility20Pct,"數值越高，近期價格起伏越大","%");
  add("60日最大回撤",v?.maxDrawdown60Pct,"近60日自高點的最大跌幅","%");break;
 case "法人近五日淨買賣／成交量":
  add("五日法人買賣超",v?.netShares,typeof v?.netShares==="number"?
   (v.netShares>0?"近五個已公布交易日淨買超":v.netShares<0?"近五個已公布交易日淨賣超":"近五日買賣持平"):"五個已公布交易日合計"," 股");
  add("同期成交量",v?.totalShares,"五個已公布交易日合計"," 股");
  add("法人買賣超占比",v?.ratioPct,"淨買賣超 ÷ 同期成交量","%");break;
 case "400張以上持股三週趨勢":
  add("大戶持股占比",v?.holderPct,"最近一週400張以上持股","%");
  add("近三週變化",v?.changeTwoWeeksPct,typeof v?.changeTwoWeeksPct==="number"?
   (v.changeTwoWeeksPct>0?"大戶持股占比增加":v.changeTwoWeeksPct<0?"大戶持股占比減少":"大戶持股占比持平"):"與兩週前比較"," 個百分點");break;
 case "融資餘額變化":
  add("",v,typeof v==="number"?(v>0?"融資餘額增加":v<0?"融資餘額減少":"融資餘額持平"):"單日融資餘額變化");break;
 case "消息事件調整":
  add("",item.score??0,item.score>0?"已核實正面事件加分":
   item.score<0?"已核實負面事件扣分":"無加減分事件"," 分");break;
 default:
  if(v!==null&&v!==undefined)add("",fmt(v));
 }
 return rows;
};
function groupCard(name,part,holdingStatus=null){
 const box=el("section","","panel score-card"),head=el("div","","card-head");
 const isNews=name==="消息面";
 const delta=part.items.find(i=>i.name==="消息事件調整")?.score??0;
 head.append(el("h3",name),el("span",isNews?
  "消息加減 "+(delta>0?"+":"")+delta+" 分":
  numberText(part.earned)+" / "+part.max+" 分 · 計分資料 "+part.covered+"/"+part.max,"pill"));
 box.append(head);
 const details=el("div","","score-detail");
 for(const item of part.items){
  const row=el("section","","score-row"),label=el("div","","row-head");
  label.append(el("span",item.name));
  if(!isNews)label.append(el("strong",item.score===null?"待查":item.score+" / "+item.max+" 分"));
  row.append(label);
  for(const entry of metricDetails(item)){
   const metric=el("div","","score-metric");
   metric.append(el("strong",(entry.label?entry.label+" ":"")+entry.value));
   if(entry.note)metric.append(el("small",entry.note));
   row.append(metric);
  }
  if(item.score===null){
   const reason=item.name==="400張以上持股三週趨勢"?"尚缺三期可核實的每週集保持股資料":
    item.name==="量價"?"近20日成交量不足":
    item.name==="EPS 與去年同季"?"同季 EPS 歷史資料不足":"來源資料不足";
   row.append(el("small",reason,"metric-pending"));
  }
  details.append(row);
 }
 box.append(details);
 return box;
}
function sourceRow(parent,label,url){source(parent,label,url);}
function source(parent,label,url){
 const row=el("div",label+" ","source-line");
 if(url){const a=el("a","查看 ↗");a.href=url;a.target="_blank";a.rel="noopener noreferrer";row.append(a);}parent.append(row);
}

const nval=(n,unit="")=>typeof n==="number"&&Number.isFinite(n)?n.toLocaleString("zh-TW",{maximumFractionDigits:2})+unit:"待查";
function renderFinancials(d){
 const target=$("financial-grid");target.replaceChildren();
 const f=d.financialInsights||{},basic=d.score?.parts?.fundamental?.items||[];
 const pick=name=>basic.find(x=>x.name===name)||{};
 const eps=pick("EPS 與去年同季"),revenue=pick("單月營收年增率"),
  cash=pick("營業現金流（初步）"),quality=pick("獲利品質與負債");
 const metrics=[
  ["每股盈餘 EPS",eps.value?.eps," 元",eps.date,"每股獲利；請與去年同季比較"],
  ["EPS 年增率",eps.value?.yoyPct,"%",eps.date,"反映每股獲利相對去年同季變化"],
  ["單月營收年增率",f.monthlyRevenueYoY??Number.parseFloat(revenue.value),"%",f.revenueDate||revenue.date,"與去年同月比較；單月波動不代表獲利"],
  ["毛利率",f.grossMargin,"%",f.incomeDate,"同一報表期毛利／營收"],
  ["營業利益率",f.operatingMargin,"%",f.incomeDate,"同一報表期營業利益／營收"],
  ["淨利率",f.netMargin,"%",f.incomeDate,f.missingReasons?.netMargin||"同一期淨利／營收"],
  ["報表期 ROE（簡化）",f.quarterlyRoe,"%",f.incomeDate,f.missingReasons?.quarterlyRoe||"同一期淨利／權益；非年化"],
  ["流動比率",f.currentRatio," 倍",f.balanceDate,"流動資產／流動負債；金融業口徑不同"],
  ["負債比",quality.value?.debtRatioPct??f.debtRatio,"%",quality.date||f.balanceDate,"負債／總資產；需參照產業特性"],
  ["營業現金流",cash.value??f.operatingCashFlow,"",cash.date||f.cashDate,"公開財報原始單位；可能為年初至當季累計"],
  ["現金／稅前淨利",quality.value?.cashConversion," 倍",quality.date,"期間須一致，並非每股現金流"],
  ["本益比",d.valuationLatest?.per," 倍",d.valuationLatest?.date,"估值指標，非股票合理價"]
 ];
 for(const [label,value,unit,date,note] of metrics){
  const box=el("div","","financial-item");
  const display=label==="營業現金流"&&typeof value==="number"?
   (value>0?"正值":value<0?"負值":"零")+"（金額詳見來源）":nval(value,unit);
  box.append(el("span",label),el("strong",display));
  if(display==="待查"&&note)box.append(el("small",note));
  // Reporting dates and source methodology remain in the data-health panel and API, not repeated here.
  target.append(box);
 }
}
function renderComparison(d){
 const target=$("compare-list");target.replaceChildren();
 const comp=d.industryComparison;
 $("compare-status").textContent=!comp?.items?.length?(comp?.reason||"尚無同業比較資料"):"";
 $("compare-status").hidden=!!comp?.items?.length;
 if(!comp?.items?.length)return;
 for(const item of comp.items){
  const box=el("div","","compare-item");
  box.append(el("span",item.label),el("strong",nval(item.value,item.unit)));
  if(item.pr!==null&&Number.isFinite(item.pr))box.append(el("span","PR "+item.pr+" · 同業 "+item.sample+" 檔","pill"));
  else box.append(el("small","PR 待查 · 有效同業 "+item.sample+" 檔"));
  // Individual dates and methodology remain available in the API, not repeated on every card.
  target.append(box);
 }
}
function present(d){
 current=d;$("result").hidden=false;
 $("market").textContent=d.market;
 $("stock-name").textContent=(d.name||"股票")+" "+d.stock;
 $("asof").textContent="查詢時間："+new Date(d.asOf).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"});
 $("close").textContent=d.finmind.close.toLocaleString("zh-TW");
 $("price-date").textContent="行情 "+d.finmind.date;
 $("verify").hidden=d.verification?.state==="一致";
 if(!$("verify").hidden)message($("verify"),"行情來源待核對："+d.verification.state,d.verification.state==="不一致");
 const isFund=d.kind==="etf";
 $("comparison-panel").hidden=isFund;
 $("financial-panel").hidden=isFund;
 $("evidence-panel").hidden=isFund;
 if(!isFund){renderFinancials(d);renderComparison(d)}
  const stats=$("overview");stats.replaceChildren();
 const displayedStats=isFund?[
  ["產品類別","ETF"],["分析範圍","市場價量"],["收盤日期",d.finmind.date]
 ]:[
  ["基本面",d.score.parts.fundamental.earned+" / 40"],
  ["技術面",d.score.parts.technical.earned+" / 30"],
  ["籌碼面",d.score.parts.chips.earned+" / 30"],
  ["消息加減",(d.score.newsDelta>0?"+":"")+(d.score.newsDelta??0)+" 分"],
  ["綜合分數",d.score.score===null?"待核實；已計 "+numberText(d.score.observedPoints)+" 分":numberText(d.score.score)+" / 100"],
  ["計分資料涵蓋",d.score.coveragePercent+"%"]
 ];
 for(const [name,value] of displayedStats){
  const x=el("div","","metric");x.append(el("span",name),el("b",value));stats.append(x);
 }
 $("warnings").textContent="";$("warnings").hidden=true;
 setupKline($("kline"),$("kline-tip"),d.candles||[]);
 const parts=$("parts");parts.replaceChildren();
 if(isFund){
  parts.append(groupCard("ETF 價量技術",d.score.parts.technical));
 }else for(const [key,label] of [["fundamental","基本面"],["news","消息面"],["chips","籌碼面"],["technical","技術分析"]])
  parts.append(groupCard(label,d.score.parts[key],d.holdingStatus));
 const news=d.newsResearch||{status:"unverified",events:[],checked:[]};
 $("news-status").textContent=news.status==="corroborated_event"?
  "官方公告＋獨立媒體核對："+(news.impact||"影響待觀察")+"（非股價預測）":
  news.status==="official_event_only"?"已取得官方重大公告，獨立新聞尚待核實":
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
   ev.append(el("h4","近期重點新聞 · 原文連結（公開標題線索，尚未交叉核實）"));
   for(const article of discovery.articles.slice(0,5)){
    const row=el("div","","source-line"),link=el("a",article.title);
    link.href=article.url;link.target="_blank";link.rel="noopener noreferrer";
    row.append(link,el("small"," · "+article.publisher+" · 首次發現 "+article.date+" · 非全文核實"));ev.append(row);
   }
 }
 const checked=$("news-source-status");checked.replaceChildren();
 for(const source of (news.checked||[])){
  if(source.status==="other_market"||source.status==="not_connected")continue;
  const name=source.name;
  const status=source.status==="checked"?"已讀取官方公告":
   source.status==="provided"?"已取得授權新聞資料":
   source.status==="discovered"?"已找到公開新聞標題與原文連結（未取得全文授權）":
   source.status==="unavailable"?"暫無法讀取":
   source.status==="other_market"?"另一市場，非本股來源":
   source.status==="reference_only"?"非獨立消息證據":"尚未連結授權新聞";
  sourceRow(checked,name+"："+status,source.url);
 }
 const sources=$("sources");sources.replaceChildren();
 const health=$("data-health");health.replaceChildren();
 if(d.holdingStatus&&d.holdingStatus.code!=="verified")
  health.append(el("p","集保持股："+d.holdingStatus.reason,"muted"));
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
   dataset.status==="empty"?"本次查無資料":
   dataset.status==="skipped"?"批次模式略過":"取得失敗";
  health.append(el("p",dataset.name+"："+
   status+(dataset.latestDate?" · 最新 "+dataset.latestDate:"")+
   (dataset.status==="ok"?"":" · "+dataset.message),"muted"));
 }
 // Each unavailable input remains listed in its own analysis card and source diagnostics.
 source(sources,"FinMind · "+d.finmind.date,"https://finmindtrade.com/");
 if(d.official)source(sources,d.official.source+" · "+(d.official.date||"日期未提供"),d.official.url);
 source(sources,"公開資訊觀測站（事件須核實才計分）",d.links.mops);
 for(const warning of d.sourceWarnings||[])sources.append(el("p","資料更新提示："+warning,"muted"));
 history.replaceState(null,"","?stock="+encodeURIComponent(d.stock));
}
const searchBox=$("ticker"),suggestions=$("suggestions");
let pendingLookup=0,lookupTimer=null,lookupController=null;
const setSearchStatus=text=>{$("status").textContent=text;$("status").hidden=!text;};
const clearSuggestions=()=>{suggestions.replaceChildren();suggestions.hidden=true;};
async function searchMatches(query){
 const response=await fetch("/api/search?q="+encodeURIComponent(query));
 if(!response.ok)throw Error("股票搜尋暫時不可用");
 const data=await response.json();return data.results||[];
}
function showSuggestions(rows){
 clearSuggestions();
 for(const row of rows.slice(0,12)){
  const option=el("button",row.stock+"  "+row.name+" · "+row.market,"suggestion");
  option.type="button";option.setAttribute("role","option");
  option.addEventListener("click",()=>{searchBox.value=row.stock;clearSuggestions();$("search").requestSubmit();});
  suggestions.append(option);
 }
 suggestions.hidden=!suggestions.childElementCount;
}
searchBox.addEventListener("input",()=>{
 const query=searchBox.value.trim();const seq=++pendingLookup;
 clearTimeout(lookupTimer);if(lookupController)lookupController.abort();clearSuggestions();setSearchStatus("");
 if(query.length<1)return;
 lookupTimer=setTimeout(async()=>{
  try{
   lookupController=new AbortController();
   const response=await fetch("/api/search?q="+encodeURIComponent(query),{signal:lookupController.signal});
   if(!response.ok)throw Error("搜尋暫不可用");
   const data=await response.json();
   if(seq===pendingLookup&&searchBox.value.trim()===query)showSuggestions(data.results||[]);
  }catch(error){if(error.name!=="AbortError"&&seq===pendingLookup)setSearchStatus("股票名冊暫無法查詢");}
 },200);
});
$("search").addEventListener("submit",async e=>{
 e.preventDefault();let stock=searchBox.value.trim();
 if(!/^[0-9]{4,6}$/.test(stock)){
  try{
   const rows=await searchMatches(stock);
   if(!rows.length){setSearchStatus("找不到符合的股票名稱或代號");return;}
   const exact=rows.filter(x=>x.name===stock||x.stock===stock);
   if(exact.length===1)stock=exact[0].stock;
   else if(rows.length===1)stock=rows[0].stock;
   else{showSuggestions(rows);setSearchStatus("請從下方結果選擇股票");return;}
  }catch(error){setSearchStatus(error.message);return;}
 }
 if(!/^[0-9]{4,6}$/.test(stock)){setSearchStatus("請選擇上市或上櫃股票");return;}
 const btn=$("submit");btn.disabled=true;setSearchStatus("正在整理資料…");$("result").hidden=true;clearSuggestions();
 try{
  const response=await fetch("/api/analyze?stock="+encodeURIComponent(stock));
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"資料取得失敗");
  searchBox.value=stock;present(data);setSearchStatus("");
  $("result").scrollIntoView({behavior:"smooth",block:"start"});
 }catch(error){setSearchStatus("查詢未完成："+error.message);}finally{btn.disabled=false;}
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
 const card=el("article","","daily-item"),rank=el("div",String(stock.rank),"daily-rank");
 const body=el("div"),right=el("div","","daily-score");
 const etf=stock.kind==="etf";
 body.append(el("div",(stock.name||"標的")+" "+stock.stock,"daily-name"),
  el("div",stock.market,"daily-sub"));
 const tags=el("div","","daily-parts");
 if(etf){
  tags.append(el("span","ETF · 價量技術 "+numberText(stock.technicalScore)+" / 30"),
   el("span","適用模型折算 "+numberText(stock.score)+" / 100"));
 }else{
  for(const [label,key,max] of [["基本面","fundamental",40],["技術面","technical",30],["籌碼面","chips",30]]){
   const part=stock.parts?.[key];
   tags.append(el("span",label+" "+numberText(part?.earned)+" / "+max));
  }
 }
 body.append(tags);
 right.append(el("strong",numberText(stock.score)+" / 100"));
 right.append(el("small",showMetric(stock.close,etf?"":" 元")));
 const button=el("button","分析","daily-action");
 button.type="button";
 button.addEventListener("click",()=>{$("ticker").value=stock.stock;$("search").requestSubmit();});
 right.append(button);card.append(rank,body,right);return card;
}
async function refreshDaily(){
 const status=$("daily-status"),list=$("daily-list");
 list.replaceChildren();status.hidden=false;status.textContent="正在讀取完整評分名單…";
 try{
  const response=await fetch("/api/observations");
  const d=await response.json();
  if(!response.ok)throw Error(d.reason||"研究服務暫不可用");
  const rows=(d.stocks||[]).filter(x=>typeof x.score==="number"&&
    x.coveredPoints===100).slice(0,5);
  status.textContent=d.reason||"";
  status.hidden=!status.textContent;
  for(const stock of rows)list.append(renderStockCard(stock));
  if(!rows.length){
   status.hidden=false;
   status.textContent=d.reason||"尚無資料涵蓋完整、來源已核實的標的，暫不顯示名單。";
  }
 }catch(error){status.textContent="觀察名單暫無法更新："+error.message;status.hidden=false;}
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
