// PR is a within-industry desirability percentile: higher PR always means
// the metric is more favorable under the documented direction. For valuation
// multiples and risk metrics, lower raw values therefore receive higher PR.
const definitions=[
 {key:"per",label:"本益比",unit:"倍",dateKey:"valuationDate",kind:"valuation",direction:"lower"},
 {key:"pbr",label:"股價淨值比",unit:"倍",dateKey:"valuationDate",kind:"valuation",direction:"lower"},
 {key:"eps",label:"每股盈餘 EPS",unit:"元",dateKey:"epsDate",kind:"quarter",direction:"higher"},
 {key:"epsYoY",label:"EPS 年增率",unit:"%",dateKey:"epsDate",kind:"quarter",direction:"higher"},
 {key:"debtRatio",label:"負債比",unit:"%",dateKey:"debtDate",kind:"quarter",direction:"lower"},
 {key:"grossMargin",label:"毛利率",unit:"%",dateKey:"incomeDate",kind:"quarter",direction:"higher"},
 {key:"operatingMargin",label:"營業利益率",unit:"%",dateKey:"incomeDate",kind:"quarter",direction:"higher"},
 {key:"netMargin",label:"淨利率",unit:"%",dateKey:"incomeDate",kind:"quarter",direction:"higher"},
 {key:"quarterlyRoe",label:"季度 ROE（簡化）",unit:"%",dateKey:"incomeDate",kind:"quarter",direction:"higher"},
 {key:"currentRatio",label:"流動比率",unit:"倍",dateKey:"balanceDate",kind:"quarter",direction:"higher"},
 {key:"revenueYoY",label:"單月營收年增率",unit:"%",dateKey:"revenueDate",kind:"month",direction:"higher"},
 {key:"cashConversion",label:"現金／稅前盈餘",unit:"倍",dateKey:"cashDate",kind:"quarter",direction:"higher"},
 {key:"institutionalRatio",label:"近五日法人淨買賣占量",unit:"%",dateKey:"marketDate",kind:"market",direction:"higher"},
 {key:"holderPct",label:"400張以上集保占比",unit:"%",dateKey:"holderDate",kind:"market",direction:"higher"},
 {key:"ma20",label:"20日均線",unit:"元",dateKey:"technicalDate",kind:"market",nested:true,direction:"neutral"},
 {key:"rsi",label:"RSI",unit:"",dateKey:"technicalDate",kind:"market",nested:true,direction:"neutral"},
 {key:"volatility20",label:"20日歷史波動率",unit:"%",dateKey:"technicalDate",kind:"market",nested:true,direction:"lower"}
];
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const value=(row,metric)=>metric.nested?row.metrics?.technical?.[metric.key]:row.metrics?.[metric.key];
const date=(row,metric)=>metric.nested?row.metrics?.technical?.date:
 metric.dateKey==="marketDate"?row.marketDate:row.metrics?.[metric.dateKey];

