// Goodinfo 公開個股頁：僅在使用者開啟個股分析時嘗試取得一次。
// 不繞過驗證碼、登入、封鎖或網站限制；解析失敗即顯示不可取得。
// 本功能僅比對同日期收盤價，不下載或再製整張 Goodinfo 表格。
export const goodinfoUrl=stock=>"https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID="+encodeURIComponent(stock);
function plain(html){
 return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi," ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi," ")
  .replace(/<\/\s*(?:td|th)\s*>/gi," | ")
  .replace(/<\/\s*tr\s*>/gi," \n ")
  .replace(/<[^>]+>/g," ")
  .replace(/&nbsp;|&#160;|&#xA0;/gi," ")
  .replace(/&amp;/gi,"&").replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(Number(d)))
  .replace(/[ \t]+/g," ");
}
export function parseGoodinfoQuote(html,stock){
 if(typeof html!=="string"||html.length>1600000||html.length<200) return null;
 const txt=plain(html);
 if(/系統忙碌中|機器人驗證|驗證碼|請稍後再查詢|Access Denied|Service Unavailable/i.test(txt))return null;
 if(!txt.includes(String(stock))||!txt.includes("成交價")||!txt.includes("昨收"))return null;
 const day=txt.match(/日期\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
 if(!day)return null;
 const mm=day[1].padStart(2,"0"),dd=day[2].padStart(2,"0");
 // 必須確定是成交價、昨收、漲跌價這組表頭對應的第一個資料儲存格。
 const row=txt.match(/成交價\s*\|\s*昨收\s*\|\s*漲跌價\s*\|[^\n]{0,400}\n\s*([\d,]+(?:\.\d+)?)\s*\|/);
 if(!row)return null;
 const close=Number(row[1].replaceAll(",",""));
 if(!Number.isFinite(close)||close<=0)return null;
 return {day:mm+"/"+dd,close};
}
export async function getGoodinfoQuote(stock,expectedDate,fetcher=fetch){
 const url=goodinfoUrl(stock);
 if(!/^\d{4,6}$/.test(stock))return {status:"unavailable",url,message:"股票代碼不正確"};
 if(!expectedDate)return {status:"unavailable",url,message:"缺少官方行情日期，暫不比對"};
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),8000);
 try{
  const response=await fetcher(url,{signal:ctrl.signal,headers:{"Accept":"text/html"}});
  if(!response.ok)return {status:"unavailable",url,message:"Goodinfo 暫時無法取得（HTTP "+response.status+"）"};
  if(!/text\/html/i.test(response.headers.get("content-type")||""))return {status:"unavailable",url,message:"Goodinfo 回傳非網頁資料"};
  if(Number(response.headers.get("content-length")||0)>1600000)return {status:"unavailable",url,message:"Goodinfo 頁面資料過大"};
  const html=await response.text();
  const parsed=parseGoodinfoQuote(html,stock);
  if(!parsed)return {status:"unavailable",url,message:"Goodinfo 回應無法確認同日收盤價"};
  if(parsed.day!==expectedDate.slice(5).replace("-","/"))return {status:"different_day",url,day:parsed.day,message:"Goodinfo 顯示 "+parsed.day+"，官方是 "+expectedDate.slice(5)+"，日期不同不比價"};
  return {status:"available",url,day:parsed.day,close:parsed.close,message:"已取得 Goodinfo 同日收盤價"};
 }catch(error){return {status:"unavailable",url,message:"Goodinfo 目前無法連線或讀取"}}
 finally{clearTimeout(timeout)}
}
export function compareGoodinfo(result,official,finmind){
 if(result.status!=="available")return result;
 if(!official||!finmind||official.date!==finmind.date)
  return {...result,status:"unverified",message:"官方與 FinMind 行情日期不同，暫不比價"};
 const a=Number(official.close),b=Number(finmind.close),c=Number(result.close);
 if(![a,b,c].every(Number.isFinite))
  return {...result,status:"unverified",message:"比對數值不完整"};
 const same=Math.abs(a-b)<=.0001&&Math.abs(a-c)<=.0001;
 return {...result,status:same?"matched":"mismatch",
  message:same?"三處同日收盤價一致":"三處同日收盤價不同，請查證資料口徑"};
}
