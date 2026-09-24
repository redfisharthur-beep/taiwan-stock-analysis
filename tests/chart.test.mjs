import test from "node:test";
import assert from "node:assert/strict";
import {validCandles} from "../public/chart.js";
test("OHLC validation excludes fabricated and inconsistent bars",()=>{
 const rows=[{date:"2026-09-23",open:100,high:105,low:99,close:104,volume:1234},
 {date:"2026-09-24",open:100,high:98,low:90,close:95,volume:1000},
 {date:"2026-09-22",open:null,high:10,low:9,close:10,volume:10}];
 assert.deepEqual(validCandles(rows).map(p=>p.date),["2026-09-23"]);
});
test("candles are ordered by actual trading date",()=>{
 const x=validCandles([{date:"2026-09-24",open:1,high:2,low:1,close:2,volume:5},
 {date:"2026-09-23",open:2,high:2,low:1,close:1,volume:8}]);
 assert.equal(x[0].date,"2026-09-23");
});
