const allowed = /^[A-Z0-9^][A-Z0-9.^=-]{0,19}$/;
const ranges = { '1d':['5m','1d'], '5d':['30m','5d'], '1mo':['1d','1mo'], '3mo':['1d','3mo'], '6mo':['1d','6mo'], '1y':['1d','1y'], '5y':['1wk','5y'] };
export default async function handler(req,res) {
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const symbol=String(req.query.symbol||'').trim().toUpperCase();
  const range=String(req.query.range||'1mo');
  if(!allowed.test(symbol)||!ranges[range])return res.status(400).json({error:'Invalid symbol or range'});
  const [interval,period]=ranges[range];
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval='+interval+'&range='+period;
  try{
    const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; MarketPulse/1.0)','Accept':'application/json'},signal:AbortSignal.timeout(8500)});
    if(!response.ok)return res.status(response.status===404?404:502).json({error:response.status===429?'Data provider rate limit reached':'Market data temporarily unavailable'});
    const data=await response.json();const item=data?.chart?.result?.[0];
    if(!item)return res.status(404).json({error:'Ticker not found'});
    const q=item.indicators?.quote?.[0]||{}, meta=item.meta||{};
    const points=(item.timestamp||[]).map((t,i)=>({t:t*1000,c:q.close?.[i]??null,o:q.open?.[i]??null,h:q.high?.[i]??null,l:q.low?.[i]??null,v:q.volume?.[i]??null})).filter(p=>Number.isFinite(p.c));
    res.setHeader('Cache-Control','public, s-maxage=90, stale-while-revalidate=180');
    return res.status(200).json({symbol:meta.symbol||symbol,name:meta.longName||meta.shortName||symbol,currency:meta.currency||'USD',exchange:meta.exchangeName||'',price:meta.regularMarketPrice??points.at(-1)?.c??null,previousClose:meta.chartPreviousClose??meta.previousClose??null,marketTime:meta.regularMarketTime?meta.regularMarketTime*1000:null,high52:meta.fiftyTwoWeekHigh??null,low52:meta.fiftyTwoWeekLow??null,points,source:'Yahoo Finance (unofficial)'});
  }catch{return res.status(502).json({error:'Could not retrieve market data. Try again shortly.'});}
}