export function peerPercentile(n,values,direction="higher"){
 if(direction==="neutral"||!finite(n)||values.length<5||!values.every(finite))return null;
 const less=values.filter(x=>x<n).length,eq=values.filter(x=>x===n).length;
 const raw=(less+eq/2)/values.length*100;
 const favorable=direction==="lower"?100-raw:raw;
 return Math.round(favorable);
}
const peerRows=(rows,metric,ownStock=null)=>{
 const values=rows.map(r=>value(r,metric)).filter(finite);
 return rows.map(r=>({
  stock:r.stock,name:r.name||r.stock,value:value(r,metric),
  pr:peerPercentile(value(r,metric),values,metric.direction),
  isCurrent:ownStock?String(r.stock)===String(ownStock):false
 })).filter(r=>finite(r.value))
  .sort((a,b)=>(b.pr??-1)-(a.pr??-1)||String(a.stock).localeCompare(String(b.stock)));
};
export function buildPeerComparison(own,peers,{minPeers=5}={}){
 if(!own?.industry)return {industry:null,sample:0,items:[],reason:"官方公司名冊無法確認產業分類"};
 const group=(peers||[]).filter(p=>p.industry===own.industry&&p.market===own.market);
 const items=definitions.map(metric=>{
  const ownDate=date(own,metric),ownValue=value(own,metric);
  const comparable=group.filter(p=>date(p,metric)===ownDate&&finite(value(p,metric)));
  const available=finite(ownValue)&&!!ownDate&&comparable.length>=minPeers&&metric.direction!=="neutral";
  return {key:metric.key,label:metric.label,unit:metric.unit,value:finite(ownValue)?ownValue:null,
   date:ownDate||null,direction:metric.direction,
   pr:available?peerPercentile(ownValue,comparable.map(x=>value(x,metric)),metric.direction):null,
   sample:comparable.length,peers:peerRows(comparable,metric,own.stock),
   source:metric.kind==="valuation"?"官方估值／FinMind":
    metric.kind==="market"?"FinMind／TDCC":"FinMind 公開財報",
   note:available?"PR 越高代表此指標在同業中越有利；低本益比、低股價淨值比、低負債比與低波動率已反向計算。":
    metric.direction==="neutral"?"此指標不存在單調的『越高越好／越低越好』關係，因此不顯示 PR。":
    "同市場同產業、相同報告期有效樣本不足 "+minPeers+" 檔，暫不計算 PR"};
 });
 return {industry:own.industry,market:own.market,items,
  sample:Math.max(0,...items.map(x=>x.sample)),
  note:"PR 為同業有利程度百分位，越高越有利；PE、PB、負債比與波動率等越低越好的指標採反向百分位。"};
}

export function buildOfficialIndustryComparison(stock,universe){
 const rows=universe?.allStocks||[];
 const own=rows.find(x=>x.stock===stock);
 if(!own?.industry)return {industry:own?.industry||null,market:own?.market||null,items:[],
  reason:"官方公司名冊缺少可核實產業分類，暫不計算同業 PR"};
 const reportDate=own?.screen?.date;
 if(!reportDate)return {industry:own.industry,market:own.market,items:[],
  reason:"官方估值表未提供可核對日期，暫不計算同業 PR"};
 const peers=rows.filter(x=>x.market===own.market&&x.industry===own.industry&&
  x.screen?.date===reportDate);
 const metrics=[
  ["per","本益比","倍",v=>v>0,"lower"],
  ["pbr","股價淨值比","倍",v=>v>0,"lower"],
  ["dividendYield","殖利率","%",v=>v>=0&&v<=20,"higher"]
 ];
 const items=metrics.map(([key,label,unit,valid,direction])=>{
  const ownValue=own.screen?.[key];
  const validPeers=peers.filter(x=>Number.isFinite(x.screen?.[key])&&valid(x.screen[key]));
  const values=validPeers.map(x=>x.screen[key]);
  const comparable=Number.isFinite(ownValue)&&valid(ownValue)&&values.length>=5;
  const detailRows=validPeers.map(x=>({stock:x.stock,name:x.name||x.stock,value:x.screen[key],
   pr:peerPercentile(x.screen[key],values,direction),isCurrent:x.stock===stock}))
   .sort((a,b)=>(b.pr??-1)-(a.pr??-1)||String(a.stock).localeCompare(String(b.stock)));
  return {key,label,unit,value:Number.isFinite(ownValue)&&valid(ownValue)?ownValue:null,
   date:reportDate,direction,
   pr:comparable?peerPercentile(ownValue,values,direction):null,sample:values.length,peers:detailRows,
   source:own.source+"／官方估值表",
   note:comparable?"PR 越高代表此估值指標在同業中越有利；PE／PB 越低，因此採反向 PR。":
    "相同市場、產業與日期的官方有效估值樣本不足五檔，暫不計算 PR"};
 });
 return {industry:own.industry,market:own.market,items,
  sample:Math.max(0,...items.map(x=>x.sample)),
  note:"PR 越高代表同業相對越有利；本益比與股價淨值比已修正為數值越低、PR 越高。"};
}
