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
export function normalize(prices,revenue,financials,investors){return {
 prices:prices.map(x=>({date:String(x.date??""),close:n(x.close),volume:n(x.Trading_Volume)})).filter(x=>x.date&&x.close>0).sort((a,b)=>a.date.localeCompare(b.date)),
 revenues:revenue.map(x=>({date:String(x.date??""),revenue:n(x.revenue),revenue_year:x.revenue_year,revenue_month:x.revenue_month})).filter(x=>x.revenue!==null),
 financials:financials.map(x=>({date:String(x.date??""),type:String(x.type??""),value:n(x.value)})).filter(x=>x.value!==null),
 institutional:investors.map(x=>({date:String(x.date??""),name:x.name,buy:n(x.buy),sell:n(x.sell)})).filter(x=>x.date&&x.buy!==null&&x.sell!==null)
}}
export function reconcile(official,prices){if(!official)return {state:"無法確認",note:"尚未取得官方同行情資料"};if(!official.date)return {state:"日期未知",note:"官方回應缺乏可辨認日期，不進行價格自動核對"};const match=prices.find(p=>p.date===official.date);if(!match)return {state:"日期不一致",note:"FinMind 沒有相同交易日資料，不能直接比較最新兩筆"};const equal=Math.abs(match.close-official.close)<0.0001;return {state:equal?"一致":"不一致",note:equal?"相同交易日收盤價一致":"官方與 FinMind 同日價格不同，暫停總分顯示",date:official.date,finmindClose:match.close,officialClose:official.close}}
