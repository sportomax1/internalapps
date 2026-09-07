import { gunzipSync } from 'node:zlib';

export default async function handler(req, res) {
  try {
    const sourceUrl = 'https://raw.githubusercontent.com/sportomax1/internalapps/8c23f7d91b5e89391fc5cbacfb92205deca884b0/public/fantasy-football.html';
    const upstream = await fetch(sourceUrl, { headers: { Accept: 'text/html' } });
    if (!upstream.ok) throw new Error(`GitHub source HTTP ${upstream.status}`);
    const loader = await upstream.text();
    const match = loader.match(/const b64=`([^`]+)`/s);
    if (!match) throw new Error('Embedded Fantasy Lens payload not found');
    const html = gunzipSync(Buffer.from(match[1], 'base64')).toString('utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Fantasy Lens server loader failed', error);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send(`Fantasy Lens server loader failed: ${error?.message || error}`);
  }
}
