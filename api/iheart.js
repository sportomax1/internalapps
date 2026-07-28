export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const action = String(req.query.action || 'search');
  try {
    if (action === 'search') {
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'Missing q' });
      const upstream = await fetch(`https://api.iheart.com/api/v1/catalog/searchAll?keywords=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'InternalApps-ColoradoRadio/1.0', Accept: 'application/json' }
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      return res.send(text);
    }
    if (action === 'station') {
      const id = String(req.query.id || '').replace(/\D/g, '');
      if (!id) return res.status(400).json({ error: 'Missing station id' });
      const upstream = await fetch(`https://api.iheart.com/api/v2/content/liveStations/${id}`, {
        headers: { 'User-Agent': 'InternalApps-ColoradoRadio/1.0', Accept: 'application/json' }
      });
      if (!upstream.ok) return res.status(upstream.status).json({ error: 'iHeart station lookup failed' });
      const body = await upstream.json();
      const station = body?.hits?.[0] || body?.data?.[0] || body;
      const streams = station?.streams || {};
      const stream = streams.secure_hls_stream || streams.hls_stream || streams.secure_shoutcast_stream || streams.shoutcast_stream || streams.stw_stream || streams.secure_pls_stream || streams.pls_stream || Object.values(streams).find(v => typeof v === 'string');
      return res.status(200).json({
        id: station?.id || Number(id), iheartId: station?.id || Number(id),
        name: station?.name || station?.title || `iHeart Station ${id}`,
        callSign: station?.callLetters || station?.callSign || '',
        city: station?.city || station?.market?.city || '',
        state: station?.state || station?.market?.state || '',
        logo: station?.logo || station?.logoUrl || station?.imageUrl || station?.assets?.logo || '',
        official: station?.website || station?.url || `https://www.iheart.com/live/${id}/`,
        stream
      });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'iHeart request failed' });
  }
}