// The company registry is authoritative for common shares. ETF identities are checked
// separately using the official market quote and, where available, fund registry.
export const tickerPattern=/^[0-9A-Z]{4,6}$/;
export const isCompanyCode=code=>/^[0-9]{4}$/.test(code)&&!code.startsWith("00");
export const isETFCandidate=code=>/^00[0-9A-Z]{2,4}$/.test(code);
export function securityKind(code,{company=false,fund=false,quotedName=""}={}){
 if(company&&isCompanyCode(code))return "stock";
 if(!isETFCandidate(code))return null;
 // Do not pass ETNs, warrants, REITs or other 00-prefixed products as verified ETFs.
 if(/ETN|指數投資證券|權證|不動產投資信託|REIT/i.test(quotedName))return null;
 if(fund||/ETF|指數股票型基金|主動式基金/i.test(quotedName))return "etf";
 // TWSE / TPEx quote records for 00-prefixed fund series. Exclude explicit non-ETF names above.
 return quotedName.trim()?"etf":null;
}
export const kindLabel=kind=>kind==="etf"?"ETF":"股票";
