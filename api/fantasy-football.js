import { readFileSync } from 'node:fs';

const PARTS = [1,2,3,4,5,6,7].map(n => new URL(`./fantasy-parts/part${n}.txt`, import.meta.url));

export default async function handler(req, res) {
  try {
    const html = PARTS.map(file => readFileSync(file, 'utf8')).join('');

    if (!/^\s*<!doctype html/i.test(html)) {
      throw new Error('Plain Fantasy Lens build does not start with <!doctype html>');
    }
    if (!/<\/html>\s*$/i.test(html)) {
      throw new Error('Plain Fantasy Lens build is incomplete');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Fantasy-Lens-Loader', 'plain-concatenation');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Fantasy Lens plain loader failed', error);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send(`Fantasy Lens plain loader failed: ${error?.message || error}`);
  }
}
