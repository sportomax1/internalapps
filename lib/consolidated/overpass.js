// Building footprints are fetched server-side to avoid browser CORS restrictions.
// Successful GETs are cacheable by Vercel's CDN for repeat map visits.
const ENDPOINTS=[
 'https://overpass-api.de/api/interpreter',
 'https://overpass.kumi.systems/api/interpreter'
];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export default async function handler(req,res){
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required'});
 let body={};try{body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{})}catch{return res.status(400).json({error:'Invalid JSON request'})}
 const input=req.method==='GET'?req.query||{}:body;
 const lat=Number(input.lat),lng=Number(input.lng),radius=Math.round(Math.min(1000,Math.max(50,Number(input.radius)||350)));
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return res.status(400).json({error:'Invalid coordinates'});
 if(req.method==='GET')res.setHeader('Cache-Control','public, s-maxage=900, stale-while-revalidate=3600');
 else res.setHeader('Cache-Control','no-store');
 const q=`[out:json][timeout:22];way["building"](around:${radius},${lat},${lng});out geom tags;`;
 const controllers=ENDPOINTS.map(()=>new AbortController());
 const errors=[];
 const calls=ENDPOINTS.map(async(endpoint,index)=>{
  // The second provider is a backup, staggered to avoid duplicate requests on fast successes.
  if(index)await pause(2500);
  if(controllers[index].signal.aborted)throw new Error('Canceled');
  const timeout=setTimeout(()=>controllers[index].abort(),24000);
  try{
   const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','User-Agent':'InternalApps-SunShadow/2.0'},body:new URLSearchParams({data:q}),signal:controllers[index].signal});
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=await r.json();if(!Array.isArray(data?.elements))throw new Error('Invalid Overpass response');
   return {data,provider:ENDPOINTS[index]};
  }catch(e){errors[index]=controllers[index].signal.aborted?'timeout':String(e?.message||e);throw e}
  finally{clearTimeout(timeout)}
 });
 try{
  const {data,provider}=await Promise.any(calls);
  controllers.forEach(c=>c.abort());
  res.setHeader('X-SunShadow-Provider',new URL(provider).hostname);
  return res.status(200).json(data);
 }catch{
  return res.status(502).json({error:'OpenStreetMap Overpass providers did not respond. Try again or select a smaller radius.',providers:errors});
 }finally{controllers.forEach(c=>c.abort())}
}
