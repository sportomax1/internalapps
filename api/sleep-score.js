const OURA_BASE_URL = 'https://api.ouraring.com/v2/usercollection';

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function isoDay(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAll(endpoint, params, apiKey) {
  const records = [];
  let nextToken = '';

  do {
    const url = new URL(`${OURA_BASE_URL}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    if (nextToken) url.searchParams.set('next_token', nextToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = response.status === 401
        ? 'Oura authorization failed. Check OURA_KEY.'
        : response.status === 429
          ? 'Oura rate limit reached. Try again shortly.'
          : body.detail || body.title || `Oura API error ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    if (Array.isArray(body.data)) records.push(...body.data);
    nextToken = body.next_token || '';
  } while (nextToken);

  return records;
}

function durationSeconds(record) {
  const explicit = numberOrNull(record.total_sleep_duration);
  if (explicit !== null) return explicit;
  const start = new Date(record.bedtime_start).getTime();
  const end = new Date(record.bedtime_end).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : 0;
}

function isNap(record) {
  const type = String(record.type || '').toLowerCase();
  if (type.includes('nap') || type.includes('rest')) return true;
  if (type.includes('long_sleep')) return false;

  const start = new Date(record.bedtime_start);
  const end = new Date(record.bedtime_end);
  const seconds = durationSeconds(record);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return seconds < 3 * 3600;

  const startHour = start.getHours() + start.getMinutes() / 60;
  return seconds < 3 * 3600 && startHour >= 8 && startHour < 20;
}

function normalize(sleepRecords, dailySleepRecords) {
  const scoreByDay = new Map(
    dailySleepRecords
      .filter((record) => record.day)
      .map((record) => [record.day, numberOrNull(record.score)])
  );

  const periods = sleepRecords
    .filter((record) => record.bedtime_start && record.bedtime_end && String(record.type || '').toLowerCase() !== 'deleted')
    .map((record) => {
      const day = record.day || isoDay(record.bedtime_end || record.bedtime_start);
      return {
        id: record.id || `${day}-${record.bedtime_start}`,
        day,
        bedtimeStart: record.bedtime_start,
        bedtimeEnd: record.bedtime_end,
        totalSleepSeconds: durationSeconds(record),
        timeInBedSeconds: numberOrNull(record.time_in_bed),
        efficiency: numberOrNull(record.efficiency),
        type: record.type || null,
        isNap: isNap(record),
      };
    })
    .sort((a, b) => new Date(a.bedtimeStart) - new Date(b.bedtimeStart));

  const grouped = new Map();
  for (const period of periods) {
    if (!grouped.has(period.day)) grouped.set(period.day, []);
    grouped.get(period.day).push(period);
  }

  const days = [...grouped.entries()].map(([day, dayPeriods]) => {
    const mainCandidates = dayPeriods.filter((period) => !period.isNap);
    const mainSleep = (mainCandidates.length ? mainCandidates : dayPeriods)
      .slice()
      .sort((a, b) => b.totalSleepSeconds - a.totalSleepSeconds)[0] || null;
    const naps = dayPeriods.filter((period) => period.id !== mainSleep?.id && (period.isNap || period.totalSleepSeconds < mainSleep.totalSleepSeconds));

    return {
      day,
      sleepScore: scoreByDay.get(day) ?? null,
      mainSleep,
      naps,
      napCount: naps.length,
      napSleepSeconds: naps.reduce((sum, nap) => sum + (nap.totalSleepSeconds || 0), 0),
    };
  });

  for (const [day, score] of scoreByDay.entries()) {
    if (!grouped.has(day)) days.push({ day, sleepScore: score, mainSleep: null, naps: [], napCount: 0, napSleepSeconds: 0 });
  }

  return days.sort((a, b) => a.day.localeCompare(b.day));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method not allowed.' });

  const suppliedPassword = req.headers['x-app-password'] || '';
  if (!process.env.APP_PASSWORD || suppliedPassword !== process.env.APP_PASSWORD) {
    return json(res, 401, { ok: false, error: 'Incorrect password.' });
  }
  if (!process.env.OURA_KEY) return json(res, 500, { ok: false, error: 'OURA_KEY is not configured.' });

  const today = new Date();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : isoDay(addDays(today, -90));
  const end = /^\d{4}-\d{2}-\d{2}$/.test(req.query.end || '') ? req.query.end : isoDay(today);

  try {
    const params = { start_date: start, end_date: end };
    const [sleep, dailySleep] = await Promise.all([
      fetchAll('sleep', params, process.env.OURA_KEY),
      fetchAll('daily_sleep', params, process.env.OURA_KEY),
    ]);
    const days = normalize(sleep, dailySleep);
    return json(res, 200, { ok: true, fetchedAt: new Date().toISOString(), range: { start, end }, count: days.length, days });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, error: error.message || 'Unable to load sleep data.' });
  }
}
