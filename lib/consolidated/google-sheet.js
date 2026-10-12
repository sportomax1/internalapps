function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=300, stale-while-revalidate=3600' : 'no-store');
  res.end(JSON.stringify(payload));
}

function parseGviz(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Google Sheets returned an unreadable response.');
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status === 'error') {
    const message = payload.errors?.map((item) => item.detailed_message || item.message).filter(Boolean).join(' ') || 'Google Sheets query failed.';
    throw new Error(message);
  }
  const table = payload.table || {};
  const headers = (table.cols || []).map((col, index) => col.label || col.id || `Column ${index + 1}`);
  const rows = (table.rows || []).map((row, rowIndex) => {
    const values = headers.map((_, index) => row.c?.[index]?.v ?? null);
    const formattedValues = headers.map((_, index) => row.c?.[index]?.f ?? (row.c?.[index]?.v ?? null));
    const record = {};
    headers.forEach((header, index) => { record[header] = formattedValues[index]; });
    return { rowIndex: rowIndex + 2, values, formattedValues, record };
  });
  return { headers, rows, totalRows: rows.length };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method not allowed.' });

  const expectedPassword = process.env.PERSONAL_PASSWORD || process.env.APP_PASSWORD;
  const suppliedPassword = req.headers['x-app-password'] || '';
  if (expectedPassword && suppliedPassword !== expectedPassword) {
    return json(res, 401, { ok: false, error: 'Incorrect password.' });
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return json(res, 500, { ok: false, error: 'GOOGLE_SHEET_ID is not configured.' });

  const sheet = String(req.query.sheet || '').trim();
  const range = String(req.query.range || '').trim();
  const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq`);
  url.searchParams.set('tqx', 'out:json');
  url.searchParams.set('headers', '1');
  if (sheet) url.searchParams.set('sheet', sheet);
  if (range) url.searchParams.set('range', range);

  try {
    const upstream = await fetch(url, { headers: { Accept: 'text/plain,*/*' } });
    const text = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { ok: false, error: `Google Sheets returned ${upstream.status}.`, detail: text.slice(0, 300) });
    }
    if (/<!doctype html|<html/i.test(text)) {
      return json(res, 403, {
        ok: false,
        error: 'The spreadsheet is not readable by the server. Share it as Anyone with the link → Viewer, or configure a Google service-account based reader.'
      });
    }
    const data = parseGviz(text);
    return json(res, 200, {
      ok: true,
      spreadsheetId,
      sheet: sheet || null,
      range: range || null,
      fetchedAt: new Date().toISOString(),
      ...data
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Unable to read Google Sheet.' });
  }
}
