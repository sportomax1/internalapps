const EASYPOST_URL = "https://api.easypost.com/v2/trackers";
const MAX_ITEMS = 25;
const CONCURRENCY = 5;

function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.json(body);
}

function cleanTracking(value) {
  return String(value || "")
    .trim()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeCarrier(value) {
  const v = String(value || "").toLowerCase();
  if (v === "ups") return "UPS";
  if (v === "fedex") return "FedEx";
  if (v === "usps") return "USPS";
  return null;
}

function publicCarrier(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("fedex")) return "fedex";
  if (v.includes("usps") || v.includes("postal")) return "usps";
  if (v === "ups" || v.includes("united parcel")) return "ups";
  return v || "unknown";
}

function normalizeTracker(t) {
  const details = Array.isArray(t.tracking_details) ? t.tracking_details : [];
  return {
    ok: true,
    id: t.id || null,
    trackingCode: t.tracking_code || null,
    carrier: publicCarrier(t.carrier),
    carrierLabel: t.carrier || null,
    status: t.status || "unknown",
    statusDetail: t.status_detail || null,
    estimatedDelivery:
      t.est_delivery_date ||
      t.carrier_detail?.est_delivery_date_local ||
      t.carrier_detail?.est_delivery_date ||
      null,
    estimatedDeliveryTime:
      t.carrier_detail?.est_delivery_time_local || null,
    service: t.carrier_detail?.service || null,
    signedBy: t.signed_by || null,
    updatedAt: t.updated_at || null,
    events: details
      .slice()
      .sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0))
      .map(d => ({
        datetime: d.datetime || null,
        message: d.message || d.description || null,
        status: d.status || null,
        statusDetail: d.status_detail || null,
        location: {
          city: d.tracking_location?.city || null,
          state: d.tracking_location?.state || null,
          country: d.tracking_location?.country || null,
          zip: d.tracking_location?.zip || null
        }
      }))
  };
}

function errorMessage(data, fallback) {
  return (
    data?.error?.message ||
    data?.error?.errors?.[0]?.message ||
    data?.message ||
    fallback
  );
}

function errorCode(data) {
  return data?.error?.code || data?.code || null;
}

async function createTracker(apiKey, item) {
  const trackingCode = cleanTracking(item?.trackingCode);
  const carrier = normalizeCarrier(item?.carrier);

  if (!trackingCode || trackingCode.length < 4 || trackingCode.length > 40 || !/^[A-Z0-9-]+$/.test(trackingCode)) {
    return { ok: false, trackingCode, carrier: item?.carrier || null, error: "Invalid tracking number." };
  }

  const payload = { tracker: { tracking_code: trackingCode } };
  if (carrier) payload.tracker.carrier = carrier;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const auth = Buffer.from(`${apiKey}:`).toString("base64");
    const response = await fetch(EASYPOST_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const code = errorCode(data);
      return {
        ok: false,
        trackingCode,
        carrier: item?.carrier || null,
        errorCode: code,
        error: errorMessage(data, `Tracking provider returned ${response.status}.`),
        needsCarrier: code === "TRACKER.MULTIPLE_CARRIERS_FOR_CODE"
      };
    }

    return normalizeTracker(data);
  } catch (error) {
    return {
      ok: false,
      trackingCode,
      carrier: item?.carrier || null,
      error: error?.name === "AbortError" ? "Tracking lookup timed out." : "Could not reach the tracking provider."
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) {
    return send(res, 503, {
      error: "Live tracking is not configured on this Vercel project.",
      code: "TRACKING_NOT_CONFIGURED",
      setup: "Add EASYPOST_API_KEY to the Vercel project environment variables."
    });
  }

  const input = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!input.length) return send(res, 400, { error: "No tracking numbers supplied." });
  if (input.length > MAX_ITEMS) return send(res, 400, { error: `Maximum ${MAX_ITEMS} tracking numbers per request.` });

  const seen = new Set();
  const items = [];
  for (const item of input) {
    const trackingCode = cleanTracking(item?.trackingCode);
    const carrier = String(item?.carrier || "").toLowerCase();
    const key = `${trackingCode}|${carrier}`;
    if (!trackingCode || seen.has(key)) continue;
    seen.add(key);
    items.push({ trackingCode, carrier });
  }

  const results = await mapLimit(items, CONCURRENCY, item => createTracker(apiKey, item));
  return send(res, 200, {
    provider: "EasyPost",
    checkedAt: new Date().toISOString(),
    count: results.length,
    results
  });
}
