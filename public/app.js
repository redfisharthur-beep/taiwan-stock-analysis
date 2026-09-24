import {setupKline} from "./chart.js";
const byId = id => document.getElementById(id);
const node = (tag, text, cls) => { const e=document.createElement(tag); e.textContent=String(text??""); if(cls)e.className=cls; return e; };
let current=null;
function info(el,text,bad=false){el.textContent=text;el.className="notice"+(bad?" bad":"");}
function partCard(title,group){
 const box=node("section",null,"panel"),head=node("div",null,"card-head");
 head.append(node("h3",title),node("span",group.earned+" / "+group.max+" 分；已涵蓋 "+group.covered,"pill"));box.append(head);
 for(const p of group.items){const row=node("div",null,"row"),line=node("div",null,"row-head");
 line.append(node("span",p.name),node("strong",p.score===null?"資料不足":p.score+" / "+p.max));
 const val=p.value===null?"":typeof p.value==="object"?JSON.stringify(p.value):p.value;
 row.append(line,node("small",val),node("small",(p.source||"無資料來源")+" · "+(p.date||"日期未定")+" · "+p.note));
 const bar=node("div",null,"bar"),fill=node("div",null,"fill");fill.style.width=(p.score===null?0:p.score/p.max*100)+"%";
 bar.append(fill);row.append(bar);box.append(row);}return box;
}
function source(parent,label,url){const r=node("div",label+" ","source-line");
 if(url){const link=node("a","開啟原始來源 ↗");link.href=url;link.target="_blank";link.rel="noopener noreferrer";r.append(link);}parent.append(r);}
function present(d){
 current=d;byId("result").hidden=false;
 setupKline(byId("kline"),byId("kline-tip"),d.candles||[]);byId("market").textContent=d.market+" · "+d.stock;
 byId("stock-name").textContent=(d.name||"股票")+" "+d.stock;byId("asof").textContent="系統查詢時間（UTC） "+d.asOf;
 byId("close").textContent=d.finmind.close.toLocaleString("zh-TW");byId("price-date").textContent="行情日期 "+d.finmind.date;
 info(byId("verify"),"官方行情比對："+d.verification.state+"。"+d.verification.note,d.verification.state==="不一致");
 const overview=byId("overview");overview.replaceChildren();
 for(const [name,value] of [["四大面向完整分數",d.score.score===null?"未完成":d.score.score+" / 100"],["已涵蓋權重",d.score.coveredPoints+" / 100"],["已評子項小計",d.score.observedPoints+" 分"]]){
 const item=node("div",null,"metric");item.append(node("span",name),node("b",value));overview.append(item);}
 byId("warnings").textContent=d.sourceWarnings.length?"來源提示："+d.sourceWarnings.join("；"):"來源沒有回報額外連線錯誤。";
 const sections=byId("parts");sections.replaceChildren();
 for(const [key,name] of [["fundamental","基本面 · 50%"],["news","消息面 · 10%"],["chips","籌碼面 · 20%"],["technical","技術分析 · 20%"]])sections.append(partCard(name,d.score.parts[key]));
 byId("goodinfo").href=d.links.goodinfo;byId("good-date").value=d.finmind.date;byId("good-price").value="";
 info(byId("compare-out"),"尚未進行 Goodinfo 人工核對。");
 const sources=byId("sources");sources.replaceChildren();
 source(sources,"FinMind：歷史行情、月營收、財報與法人交易；最近行情日 "+d.finmind.date,"https://finmindtrade.com/");
 if(d.official)source(sources,d.official.source+"：官方行情；資料日期 "+(d.official.date||"官方未提供"),d.official.url);
 source(sources,"Goodinfo：由使用者人工核對；不自動擷取、不加入評分。",d.links.goodinfo);
 source(sources,"公開資訊觀測站：公司正式公告",d.links.mops);
 history.replaceState(null,"","?stock="+encodeURIComponent(d.stock));
}
byId("search").addEventListener("submit",async event=>{
 event.preventDefault();const stock=byId("ticker").value.trim();
 if(!/^\d{4,6}$/.test(stock)){byId("status").textContent="請輸入 4～6 位數股票代號。";return;}
 const button=byId("submit");button.disabled=true;byId("status").textContent="正在核對資料…";byId("result").hidden=true;
 try{const res=await fetch("/api/analyze?stock="+encodeURIComponent(stock));const data=await res.json();
 if(!res.ok)throw Error([data.error,...(data.warnings||[])].filter(Boolean).join("；"));
 present(data);refreshDaily();byId("status").textContent="資料已載入。請查看實際行情日期、資料覆蓋率及官方核對狀態。";
 }catch(err){byId("status").textContent="查詢未完成："+err.message;}finally{button.disabled=false;}
});
byId("compare-btn").addEventListener("click",()=>{
 if(!current)return;const date=byId("good-date").value,raw=byId("good-price").value,value=Number(raw);
 if(!date||!raw||!Number.isFinite(value)||value<=0){info(byId("compare-out"),"請輸入原站顯示的有效日期與收盤價。",true);return;}
 if(date!==current.finmind.date){info(byId("compare-out"),"不可跨日比對：Goodinfo "+date+"／FinMind "+current.finmind.date,true);return;}
 if(current.verification.state==="不一致"){info(byId("compare-out"),"官方與 FinMind 已有價格衝突，請先確認官方資料。",true);return;}
 const equal=Math.abs(value-current.finmind.close)<0.0001;
 info(byId("compare-out"),equal?"人工輸入值與 FinMind 同日價格相同；不代表已完成 Goodinfo 自動驗證。":"同日價格不同，差額 "+(value-current.finmind.close).toFixed(2)+" 元；請檢查股價種類、日期與輸入值。",!equal);
});
const prefill=new URLSearchParams(location.search).get("stock");
if(prefill&&/^\d{4,6}$/.test(prefill)){byId("ticker").value=prefill;byId("search").requestSubmit();}

