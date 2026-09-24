const FM="https://api.finmindtrade.com/api/v4/data";
const twnow=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const daysBack=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
const n=x=>{if(x==null||String(x).trim()===""||String(x).trim()==="-")return null;const v=Number(String(x).replaceAll(",","").trim());return Number.isFinite(v)?v:null};
async function json(url,init={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(url,{...init,signal:controller.signal,headers:{"Accept":"application/json",...(init.headers||{})}});if(!response.ok)throw new Error("上游 HTTP "+response.status);const body=await response.json();return body}finally{clearTimeout(timer)}}
export async function finmind(env,stock,dataset,lookback){const url=new URL(FM);for(const [k,v] of Object.entries({dataset,data_id:stock,start_date:daysBack(lookback),end_date:twnow()}))url.searchParams.set(k,v);const data=await json(url.toString(),{headers:{Authorization:"Bearer "+env.FINMIND_TOKEN}});if(!Array.isArray(data?.data)|| (data.status!==undefined&&!([200,0,"200","0"].includes(data.status))))throw new Error("FinMind 資料回傳異常："+dataset);return data.data.filter(r=>String(r.stock_id)===stock)}
export function latestMarketDate(){return twnow()}
function rocDate(s){const v=String(s??"").trim();if(/^\d{7}$/.test(v))return String(Number(v.slice(0,3))+1911)+"-"+v.slice(3,5)+"-"+v.slice(5,7);if(/^\d{3}\/\d{2}\/\d{2}$/.test(v))return String(Number(v.slice(0,3))+1911)+"-"+v.slice(4);if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;return null}
export async function officialQuote(stock){ // 官方端點失敗即標示失敗，絕不回填推測日期。
 const endpoints=[{market:"上市",source:"TWSE",url:"https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",code:"Code",price:"ClosingPrice",date:"Date",name:"Name"},{market:"上櫃",source:"TPEx",url:"https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",code:"SecuritiesCompanyCode",price:"Close",date:"Date",name:"CompanyName"}];
 const found=await Promise.all(endpoints.map(async p=>{try{const rows=await json(p.url);if(!Array.isArray(rows))throw Error("invalid format");const row=rows.find(r=>String(r[p.code]??"").trim()===stock);if(!row)return null;const price=n(row[p.price]);if(price===null||price<=0)throw Error("invalid closing price");return {market:p.market,source:p.source,name:String(row[p.name]??"").trim(),close:price,date:rocDate(row[p.date]),url:p.url,verifiedFormat:!!rocDate(row[p.date])};}catch(e){return {error:p.source+" 官方資料暫時不可用："+e.message}}}));
 return {quote:found.find(x=>x&&x.close)||null,errors:found.filter(x=>x?.error).map(x=>x.error)};
}
export function normalize(prices,revenue,financials,investors,valuation=[],cashFlows=[],margin=[]){return {
 prices:prices.map(x=>({date:String(x.date??""),open:n(x.open),high:n(x.max),low:n(x.min),close:n(x.close),volume:n(x.Trading_Volume)})).filter(x=>x.date&&x.close>0).sort((a,b)=>a.date.localeCompare(b.date)),
 revenues:revenue.map(x=>({date:String(x.date??""),revenue:n(x.revenue),revenue_year:x.revenue_year,revenue_month:x.revenue_month})).filter(x=>x.revenue!==null),
 financials:financials.map(x=>({date:String(x.date??""),type:String(x.type??""),value:n(x.value)})).filter(x=>x.value!==null),
 institutional:investors.map(x=>({date:String(x.date??""),name:x.name,buy:n(x.buy),sell:n(x.sell)})).filter(x=>x.date&&x.buy!==null&&x.sell!==null),
 valuation:valuation.map(x=>({date:String(x.date??""),per:n(x.PER),pbr:n(x.PBR),dividendYield:n(x.dividend_yield)})).filter(x=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date)),
 cashFlows:cashFlows.map(x=>({date:String(x.date??""),type:String(x.type??""),value:n(x.value)})).filter(x=>x.date&&x.value!==null),
 margin:margin.map(x=>({date:String(x.date??""),financing:n(x.MarginPurchaseTodayBalance),previousFinancing:n(x.MarginPurchaseYesterdayBalance),short:n(x.ShortSaleTodayBalance),previousShort:n(x.ShortSaleYesterdayBalance)})).filter(x=>x.date&&x.financing!==null&&x.previousFinancing!==null&&x.short!==null&&x.previousShort!==null)
}}
export function reconcile(official,prices){if(!official)return {state:"無法確認",note:"尚未取得官方同行情資料"};if(!official.date)return {state:"日期未知",note:"官方回應缺乏可辨認日期，不進行價格自動核對"};const match=prices.find(p=>p.date===official.date);if(!match)return {state:"日期不一致",note:"FinMind 沒有相同交易日資料，不能直接比較最新兩筆"};const equal=Math.abs(match.close-official.close)<0.0001;return {state:equal?"一致":"不一致",note:equal?"相同交易日收盤價一致":"官方與 FinMind 同日價格不同，暫停總分顯示",date:official.date,finmindClose:match.close,officialClose:official.close}}


