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
export function normalize(prices,revenue,financials,investors,valuation=[],cashFlows=[],margin=[],adjusted=[],balance=[]){return {
 prices:prices.map(x=>({date:String(x.date??""),open:n(x.open),high:n(x.max),low:n(x.min),close:n(x.close),volume:n(x.Trading_Volume)})).filter(x=>x.date&&x.close>0).sort((a,b)=>a.date.localeCompare(b.date)),
 revenues:revenue.map(x=>({date:String(x.date??""),revenue:n(x.revenue),revenue_year:x.revenue_year,revenue_month:x.revenue_month})).filter(x=>x.revenue!==null),
 financials:financials.map(x=>({date:String(x.date??""),type:String(x.type??""),value:n(x.value)})).filter(x=>x.value!==null),
 institutional:investors.map(x=>({date:String(x.date??""),name:x.name,buy:n(x.buy),sell:n(x.sell)})).filter(x=>x.date&&x.buy!==null&&x.sell!==null),
 valuation:valuation.map(x=>({date:String(x.date??""),per:n(x.PER),pbr:n(x.PBR),dividendYield:n(x.dividend_yield)})).filter(x=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date)),
 cashFlows:cashFlows.map(x=>({date:String(x.date??""),type:String(x.type??""),value:n(x.value)})).filter(x=>x.date&&x.value!==null),
 margin:margin.map(x=>({date:String(x.date??""),financing:n(x.MarginPurchaseTodayBalance),previousFinancing:n(x.MarginPurchaseYesterdayBalance),short:n(x.ShortSaleTodayBalance),previousShort:n(x.ShortSaleYesterdayBalance)})).filter(x=>x.date&&x.financing!==null&&x.previousFinancing!==null&&x.short!==null&&x.previousShort!==null),
 adjusted:adjusted.map(x=>({date:String(x.date??""),close:n(x.close),volume:n(x.Trading_Volume)}))
   .filter(x=>x.date&&x.close>0).sort((a,b)=>a.date.localeCompare(b.date)),
 balance:balance.map(x=>({date:String(x.date??""),type:String(x.type??""),value:n(x.value)}))
   .filter(x=>x.date&&x.value!==null)
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


/**
 * 全市場的「官方日行情＋相對估值」初篩。
 * 逐一掃描兩市場每日行情所有可辨認的四位數股票，不用成交額前幾名當母體。
 * 缺價、停牌、非四位數、不同日期及暫缺估值者皆列入統計，不宣稱完成深度財報分析。
 * 僅用公開資料，避免把私人券商資料批量再散布。
 */
export async function scanOfficialUniverse({priceCeiling=500,fetchJSON=json}={}){
 const markets=[
  {market:"上市",source:"TWSE",quoteUrl:"https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
   ratioUrl:"https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
   registryUrl:"https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
   code:"Code",name:"Name",close:"ClosingPrice",turnover:"TradeValue",volume:"TradeVolume"},
  {market:"上櫃",source:"TPEx",quoteUrl:"https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
   ratioUrl:"https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis",
   registryUrl:"https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
   code:"SecuritiesCompanyCode",name:"CompanyName",close:"Close",
   turnover:"TransactionAmount",volume:"TradingShares"}
 ];
 const jobs=await Promise.allSettled(markets.map(async m=>{
  const [quotes,ratios,registry]=await Promise.allSettled([fetchJSON(m.quoteUrl),fetchJSON(m.ratioUrl),fetchJSON(m.registryUrl)]);
  if(quotes.status!=="fulfilled"||!Array.isArray(quotes.value)||!quotes.value.length)
   throw Error("官方日行情未取得，不使用另一市場冒充全市場");
  const ratioMap=new Map();
  if(ratios.status==="fulfilled"&&Array.isArray(ratios.value)){
   for(const item of ratios.value){
    const code=String(item.Code??item.SecuritiesCompanyCode??"").trim();
    if(!/^[0-9]{4}$/.test(code))continue;
    ratioMap.set(code,{per:n(item.PEratio??item.PriceEarningRatio),
     pbr:n(item.PBratio??item.PriceBookRatio),
     dividendYield:n(item.DividendYield??item.YieldRatio),date:rocDate(item.Date)});
   }
  }
  const seen=new Set(),rows=[];
  for(const raw of quotes.value){
   const stock=String(raw[m.code]??"").trim();
   if(!/^[0-9]{4}$/.test(stock)||stock.startsWith("00")||seen.has(stock))continue;
   seen.add(stock);
   const quoteDate=rocDate(raw.Date),ratio=ratioMap.get(stock)||null;
   const close=n(raw[m.close]),turnover=n(raw[m.turnover]??raw.TradeValue??raw.TransactionAmount);
   const volume=n(raw[m.volume]??raw.TradingShares??raw.TradeVolume);
   rows.push({stock,name:String(raw[m.name]??"").trim(),market:m.market,source:m.source,
    url:m.quoteUrl,close,date:quoteDate,turnover,volume,
    screen:ratio&&(!ratio.date||ratio.date===quoteDate)?ratio:null});
  }
  // 公司名冊補足停牌／無當日成交行情者；缺收盤價仍留在母體而不進榜單。
  let registryAvailable=registry.status==="fulfilled"&&Array.isArray(registry.value)&&registry.value.length>0;
  let registryTotal=0;
  if(registryAvailable){
   const listed=new Map();
   for(const raw of registry.value){
    const stock=String(raw.SecuritiesCompanyCode??raw["公司代號"]??raw.Code??"").trim();
    if(!/^[0-9]{4}$/.test(stock)||stock.startsWith("00"))continue;
    listed.set(stock,String(raw.CompanyAbbreviation??raw["公司簡稱"]??raw.CompanyName??raw["公司名稱"]??"").trim());
   }
   registryTotal=listed.size;
   if(!registryTotal)registryAvailable=false;
   else{
    // 名冊作為股票身分母體：不讓 ETF 或非公司證券污染可排序的全市場名單。
    const filtered=rows.filter(row=>listed.has(row.stock));
    const found=new Set(filtered.map(row=>row.stock));
    for(const [stock,name] of listed)if(!found.has(stock))
     filtered.push({stock,name,market:m.market,source:m.source,url:m.quoteUrl,
      close:null,date:null,turnover:null,volume:null,screen:null});
    rows.length=0;rows.push(...filtered);
   }
  }
  const date=rows.map(r=>r.date).filter(Boolean).sort().at(-1)||null;
  return {market:m.market,date,rows,registryAvailable,registryTotal,valuationAvailable:ratios.status==="fulfilled"&&Array.isArray(ratios.value),
   source:m.source,quoteUrl:m.quoteUrl,ratioUrl:m.ratioUrl};
 }));
 const successful=jobs.filter(j=>j.status==="fulfilled").map(j=>j.value);
 const marketDate=successful.map(m=>m.date).filter(Boolean).sort().at(-1)||null;
 const all=successful.flatMap(m=>m.rows);
 const sameDate=all.filter(r=>r.date===marketDate);
 const priced=sameDate.filter(r=>r.close>0&&Number.isFinite(r.close));
 const affordable=priced.filter(r=>r.close<priceCeiling);
 const tradable=affordable.filter(r=>r.turnover>0&&r.volume>0);
 const warnings=jobs.flatMap((j,i)=>j.status==="rejected"?
  [markets[i].source+" 官方行情失敗："+String(j.reason?.message||j.reason)]:[]);
 for(const m of successful){if(!m.valuationAvailable)warnings.push(m.source+" 官方估值暫不可用；不以缺值充作零或低估");
  if(!m.registryAvailable)warnings.push(m.source+" 公司名冊暫不可用；只以當日行情作已知母體，不宣稱完整公司覆蓋");}
 if(successful.some(m=>m.date!==marketDate))warnings.push("兩市場日期不同，不跨日合併排行");
 return {marketDate,marketCount:successful.length,expectedMarketCount:2,
  markets:successful.map(m=>({market:m.market,date:m.date,total:m.rows.length,registryAvailable:m.registryAvailable,
   valuationAvailable:m.valuationAvailable})),warnings,
  universeCount:all.length,sameDateCount:sameDate.length,
  pricedCount:priced.length,affordableCount:affordable.length,
  tradableCount:tradable.length,excludedOverCeiling:priced.filter(r=>r.close>=priceCeiling).length,
  missingPriceCount:all.filter(r=>!Number.isFinite(r.close)||r.close<=0).length,
  staleMarketCount:all.filter(r=>r.date&&r.date!==marketDate).length,
  stocks:tradable};
}

const validRatio=x=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const safeYield=x=>typeof x==="number"&&Number.isFinite(x)&&x>=0&&x<=20;
export function rankUniverseCandidates(rows,mode="daily",limit=5){
 const scored=rows.map(r=>{
  const s=r.screen||{},per=validRatio(s.per)?s.per:null,pbr=validRatio(s.pbr)?s.pbr:null,
   yieldPct=safeYield(s.dividendYield)?s.dividendYield:null;
  // 本益比無法合理反映虧損股的估值；缺財報與自由現金流時只算「初篩」。
  const checks=[
   {label:"本益比 18 倍以下",status:per===null?"unknown":per<=18?"pass":"fail"},
   {label:"股價淨值比 1.8 倍以下",status:pbr===null?"unknown":pbr<=1.8?"pass":"fail"},
   {label:"殖利率至少 3%",status:yieldPct===null?"unknown":yieldPct>=3?"pass":"fail"}
  ];
  const known=checks.filter(c=>c.status!=="unknown").length,passed=checks.filter(c=>c.status==="pass").length;
  const ratioCoverage=[per,pbr,yieldPct].filter(x=>x!==null).length;
  // 僅為可解釋的選股排序鍵，絕非內在價值、投資報酬率或四面向百分制總分。
  const valuationPoints=(per===null?0:per<=12?4:per<=18?3:per<=25?2:1)+
   (pbr===null?0:pbr<=1.2?4:pbr<=1.8?3:pbr<=2.5?2:1)+
   (yieldPct===null?0:yieldPct>=4?3:yieldPct>=3?2:1);
  const liquidPoints=r.turnover>=100000000?3:r.turnover>=10000000?2:1;
  return {...r,screening:{per,pbr,dividendYield:yieldPct,checks,passed,known,
   passedAll:known===3&&passed===3,ratioCoverage,
   sortingPoints:valuationPoints+(mode==="daily"?liquidPoints:0),
   liquidityLabel:r.turnover>=100000000?"成交金額較高":r.turnover>=10000000?"成交金額中等":"成交金額較低"}};
 });
 return scored.sort((a,b)=>b.screening.sortingPoints-a.screening.sortingPoints||
  b.screening.ratioCoverage-a.screening.ratioCoverage||
  b.turnover-a.turnover||a.stock.localeCompare(b.stock)).slice(0,limit);
}
