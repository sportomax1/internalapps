const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function tokenFrom(text) {
  const patterns = [/vqd=['"]([^'"]+)['"]/, /vqd=([\d-]+)&/, /"vqd":"([^"]+)"/, /vqd%3D([\d-]+)/];
  for (const p of patterns) { const m = text.match(p); if (m) return m[1]; }
  return null;
}
function ddgHeaders(extra = {}) {
  return {'User-Agent': UA, 'Accept-Language':'en-US,en;q=0.9', Referer:'https://duckduckgo.com/', Accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', ...extra};
}
function actionFrom(req) {
  return String(req.query?.action || '').trim().toLowerCase();
}
async function images(req,res) {
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const q=String(req.query.q||'').trim().slice(0,300);
  if(!q) return res.status(400).json({error:'Missing q'});
  try {
    const home=await fetch('https://duckduckgo.com/?q='+encodeURIComponent(q),{headers:ddgHeaders()});
    const text=await home.text();
    const vqd=tokenFrom(text);
    if(!vqd) throw new Error('DuckDuckGo did not provide a search token (vqd). It may be rate-limiting this Vercel IP.');
    const u=new URL('https://duckduckgo.com/i.js');
    u.searchParams.set('l','us-en'); u.searchParams.set('o','json'); u.searchParams.set('q',q); u.searchParams.set('vqd',vqd); u.searchParams.set('f',',,,,'); u.searchParams.set('p','1');
    const r=await fetch(u,{headers:ddgHeaders({'Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest','Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin'})});
    const raw=await r.text();
    if(!r.ok) throw new Error('DuckDuckGo image endpoint returned HTTP '+r.status);
    let data; try { data=JSON.parse(raw); } catch { throw new Error('DuckDuckGo returned a non-JSON response'); }
    const results=(data.results||[]).map(x=>({title:x.title||'',image:x.image||'',thumbnail:x.thumbnail||x.image||'',source:x.url||'',width:x.width||null,height:x.height||null})).filter(x=>x.image);
    return res.status(200).json({provider:'duckduckgo-unofficial',query:q,count:results.length,results,warning:'Unofficial DuckDuckGo endpoint; may occasionally be rate-limited or change.'});
  } catch(e) { return res.status(502).json({error:e.message||'DuckDuckGo request failed',provider:'duckduckgo-unofficial'}); }
}
function env(req,res) {
  return res.status(200).json({appPassword:!!process.env.APP_PASSWORD,ouraKey:!!process.env.OURA_KEY});
}
function supabaseConfig(req,res) {
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  const supabaseUrl=process.env.SUPABASE_URL, supabaseAnonKey=process.env.SUPABASE_ANON_KEY;
  if(!supabaseUrl||!supabaseAnonKey) return res.status(500).json({ok:false,error:'Missing SUPABASE_URL or SUPABASE_ANON_KEY Vercel environment variable'});
  res.setHeader('Cache-Control','public, max-age=300, s-maxage=300');
  return res.status(200).json({ok:true,supabaseUrl,supabaseAnonKey});
}
function auth(req,res) {
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const password = req.body && typeof req.body === 'object' ? (req.body.password || '') : '';
  const secret=process.env.APP_PASSWORD;
  if(!secret) return res.status(500).json({error:'Server not configured'});
  return password===secret ? res.status(200).json({ok:true}) : res.status(401).json({error:'Invalid password'});
}
export default async function handler(req,res) {
  switch(actionFrom(req)) {
    case 'images': return images(req,res);
    case 'env': return env(req,res);
    case 'supabase-config': return supabaseConfig(req,res);
    case 'auth': return auth(req,res);
    default: return res.status(400).json({error:'Unknown tools action'});
  }
}
