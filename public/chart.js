// 日 K（開高低收）及成交量；只繪製 FinMind 實際回傳並通過數值檢查的交易紀錄。
const n=x=>Number.isFinite(Number(x))?Number(x):null;
export function validCandles(rows){
 return (Array.isArray(rows)?rows:[]).filter(p=>p&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&
  [p.open,p.high,p.low,p.close].every(x=>n(x)>0)&&
  n(p.high)>=Math.max(n(p.open),n(p.close),n(p.low)) &&
  n(p.low)<=Math.min(n(p.open),n(p.close),n(p.high)) &&
  (p.volume===null||n(p.volume)>=0)).sort((a,b)=>a.date.localeCompare(b.date));
}
export function setupKline(canvas,tooltip,raw){
 const rows=validCandles(raw).slice(-70);
 if(rows.length<2){canvas.hidden=true;tooltip.textContent="K 線資料不足：至少需要兩筆有效的每日開高低收紀錄。";return;}
 canvas.hidden=false;const width=Math.max(320,Math.round(canvas.getBoundingClientRect().width||320));
 const scale=Math.min(2,window.devicePixelRatio||1),height=350;
 canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
 const ctx=canvas.getContext("2d");ctx.setTransform(scale,0,0,scale,0,0);
 const left=55,right=12,top=22,priceBottom=265,volTop=285,volBottom=324,plot=width-left-right;
 const lo=Math.min(...rows.map(r=>r.low)),hi=Math.max(...rows.map(r=>r.high)),pad=Math.max((hi-lo)*.08,hi*.003,0.1);
 const bottom=lo-pad,upper=hi+pad,rate=(priceBottom-top)/(upper-bottom),y=v=>priceBottom-(v-bottom)*rate;
 const slot=plot/rows.length,volMax=Math.max(1,...rows.map(r=>r.volume||0));
 ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);ctx.font="12px system-ui,sans-serif";ctx.textAlign="right";ctx.textBaseline="middle";
 for(let i=0;i<=4;i++){const val=bottom+(upper-bottom)*i/4,Y=y(val);ctx.strokeStyle="#e9eeeb";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,Y);ctx.lineTo(width-right,Y);ctx.stroke();ctx.fillStyle="#71837a";ctx.fillText(val.toFixed(val<10?2:1),left-8,Y);}
 ctx.textAlign="center";ctx.textBaseline="top";
 const ticks=[0,Math.floor((rows.length-1)/2),rows.length-1];for(const i of ticks){const X=left+(i+.5)*slot;ctx.fillStyle="#7b8b80";ctx.fillText(rows[i].date.slice(5),X,330);}
 const up="#ad7771",down="#78998a";ctx.lineWidth=1;rows.forEach((r,i)=>{
  const x=left+(i+.5)*slot,c=r.close>=r.open?up:down;
  ctx.strokeStyle=c;ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(x,y(r.high));ctx.lineTo(x,y(r.low));ctx.stroke();
  const a=y(r.open),b=y(r.close),bodyW=Math.max(2,slot*.64);ctx.fillRect(x-bodyW/2,Math.min(a,b),bodyW,Math.max(1,Math.abs(a-b)));
  if(r.volume!==null){const h=(r.volume/volMax)*(volBottom-volTop);ctx.globalAlpha=.68;ctx.fillRect(x-bodyW/2,volBottom-h,bodyW,h);ctx.globalAlpha=1;}
 });
 ctx.textAlign="left";ctx.textBaseline="top";ctx.fillStyle="#85938b";ctx.fillText("日 K · 成交股數",left,3);
 const hit=event=>{const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*width/rect.width;
  const i=Math.floor((x-left)/slot);if(i<0||i>=rows.length)return;
  const p=rows[i];tooltip.textContent=p.date+"　開 "+p.open+"　高 "+p.high+"　低 "+p.low+"　收 "+p.close+"　量 "+(p.volume===null?"缺資料":p.volume.toLocaleString("zh-TW")+" 股");
 };
 canvas.onpointermove=hit;canvas.onpointerdown=hit;
 const p=rows.at(-1);tooltip.textContent=p.date+"　開 "+p.open+"　高 "+p.high+"　低 "+p.low+"　收 "+p.close+"　量 "+(p.volume===null?"缺資料":p.volume.toLocaleString("zh-TW")+" 股");
}