// 免資料庫每日預篩：官方全市場行情一次取得，依成交金額挑出上市與上櫃候選。
// 成交金額只用於界定樣本，不是買入訊號或全市場 100 分排名。
export async function officialCandidates(perMarket=5,{mode="liquid",exclude=[]}={}){
 const markets=[
  {market:"上市",source:"TWSE",url:"https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
   id:"Code",name:"Name",close:"ClosingPrice",value:"TradeValue",volume:"TradeVolume"},
  {market:"上櫃",source:"TPEx",url:"https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
   id:"SecuritiesCompanyCode",name:"CompanyName",close:"Close",value:"TransactionAmount",volume:"TradingShares"}
 ];
 const jobs=await Promise.allSettled(markets.map(async m=>{
   const raw=await json(m.url);
   if(!Array.isArray(raw)||raw.length===0)throw Error("官方行情格式異常或資料為空");
   const converted=raw.map(r=>{
     const stock=String(r[m.id]??"").trim();
     const close=n(r[m.close]),turnover=n(r[m.value]??r.TradeValue??r.TransactionAmount);
     const volume=n(r[m.volume]??r.TradingShares??r.TradeVolume);
     const date=rocDate(r.Date);
     return {stock,name:String(r[m.name]??"").trim(),market:m.market,source:m.source,
       url:m.url,close,date,turnover,volume};
   }).filter(r=>r.stock.length===4&&[...r.stock].every(ch=>ch>="0"&&ch<="9")&&
       !r.stock.startsWith("00")&&r.date&&r.close>0&&r.turnover>0&&r.volume>0);
   const recentDate=converted.map(r=>r.date).sort().at(-1);
   let pool=converted.filter(r=>r.date===recentDate&&!exclude.includes(r.stock));
   if(mode==="value"){
     const metricsUrl=m.market==="上市"?
       "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL":
       "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis";
     const ratios=await json(metricsUrl);
     if(!Array.isArray(ratios))throw Error("官方估值資料格式異常");
     const ratioMap=new Map(ratios.map(v=>[String(v.Code??v.SecuritiesCompanyCode??"").trim(),{
       per:n(v.PEratio??v.PriceEarningRatio),
       pbr:n(v.PBratio??v.PriceBookRatio),
       yield:n(v.DividendYield??v.YieldRatio),
       date:rocDate(v.Date)
     }]));
     pool=pool.map(r=>({...r,screen:ratioMap.get(r.stock)}))
       .filter(r=>r.screen&&r.screen.per>0&&r.screen.per<=22&&
         r.screen.pbr>0&&r.screen.pbr<=2.5&&
         r.turnover>=1000000&&(!r.screen.date||r.screen.date===recentDate))
       .sort((a,b)=>{
         const sa=a.screen.per+4*a.screen.pbr-(a.screen.yield>0&&a.screen.yield<20?a.screen.yield:0)*.2;
         const sb=b.screen.per+4*b.screen.pbr-(b.screen.yield>0&&b.screen.yield<20?b.screen.yield:0)*.2;
         return sa-sb||b.turnover-a.turnover||a.stock.localeCompare(b.stock);
       });
   }else pool.sort((a,b)=>b.turnover-a.turnover||a.stock.localeCompare(b.stock));
   return {market:m.market,date:recentDate||null,totalEligible:converted.length,
     stocks:pool.slice(0,perMarket)};
 }));
 const warnings=jobs.flatMap((j,i)=>j.status==="rejected"?
   [markets[i].source+" 官方市場行情暫不可用："+String(j.reason?.message||j.reason)]:[]);
 const successful=jobs.filter(j=>j.status==="fulfilled").map(j=>j.value);
 const marketDate=successful.map(m=>m.date).filter(Boolean).sort().at(-1)||null;
 return {marketDate,warnings,markets:successful.map(m=>({market:m.market,date:m.date,
   totalEligible:m.totalEligible,sampled:m.date===marketDate?m.stocks.length:0})),
   candidates:successful.filter(m=>m.date===marketDate).flatMap(m=>m.stocks)};
}
