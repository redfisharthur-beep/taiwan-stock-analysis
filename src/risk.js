const finite=x=>typeof x==="number"&&Number.isFinite(x);
const clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
const num=x=>finite(x)?x:null;
const median=values=>{
 const xs=values.filter(finite).sort((a,b)=>a-b);
 if(!xs.length)return null;
 const m=Math.floor(xs.length/2);
 return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
};
const avg=values=>{
 const xs=values.filter(finite);
 return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
};
const changePct=(rows,sessions)=>{
 if(rows.length<sessions+1)return null;
 const a=num(rows.at(-(sessions+1))?.close),b=num(rows.at(-1)?.close);
 return a>0&&b!==null?(b/a-1)*100:null;
};
const rsi=(rows,n=14)=>{
 if(rows.length<n+1)return null;
 const closes=rows.map(x=>num(x.close));
 if(closes.some(x=>x===null))return null;
 let gains=0,losses=0;
 for(let i=closes.length-n;i<closes.length;i++){
  const d=closes[i]-closes[i-1];
  gains+=Math.max(0,d);losses+=Math.max(0,-d);
 }
 if(gains+losses===0)return 50;
 if(losses===0)return 100;
 return 100-100/(1+gains/losses);
};
const ma=(rows,n)=>{
 const xs=rows.slice(-n).map(x=>num(x.close));
 return xs.length===n&&xs.every(finite)?avg(xs):null;
};
const annualizedVol=(rows,n=20)=>{
 if(rows.length<n+1)return null;
 const closes=rows.slice(-(n+1)).map(x=>num(x.close));
 if(closes.some(x=>x===null||x<=0))return null;
 const rs=[];for(let i=1;i<closes.length;i++)rs.push(closes[i]/closes[i-1]-1);
 const m=avg(rs);if(m===null)return null;
 return Math.sqrt(avg(rs.map(x=>(x-m)**2)))*Math.sqrt(252)*100;
};
const maxDrawdown=(rows,n=60)=>{
 const xs=rows.slice(-n).map(x=>num(x.close)).filter(x=>x!==null&&x>0);
 if(xs.length<2)return null;
 let peak=xs[0],dd=0;
 for(const x of xs){peak=Math.max(peak,x);dd=Math.max(dd,(peak-x)/peak*100)}
 return dd;
};

const severeHeadwindIndustryWords=["水泥工業","水泥製品","石油及煤製品","石油煤製品"];
const softHeadwindIndustryWords=["玻璃陶瓷","基本金屬","鋼鐵","化學材料","塑膠","紡織","汽車","造紙"];
const growthIndustryWords=["半導體","電子零組件","電腦及週邊設備","資訊服務","通信網路","電機機械","其他電子"];
const financialIndustryWords=["金融","銀行","保險","證券"];
const recognitionSensitiveWords=["建材營造","營建"];

export function assessIndustryOutlook(industry=""){
 const text=String(industry||"");
 const severe=severeHeadwindIndustryWords.filter(k=>text.includes(k));
 const soft=softHeadwindIndustryWords.filter(k=>text.includes(k));
 const growth=growthIndustryWords.filter(k=>text.includes(k));
 const finance=financialIndustryWords.some(k=>text.includes(k));
 const recognitionSensitive=recognitionSensitiveWords.some(k=>text.includes(k));
 const level=severe.length?"高度逆風":soft.length?"逆風":growth.length?"成長":"中性";
 return {
  // Industry outlook itself never hard-excludes a company. Only an unsupported
  // accounting model (financials) is excluded until a dedicated model exists.
  excluded:false,
  modelUnsupported:finance,
  recognitionSensitive,
  level,
  penalty:level==="高度逆風"?10:level==="逆風"?5:0,
  bonus:level==="成長"?3:0,
  reason:finance?
   "金融業需使用銀行／保險專用資本、呆帳與利差模型；一般企業負債比與現金流模型不適用，因此暫不進入一般企業推薦排名。":
   recognitionSensitive?
   "營建業獲利認列受完工交屋時點影響，單季 EPS／營收可能失真，排名時提高週期敏感度並要求較高資料可信度。":
   severe.length?
   "產業目前具較高結構或景氣逆風，但不再永久刪除；改以風險扣分，個別公司仍可因財務品質而入選。":
   soft.length?
   "產業具景氣循環、海外競爭或成熟需求風險，採扣分而非整類排除。":
   growth.length?
   "產業具較明確中長期需求或資本支出動能；仍須通過估值、會計品質與個股風險檢查。":
   "產業不做方向性硬判斷，主要依個股資料評估。",
  matched:severe.length?severe:soft.length?soft:growth
 };
}