async function refreshDaily(){
 const status=byId("daily-status"),list=byId("daily-list"),stamp=byId("daily-date");
 try{
  const res=await fetch("/api/top5",{headers:{"Accept":"application/json"}});
  if(!res.ok)throw Error("資料服務回傳 "+res.status);
  const d=await res.json();list.replaceChildren();
  stamp.textContent=d.marketDate?"行情 "+d.marketDate:"尚無有效行情日";
  if(!d.ready){status.textContent=d.reason||"排行榜資料庫尚未設定。";return;}
  if(!d.stocks?.length){status.textContent=d.reason||"無足夠且同交易日、相同覆蓋率的股票可供比較。";return;}
  status.textContent=(d.published?"全市場經驗證完整評分；":"已查詢股票的同日可比較樣本；非全市場前五、非完整100分。")+
   "比較樣本 "+d.verifiedComparableCount+" 檔；已收錄查詢資料 "+d.analyzedCount+" 檔；"+
   (d.published?"四大面向皆已覆蓋。":"共同已涵蓋權重 "+d.coveragePoints+"/100。");
  for(const s of d.stocks){
    const card=node("article",null,"daily-item"),rank=node("div","#"+s.rank,"daily-rank"),
      body=node("div"),title=node("div",(s.name||"股票")+" "+s.stock,"daily-name"),
      sub=node("div",(s.market||"市場未明")+" · 行情日期 "+s.date,"daily-sub"),
      points=node("div",null,"daily-parts"),score=node("div",null,"daily-score");
    for(const [key,label] of [["fundamental","基本面"],["news","消息面"],["chips","籌碼面"],["technical","技術分析"]]){
      const p=s.parts[key];points.append(node("span",label+" "+p.earned+" / "+p.max+"（涵蓋 "+p.covered+"）"));
    }
    body.append(title,sub,points);
    if(s.reasons?.length){for(const reason of s.reasons.slice(0,4)){
      let value=reason.value===null?"":typeof reason.value==="object"?JSON.stringify(reason.value):String(reason.value);
      body.append(node("p",reason.name+"："+value+"；依已公布的研究規則獲 "+reason.score+"/"+reason.max+" 分。"+reason.note+"（"+(reason.source||"來源未明")+"，"+(reason.date||"日期未明")+"）","daily-reason"));
    }}else body.append(node("p","目前沒有完成驗證的高分理由可列；請先補齊資料。","daily-reason"));
    score.append(node("span",s.score===null?s.observedPoints+" 分":s.score+" / 100"),
      node("small",s.score===null?"子項小計 · 涵蓋 "+s.coveredPoints+"/100":"完整綜合得分"));
    const action=node("button","查看完整明細 →","daily-action");action.type="button";action.addEventListener("click",()=>{
      byId("ticker").value=s.stock;byId("search").requestSubmit();
      byId("search").scrollIntoView({behavior:"smooth",block:"start"});
    });
    score.append(action);card.append(rank,body,score);list.append(card);
  }
 }catch(err){stamp.textContent="資料未取得";status.textContent="無法取得當日榜單："+err.message;list.replaceChildren();}
}
refreshDaily();
let lastWidth=0;
window.addEventListener("resize",()=>{
 const width=Math.round(byId("kline").getBoundingClientRect().width||0);
 if(width!==lastWidth&&current&&byId("result").hidden===false){lastWidth=width;setupKline(byId("kline"),byId("kline-tip"),current.candles||[]);}
});
