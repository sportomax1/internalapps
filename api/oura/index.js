const OURA_BASE_URL = 'https://api.ouraring.com/v2/usercollection';

const json = (res, status, payload) => {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const toIsoDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

async function fetchOura(endpoint, params, apiKey) {
  const url = new URL(`${OURA_BASE_URL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  console.log(`[oura-api] API called: ${endpoint}`, Object.fromEntries(url.searchParams));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    console.error(`[oura-api] Bad JSON from ${endpoint}`, { status: response.status, text });
    throw Object.assign(new Error('Oura returned bad JSON.'), {
      status: 502,
      details: text.slice(0, 500),
    });
  }

  console.log(`[oura-api] API response: ${endpoint}`, {
    status: response.status,
    records: Array.isArray(body.data) ? body.data.length : 0,
  });

  if (!response.ok) {
    const friendly = response.status === 401
      ? 'Unauthorized. Check OURA_KEY.'
      : response.status === 429
        ? 'Oura rate limit hit. Try again in a few minutes.'
        : body.detail || body.title || `Oura API error: ${response.status}`;

    throw Object.assign(new Error(friendly), {
      status: response.status,
      details: body,
    });
  }

  return Array.isArray(body.data) ? body.data : [];
}

function normalizeSleep(sleepRecords, readinessRecords) {
  const readinessByDay = new Map();

  for (const record of readinessRecords || []) {
    const day = record.day || toIsoDate(record.timestamp);
    if (!day) continue;
    readinessByDay.set(day, {
      readiness: safeNumber(record.score),
      hrv: safeNumber(record.contributors?.hrv_balance ?? record.average_hrv),
      restingHr: safeNumber(record.contributors?.resting_heart_rate ?? record.lowest_heart_rate),
    });
  }

  return (sleepRecords || [])
    .map((record) => {
      const bedtimeStart = record.bedtime_start || record.bedtimeStart || record.start_datetime;
      const bedtimeEnd = record.bedtime_end || record.bedtimeEnd || record.end_datetime;
      const day = record.day || toIsoDate(bedtimeEnd || bedtimeStart);
      const readiness = readinessByDay.get(day) || {};

      return {
        id: record.id || `${day}-${bedtimeStart || ''}`,
        day,
        bedtimeStart,
        bedtimeEnd,
        totalSleepSeconds: safeNumber(record.total_sleep_duration),
        sleepScore: safeNumber(record.score),
        efficiency: safeNumber(record.efficiency),
        deepSleepSeconds: safeNumber(record.deep_sleep_duration),
        remSleepSeconds: safeNumber(record.rem_sleep_duration),
        restingHr: safeNumber(record.lowest_heart_rate ?? readiness.restingHr),
        hrv: safeNumber(record.average_hrv ?? readiness.hrv),
        readiness: readiness.readiness ?? null,
      };
    })
    .filter((record) => record.day && record.bedtimeStart && record.bedtimeEnd)
    .sort((a, b) => a.day.localeCompare(b.day));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, error: 'Method not allowed. Use GET.' });
  }

  console.log('[oura-api] Fetch started', { query: req.query });

  const apiKey = process.env.OURA_KEY;
  if (!apiKey) {
    console.error('[oura-api] Missing OURA_KEY in Vercel environment.');
    return json(res, 500, {
      ok: false,
      error: 'Oura key missing in Vercel.',
      code: 'MISSING_OURA_KEY',
    });
  }

  if (req.query.status === '1') {
    return json(res, 200, {
      ok: true,
      message: 'OURA_KEY is configured.',
      checkedAt: new Date().toISOString(),
    });
  }

  const today = new Date();
  const requestedEnd = req.query.end || toIsoDate(today);
  const requestedStart = req.query.start || toIsoDate(addDays(today, -365));
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) ? requestedStart : toIsoDate(addDays(today, -365));
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedEnd) ? requestedEnd : toIsoDate(today);

  try {
    const params = { start_date: startDate, end_date: endDate };
    const [sleep, readiness] = await Promise.all([
      fetchOura('sleep', params, apiKey),
      fetchOura('daily_readiness', params, apiKey).catch((error) => {
        console.warn('[oura-api] Readiness fetch failed; continuing with sleep records only.', {
          message: error.message,
          status: error.status,
        });
        return [];
      }),
    ]);

    const records = normalizeSleep(sleep, readiness);
    console.log('[oura-api] Records loaded', { records: records.length, startDate, endDate });

    return json(res, 200, {
      ok: true,
      source: 'oura',
      fetchedAt: new Date().toISOString(),
      range: { start: startDate, end: endDate },
      count: records.length,
      records,
    });
  } catch (error) {
    console.error('[oura-api] Error details', {
      message: error.message,
      status: error.status,
      details: error.details,
    });

    return json(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to load Oura data.',
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 429 ? 'RATE_LIMIT' : 'OURA_FETCH_FAILED',
      details: error.details || null,
    });
  }
}
