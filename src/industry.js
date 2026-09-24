// PR is a descriptive within-industry raw-value percentile, not a stock preference score.
// For every metric PR=0 means relatively small numeric value, PR=100 relatively large.
const definitions=[
 {key:"per",label:"本益比",unit:"倍",dateKey:"valuationDate",kind:"valuation"},
 {key:"pbr",label:"股價淨值比",unit:"倍",dateKey:"valuationDate",kind:"valuation"},
 {key:"eps",label:"每股盈餘 EPS",unit:"元",dateKey:"epsDate",kind:"quarter"},
 {key:"epsYoY",label:"EPS 年增率",unit:"%",dateKey:"epsDate",kind:"quarter"},
 {key:"debtRatio",label:"負債比",unit:"%",dateKey:"debtDate",kind:"quarter"},
 {key:"grossMargin",label:"毛利率",unit:"%",dateKey:"incomeDate",kind:"quarter"},
 {key:"operatingMargin",label:"營業利益率",unit:"%",dateKey:"incomeDate",kind:"quarter"},
 {key:"netMargin",label:"淨利率",unit:"%",dateKey:"incomeDate",kind:"quarter"},
 {key:"quarterlyRoe",label:"季度 ROE（簡化）",unit:"%",dateKey:"incomeDate",kind:"quarter"},
 {key:"currentRatio",label:"流動比率",unit:"倍",dateKey:"balanceDate",kind:"quarter"},
 {key:"revenueYoY",label:"單月營收年增率",unit:"%",dateKey:"revenueDate",kind:"month"},
 {key:"cashConversion",label:"現金／稅前盈餘",unit:"倍",dateKey:"cashDate",kind:"quarter"},
 {key:"institutionalRatio",label:"近五日法人淨買賣占量",unit:"%",dateKey:"marketDate",kind:"market"},
 {key:"holderPct",label:"400張以上集保占比",unit:"%",dateKey:"holderDate",kind:"market"},
 {key:"ma20",label:"20日均線",unit:"元",dateKey:"technicalDate",kind:"market",nested:true},
 {key:"rsi",label:"RSI",unit:"",dateKey:"technicalDate",kind:"market",nested:true},
 {key:"volatility20",label:"20日歷史波動率",unit:"%",dateKey:"technicalDate",kind:"market",nested:true}
];
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const value=(row,metric)=>metric.nested?row.metrics?.technical?.[metric.key]:row.metrics?.[metric.key];
const date=(row,metric)=>metric.nested?row.metrics?.technical?.date:
 metric.dateKey==="marketDate"?row.marketDate:row.metrics?.[metric.dateKey];
export function peerPercentile(n,values){
 if(!finite(n)||values.length<5||!values.every(finite))return null;
 const less=values.filter(x=>x<n).length,eq=values.filter(x=>x===n).length;
 return Math.round((less+eq/2)/values.length*100);
}
export function buildPeerComparison(own,peers,{minPeers=5}={}){
 if(!own?.industry)return {industry:null,sample:0,items:[],reason:"官方公司名冊無法確認產業分類"};
 const group=(peers||[]).filter(p=>p.industry===own.industry&&p.market===own.market);
 const items=definitions.map(metric=>{
  const ownDate=date(own,metric),ownValue=value(own,metric);
  const comparable=group.filter(p=>date(p,metric)===ownDate&&finite(value(p,metric)));
  const available=finite(ownValue)&&!!ownDate&&comparable.length>=minPeers;
  return {key:metric.key,label:metric.label,unit:metric.unit,value:finite(ownValue)?ownValue:null,
   date:ownDate||null,pr:available?peerPercentile(ownValue,comparable.map(x=>value(x,metric))):null,
   sample:comparable.length,source:metric.kind==="valuation"?"官方估值／FinMind":
    metric.kind==="market"?"FinMind／TDCC":"FinMind 公開財報",
   note:available?"PR 越高表示該指標原始數值在同業中越大；不是投資優劣排名":
    "同市場同產業、相同報告期有效樣本不足 "+minPeers+" 檔，暫不計算 PR"};
 });
 return {industry:own.industry,market:own.market,items,
  sample:Math.max(0,...items.map(x=>x.sample)),
  note:"同市場、同產業、同報告期且有有效數值才比較；產業資料不完整或樣本不足時不顯示 PR。"};
}


/**
 * D1 不是同業「當日公開估值」PR 的必要條件。
 * 直接以既有 TWSE/TPEx 公司名冊與當日官方估值整批資料比同產業；
 * 無財報逐檔樣本時只回報 PE/PB/殖利率，不能杜撰其他財報 PR。
 */
export function buildOfficialIndustryComparison(stock,universe){
 const rows=universe?.allStocks||[];
 const own=rows.find(x=>x.stock===stock);
 if(!own?.industry)return {industry:own?.industry||null,market:own?.market||null,items:[],
  reason:"官方公司名冊缺少可核實產業分類，暫不計算同業 PR"};
 const date=own?.screen?.date;
 if(!date)return {industry:own.industry,market:own.market,items:[],
  reason:"官方估值表未提供可核對日期，暫不計算同業 PR"};
 const peers=rows.filter(x=>x.market===own.market&&x.industry===own.industry&&
  x.screen?.date===date);
 const metrics=[
  ["per","本益比","倍",v=>v>0],
  ["pbr","股價淨值比","倍",v=>v>0],
  ["dividendYield","殖利率","%",v=>v>=0&&v<=20]
 ];
 const items=metrics.map(([key,label,unit,valid])=>{
  const ownValue=own.screen?.[key];
  const values=peers.map(x=>x.screen?.[key]).filter(v=>Number.isFinite(v)&&valid(v));
  const comparable=Number.isFinite(ownValue)&&valid(ownValue)&&values.length>=5;
  return {key,label,unit,value:Number.isFinite(ownValue)&&valid(ownValue)?ownValue:null,
   date,pr:comparable?peerPercentile(ownValue,values):null,sample:values.length,
   source:own.source+"／官方估值表",
   note:comparable?"PR 越大僅表示此指標數字在同業中越大，非投資優劣":
    "相同市場、產業與日期的官方有效估值樣本不足五檔，暫不計算 PR"};
 });
 return {industry:own.industry,market:own.market,items,
  sample:Math.max(...items.map(x=>x.sample)),
  note:"直接比較當日官方同業估值，不需要 D1；財報與技術、籌碼的全市場歷史 PR 仍需各檔相同期間的真實資料。"};
}
