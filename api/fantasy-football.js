import {
  gunzipSync,
  inflateSync,
  inflateRawSync,
  brotliDecompressSync,
} from 'node:zlib';

function decodePayload(buffer) {
  const attempts = [
    ['gzip', gunzipSync],
    ['zlib/deflate', inflateSync],
    ['raw-deflate', inflateRawSync],
    ['brotli', brotliDecompressSync],
  ];

  const errors = [];
  for (const [name, fn] of attempts) {
    try {
      const html = fn(buffer).toString('utf8');
      if (/^\s*<!doctype html|^\s*<html/i.test(html)) {
        return { html, format: name };
      }
      errors.push(`${name}: decoded but did not produce HTML`);
    } catch (error) {
      errors.push(`${name}: ${error?.message || error}`);
    }
  }

  // Final guard: if the payload was accidentally stored uncompressed.
  const raw = buffer.toString('utf8');
  if (/^\s*<!doctype html|^\s*<html/i.test(raw)) {
    return { html: raw, format: 'plain' };
  }

  throw new Error(`Unable to decode embedded app payload. ${errors.join(' | ')}`);
}

export default async function handler(req, res) {
  try {
    const sourceUrl = 'https://raw.githubusercontent.com/sportomax1/internalapps/8c23f7d91b5e89391fc5cbacfb92205deca884b0/public/fantasy-football.html';
    const upstream = await fetch(sourceUrl, { headers: { Accept: 'text/html' } });
    if (!upstream.ok) throw new Error(`GitHub source HTTP ${upstream.status}`);

    const loader = await upstream.text();
    const match = loader.match(/const b64=`([^`]+)`/s);
    if (!match) throw new Error('Embedded Fantasy Lens payload not found');

    const payload = Buffer.from(match[1], 'base64');
    const { html, format } = decodePayload(payload);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Fantasy-Lens-Payload', format);
    return res.status(200).send(html);
  } catch (error) {
    console.error('Fantasy Lens server loader failed', error);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send(`Fantasy Lens server loader failed: ${error?.message || error}`);
  }
}
