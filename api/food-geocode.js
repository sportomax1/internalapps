export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const q=String(req.query.q||'').trim().slice(0,200);
  if(!q)return res.status(400).json({error:'Location is required'});
  try{
    const u='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&q='+encodeURIComponent(q);
    const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'InternalApps-FoodMap/1.0'}});
    if(!r.ok)throw new Error(`Geocoder returned ${r.status}`);
    const data=await r.json();
    res.setHeader('Cache-Control','s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({results:data.map(x=>({lat:+x.lat,lon:+x.lon,label:x.display_name,type:x.type}))});
  }catch(e){return res.status(502).json({error:'Geocoding failed',detail:e.message});}
}