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
 current=d;byId("result").hidden=false;byId("market").textContent=d.market+" · "+d.stock;
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
 present(data);byId("status").textContent="資料已載入。請查看實際行情日期、資料覆蓋率及官方核對狀態。";
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