const cyclicalWords=["航運","鋼鐵","塑膠","化學","油電燃氣","水泥","造紙","橡膠","玻璃陶瓷","原物料","建材營造","營建"];
export const isCyclicalIndustry=industry=>{
 const x=String(industry||"");
 return cyclicalWords.some(k=>x.includes(k));
};
function epsSeries(financials=[]){
 return financials.filter(x=>String(x.type||"").toLowerCase()==="eps"&&finite(Number(x.value)))
  .map(x=>({date:String(x.date||""),value:Number(x.value)}))
  .filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date))
  .sort((a,b)=>a.date.localeCompare(b.date));
}
function institutionalFiveDayRatio(institutional=[],prices=[]){
 const dates=[...new Set(prices.map(x=>x.date))].filter(Boolean).sort();
 const reported=[...new Set(institutional.map(x=>x.date))].filter(Boolean).sort();
 const selected=reported.filter(d=>dates.includes(d)).slice(-5);
 if(selected.length<5)return null;
 let net=0,volume=0;
 for(const date of selected){
  const rows=institutional.filter(x=>x.date===date);
  const day=prices.find(x=>x.date===date);
  if(!rows.length||!(num(day?.volume)>0))return null;
  net+=rows.reduce((s,x)=>s+(Number(x.buy)||0)-(Number(x.sell)||0),0);
  volume+=day.volume;
 }
 return volume>0?net/volume*100:null;
}
export function assessCandidateRisk({industry,prices=[],financials=[],institutional=[],screening={}}={}){
 const industryOutlook=assessIndustryOutlook(industry);
 const rows=[...prices].filter(x=>num(x.close)>0).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const latest=rows.at(-1)||null;
 const eps=epsSeries(financials);
 const latestEPS=eps.at(-1)?.value??null;
 const pastEPS=eps.slice(0,-1).map(x=>x.value);
 const normalEPS=median(pastEPS.filter(x=>x>0));
 const yearAgo=eps.at(-1)?eps.find(x=>x.date===String(Number(eps.at(-1).date.slice(0,4))-1)+eps.at(-1).date.slice(4)):null;
 const epsYoY=latestEPS!==null&&yearAgo?.value>0?(latestEPS/yearAgo.value-1)*100:null;

 let cyclical=0;
 const cyclicalIndustry=isCyclicalIndustry(industry);
 if(cyclicalIndustry)cyclical+=25;
 if(industryOutlook.recognitionSensitive)cyclical+=10;
 if(latestEPS!==null&&normalEPS>0){
  const ratio=latestEPS/normalEPS;
  if(ratio>=1.8)cyclical+=35;
  else if(ratio>=1.4)cyclical+=20;
  if(epsYoY!==null&&epsYoY<0&&ratio>=1.4)cyclical+=15;
 }
 if(cyclicalIndustry&&Number.isFinite(screening?.per)&&screening.per>0&&screening.per<=10&&
    Number.isFinite(screening?.pbr)&&screening.pbr>=1.8)cyclical+=15;
 cyclical=clamp(cyclical);

 const ret5=changePct(rows,5),ret20=changePct(rows,20);
 const ma20=ma(rows,20),ma60=ma(rows,60),lastClose=num(latest?.close);
 const distanceMA20=lastClose!==null&&ma20>0?(lastClose/ma20-1)*100:null;
 const latest5Vol=avg(rows.slice(-5).map(x=>num(x.volume)).filter(x=>x!==null&&x>=0));
 const prior60Vol=avg(rows.slice(-65,-5).map(x=>num(x.volume)).filter(x=>x!==null&&x>=0));
 const volumeSurge=latest5Vol!==null&&prior60Vol>0?latest5Vol/prior60Vol:null;
 const rsi14=rsi(rows,14),vol20=annualizedVol(rows,20),dd60=maxDrawdown(rows,60);
 let abnormal=0;
 if(ret5!==null&&ret5>=20)abnormal+=25;
 if(ret20!==null&&ret20>=40)abnormal+=25;
 if(volumeSurge!==null&&volumeSurge>=3)abnormal+=20;
 if(distanceMA20!==null&&distanceMA20>=25)abnormal+=15;
 if(rsi14!==null&&rsi14>=80)abnormal+=10;
 if(vol20!==null&&vol20>=60)abnormal+=10;
 abnormal=clamp(abnormal);

 const instRatio=institutionalFiveDayRatio(institutional,rows);
 let valueTrap=0;
 if(latestEPS!==null&&latestEPS<=0)valueTrap+=30;
 if(epsYoY!==null&&epsYoY<=-20)valueTrap+=25;
 if(instRatio!==null&&instRatio<=-2)valueTrap+=15;
 if(lastClose!==null&&ma60>0&&lastClose<ma60)valueTrap+=15;
 // A drawdown alone is not treated as proof of deterioration. It only becomes
 // a stronger trap signal when earnings or institutional flow also deteriorate.
 if(dd60!==null&&dd60>=25&&(epsYoY!==null&&epsYoY<0||instRatio!==null&&instRatio<0))valueTrap+=15;
 if(ret20!==null&&ret20<=-20&&(epsYoY!==null&&epsYoY<0))valueTrap+=10;
 if(cyclical>=70)valueTrap+=10;
 valueTrap=clamp(valueTrap);

 const label=x=>x>=60?"高":x>=30?"中":"低";
 return {
  cyclical:{score:cyclical,level:label(cyclical),industrySensitive:cyclicalIndustry,
   latestEPS,normalizedEPS:normalEPS,epsYoYPct:epsYoY},
  abnormalTrading:{score:abnormal,level:label(abnormal),
   return5Pct:ret5,return20Pct:ret20,volumeSurge,distanceMA20Pct:distanceMA20,
   rsi14,annualizedVolatility20Pct:vol20},
  valueTrap:{score:valueTrap,level:label(valueTrap),
   epsYoYPct:epsYoY,institutionalFiveDayRatioPct:instRatio,
   belowMA60:lastClose!==null&&ma60>0?lastClose<ma60:null,maxDrawdown60Pct:dd60},
  industryOutlook,
  excluded:industryOutlook.modelUnsupported||abnormal>=60||valueTrap>=60||cyclical>=80
 };
}

// Value score represents attractiveness before recommendation-confidence scaling.
// Candidate-specific risk is deducted later so risk is not double-counted.
export function calculateValueScore({compositeScore=0,relativePoints=0,qualityPoints=0,risk}={}){
 const outlook=risk?.industryOutlook||{};
 const raw=(Number(compositeScore)||0)+Math.min(12,Number(relativePoints)||0)*1.2+
  Math.min(13,Number(qualityPoints)||0)*0.35-(outlook.penalty||0)+(outlook.bonus||0);
 return Math.max(0,Math.min(100,Math.round(raw*100)/100));
}
export function calculateFinalResearchScore({valueScore=0,confidence=0,risk}={}){
 const riskPenalty=(risk?.cyclical?.score||0)*0.12+
  (risk?.abnormalTrading?.score||0)*0.28+
  (risk?.valueTrap?.score||0)*0.32;
 const result=(Number(valueScore)||0)*Math.max(0,Math.min(100,Number(confidence)||0))/100-riskPenalty;
 return Math.max(0,Math.min(100,Math.round(result*100)/100));
}
