/**
 * Lake Powell data from the U.S. Bureau of Reclamation RISE API.
 * The old water-data.com endpoints return HTTP 406 from Vercel.
 * Supported views retain the dashboard's existing response contract.
 */
const ITEMS = {elevation:508,inflows:4288,outflows:507};
const FULL_POOL=3700, MIN_POWER=3490, DEAD_POOL=3370;
function numeric(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null}
function unwrap(entry){
 const a=entry.attributes||entry;
 const date=a.dateTime||a.datetime||a.date_time||a.timestamp||a.date||a.time;
 const value=numeric(a.value??a.result??a.measurement??a.numericValue);
 return date&&value!==null?{date:String(date).slice(0,10),value}:null;
}
async function query(item,start,end){
 const url=new URL("https://data.usbr.gov/rise/api/result");
 url.searchParams.set("itemId",String(item));
 url.searchParams.set("dateTime[after]",start);
 url.searchParams.set("dateTime[before]",end);
 url.searchParams.set("itemsPerPage","10000");
 const response=await fetch(url,{headers:{Accept:"application/vnd.api+json"},signal:AbortSignal.timeout(24000)});
 if(!response.ok)throw Error("USBR RISE HTTP "+response.status);
 const json=await response.json();
 if(!Array.isArray(json.data))throw Error("USBR RISE response missing data array");
 return json.data.map(unwrap).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
}
function yearStart(d){return d.getUTCMonth()>=9?d.getUTCFullYear():d.getUTCFullYear()-1}
function aggregate(rows){
 const years=new Map();
 for(const r of rows){const date=new Date(r.date+"T00:00:00Z");const y=yearStart(date);if(!years.has(y))years.set(y,{all:0,early:0,late:0});
 const o=years.get(y);o.all+=r.value;if(date.getUTCMonth()>=9||date.getUTCMonth()<=3)o.early+=r.value;else o.late+=r.value;}
 const dates=[...years.keys()].sort((a,b)=>a-b), vals=dates.map(y=>years.get(y));
 return {dates:dates.map(y=>String(y+1)),all:vals.map(v=>v.all),early:vals.map(v=>v.early),late:vals.map(v=>v.late)};
}
export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).json({error:"Only GET supported"});
 const view=String(req.query.view||"");
 if(!["elevation","inflows","outflows","rivers","rivers30","rivers2yr"].includes(view))return res.status(400).json({error:"Invalid view"});
 if(view.startsWith("rivers"))return res.status(503).json({error:"River gauge history requires a separate verified USGS source; unavailable rather than displaying incorrect data."});
 try{
  const now=new Date(),end=now.toISOString().slice(0,10);
  const start=new Date(Date.UTC(now.getUTCFullYear()-20,0,1)).toISOString().slice(0,10);
  const rows=await query(ITEMS[view],start,end);
  if(!rows.length)throw Error("USBR RISE returned no usable observations");
  let data;
  if(view==="elevation"){
   data={dates:rows.map(r=>r.date),elevation:rows.map(r=>r.value),full_pool:FULL_POOL,min_power:MIN_POWER,dead_pool:DEAD_POOL};
  }else{
   // RISE item 4288 reports daily inflow in acre-feet; item 507 reports
   // average powerplant release in CFS. Convert CFS-day to acre-feet.
   const daily=rows.map(r=>({...r,value:view==="outflows"?r.value*1.983471074:r.value}));
   const a=aggregate(daily);
   if(view==="inflows")data={dates:a.dates,inf_allwy:a.all,inf_to415:a.early,inf_to731:a.late};
   else data={dates:a.dates,out_allwy:a.all,out_to415:a.early,out_to731:a.late};
  }
  res.setHeader("Cache-Control","public, s-maxage=3600, stale-while-revalidate=7200");
  return res.status(200).json({view,fetchedAt:new Date().toISOString(),source:"USBR RISE",data});
 }catch(e){return res.status(502).json({error:"USBR data unavailable",detail:String(e.message||e)})}
}
