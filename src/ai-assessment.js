const finite=x=>typeof x==="number"&&Number.isFinite(x);
const addUnique=(arr,text)=>{if(text&&!arr.includes(text))arr.push(text)};

export function buildAIResearchAssessment(detail={}){
 const score=detail.score||{};
 const parts=score.parts||{};
 const f=detail.financialInsights||{};
 const a=score.accountingRisk||{};
 const tech=score.indicators||{};
 const screening=detail.valuationLatest||{};
 const positives=[],risks=[];

 if(finite(score.score)&&score.score>=70)addUnique(positives,"綜合評分位於相對較高區間，基本面、技術面與籌碼面至少有部分訊號互相支持。");
 if(finite(f.monthlyRevenueYoY)&&f.monthlyRevenueYoY>0)addUnique(positives,"近期月營收年增仍為正，營運動能未出現明顯衰退訊號。");
 if(finite(f.operatingCashFlow)&&f.operatingCashFlow>0)addUnique(positives,"營業現金流為正，獲利至少有部分現金流支撐。");
 if(finite(f.quarterlyRoe)&&f.quarterlyRoe>4)addUnique(positives,"近期 ROE 表現具一定資本效率，但仍需搭配產業特性解讀。");
 if(finite(screening.per)&&screening.per>0&&screening.per<=18)addUnique(positives,"本益比處於偏低區間，具進一步檢查估值折價原因的價值研究意義。");
 if(tech&&finite(tech.close)&&finite(tech.ma20)&&finite(tech.ma60)&&tech.close>tech.ma20&&tech.ma20>tech.ma60)
  addUnique(positives,"價格站上 MA20 且 MA20 高於 MA60，近期趨勢尚未呈現明顯弱勢。");
 const chips=parts.chips;
 if(chips&&finite(chips.earned)&&chips.earned>=18)addUnique(positives,"目前可取得的籌碼指標整體偏正向。");

 if(a.penalty>0){
  if(a.equityMethod?.penalty>0)addUnique(risks,
   "權益法認列損益占獲利比重偏高，EPS 可能較依賴轉投資公司表現，已另扣會計品質風險分。");
  if(a.oci?.penalty>0)addUnique(risks,
   "其他綜合損益（OCI）相對淨利波動偏大，淨值與部分評價指標可能受未實現損益影響。");
 }
 if(finite(f.monthlyRevenueYoY)&&f.monthlyRevenueYoY<0)addUnique(risks,"近期月營收年增為負，需確認是短期基期因素還是需求轉弱。");
 if(finite(f.operatingCashFlow)&&f.operatingCashFlow<=0)addUnique(risks,"營業現金流未呈正值，帳面獲利品質需要進一步核對。");
 if(finite(f.debtRatio)&&f.debtRatio>70)addUnique(risks,"負債比偏高，利率與景氣反轉時的財務彈性較低。");
 if(tech&&finite(tech.rsi)&&tech.rsi>=75)addUnique(risks,"RSI 偏高，短線有過熱風險，不宜只因基本面分數高而忽略追價風險。");
 if(tech&&finite(tech.maxDrawdown60)&&tech.maxDrawdown60>=20)addUnique(risks,"近 60 日最大回撤偏大，價格波動與風險承受度需要納入考量。");
 if(finite(score.coveragePercent)&&score.coveragePercent<70)addUnique(risks,"目前資料涵蓋率仍偏低，總分的不確定性較高。");
 if(detail.verification?.state&&detail.verification.state!=="一致")addUnique(risks,"行情來源尚未完全同日核對，部分技術或估值判讀需保留。");

 while(positives.length<3)addUnique(positives,
  positives.length===0?"目前至少有可量化資料可供研究，但沒有足夠證據支持更強的正面結論。":
  "估值、財報與價格訊號需綜合判讀，不以單一指標作決策。");
 while(risks.length<3)addUnique(risks,
  risks.length===0?"目前未看到明顯單一高風險訊號，但仍需留意未取得資料與產業變化。":
  "公開資料更新時間不同，最新重大事件可能尚未完全反映在量化分數。");

 const highAccounting=(a.penalty||0)>=10;
 const coverage=score.coveragePercent??score.coveredPoints??0;
 let stance="審慎觀察";
 let advice="可保留在研究清單，優先核對最新財報、產業趨勢與估值是否仍具折價，再決定是否進一步追蹤。";
 if(finite(score.score)&&score.score>=75&&!highAccounting&&coverage>=70){
  stance="可優先研究";
  advice="量化條件具一定吸引力，可列入優先研究清單；仍應確認獲利來源是否可持續、估值折價原因，以及近期重大訊息。";
 }else if((finite(score.score)&&score.score<50)||highAccounting){
  stance="暫不優先";
  advice="目前風險或資料品質問題較明顯，較適合先等待財報品質、獲利來源或價格風險改善後再重新評估。";
 }

 return {
  title:"AI 研究評估",
  strengths:positives.slice(0,5),
  risks:risks.slice(0,5),
  stance,
  advice,
  note:"此區為依頁面實際量化資料自動整理的研究摘要，不是個人化買賣指示。"
 };
}
