const OVERPASS=[
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const lat=Number(req.query.lat), lon=Number(req.query.lon);
  const radius=Math.min(Math.max(Number(req.query.radius)||8047,250),40234);
  const allowed=new Set(['restaurant','fast_food','cafe','ice_cream','food_court','bar','pub']);
  const types=String(req.query.types||'restaurant,fast_food,cafe,ice_cream').split(',').filter(x=>allowed.has(x));
  if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180)return res.status(400).json({error:'Invalid coordinates'});
  if(!types.length)return res.status(200).json({elements:[]});
  const re=types.join('|');
  const query=`[out:json][timeout:18];(nwr["amenity"~"^(${re})$"](around:${Math.round(radius)},${lat},${lon}););out center tags;`;
  let last=''; const attempts=[];
  for(const url of OVERPASS){
    try{
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json','User-Agent':'InternalApps-FoodMap/1.0'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(19000)});
      if(!r.ok){last=`${r.status} ${r.statusText}`;attempts.push({provider:new URL(url).host,status:r.status,error:last});continue;}
      const data=await r.json();
      attempts.push({provider:new URL(url).host,status:r.status,count:(data.elements||[]).length});
      res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=1800');
      return res.status(200).json({elements:data.elements||[],source:new URL(url).host,attempts});
    }catch(e){last=e.message;}
  }
  return res.status(502).json({error:'Food data is temporarily unavailable',detail:last,attempts});
}