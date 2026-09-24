export const config = { runtime: 'nodejs' };\nconst UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function tokenFrom(text){
  const patterns=[
    /vqd=['"]([^'"]+)['"]/,
    /vqd=([\d-]+)&/,
    /"vqd":"([^"]+)"/,
    /vqd%3D([\d-]+)/
  ];
  for(const p of patterns){const m=text.match(p);if(m)return m[1];}
  return null;
}
function headers(extra={}){return {'User-Agent':UA,'Accept-Language':'en-US,en;q=0.9','Referer':'https://duckduckgo.com/','Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',...extra};}

export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const q=String(req.query.q||'').trim().slice(0,300);
  if(!q)return res.status(400).json({error:'Missing q'});
  try{
    const home=await fetch('https://duckduckgo.com/?q='+encodeURIComponent(q),{headers:headers()});
    const text=await home.text();
    const vqd=tokenFrom(text);
    if(!vqd) throw new Error('DuckDuckGo did not provide a search token (vqd). It may be rate-limiting this Vercel IP.');
    const u=new URL('https://duckduckgo.com/i.js');
    u.searchParams.set('l','us-en');u.searchParams.set('o','json');u.searchParams.set('q',q);u.searchParams.set('vqd',vqd);u.searchParams.set('f',',,,,');u.searchParams.set('p','1');
    const r=await fetch(u,{headers:headers({'Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest','Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin'})});
    const raw=await r.text();
    if(!r.ok)throw new Error('DuckDuckGo image endpoint returned HTTP '+r.status);
    let data;try{data=JSON.parse(raw)}catch{throw new Error('DuckDuckGo returned a non-JSON response');}
    const results=(data.results||[]).map(x=>({title:x.title||'',image:x.image||'',thumbnail:x.thumbnail||x.image||'',source:x.url||'',width:x.width||null,height:x.height||null})).filter(x=>x.image);
    return res.status(200).json({provider:'duckduckgo-unofficial',query:q,count:results.length,results,warning:'Unofficial DuckDuckGo endpoint; may occasionally be rate-limited or change.'});
  }catch(e){return res.status(502).json({error:e.message||'DuckDuckGo request failed',provider:'duckduckgo-unofficial'});}
}