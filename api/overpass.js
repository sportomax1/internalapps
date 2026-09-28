export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  if(req.method!=='POST') return res.status(405).json({error:'POST required'});
  const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  const lat=Number(body.lat), lng=Number(body.lng), radius=Math.min(1000,Math.max(50,Number(body.radius)||450));
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return res.status(400).json({error:'Invalid coordinates'});
  const q='[out:json][timeout:20];way["building"](around:'+radius+','+lat+','+lng+');out geom tags;';
  const eps=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
  for(const ep of eps){
    try{
      const r=await fetch(ep,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'InternalApps-SunShadow/1.0'},body:new URLSearchParams({data:q})});
      if(r.ok){const data=await r.json(); return res.status(200).json(data);}
    }catch(e){}
  }
  return res.status(502).json({error:'Building service unavailable'});
}