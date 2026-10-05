const MAX_ITEMS = 25;
const CONCURRENCY = 5;

const tokenState =
  globalThis.__internalAppsPackageTokens ||
  (globalThis.__internalAppsPackageTokens = new Map());

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

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/&reg;|&#174;/gi, "®").trim();
}

function canonicalStatus(...values) {
  const text = values.filter(Boolean).join(" ").toLowerCase();

  if (/delivered|delivery complete/.test(text)) return "delivered";
  if (/out for delivery|on vehicle for delivery|with delivery courier/.test(text)) return "out_for_delivery";
  if (/available for pickup|ready for pickup|held for pickup|pickup ready/.test(text)) return "available_for_pickup";
  if (/return(ed|ing)? to sender|return to sender/.test(text)) return "return_to_sender";
  if (/exception|delay|delayed|failed|delivery attempted|notice left|unable to deliver/.test(text)) return "exception";
  if (/label created|pre[- ]?shipment|awaiting item|shipment information sent|electronic notification/.test(text)) return "pre_transit";
  if (/in transit|moving through network|arrived|departed|accepted|picked up|on the way|processed|origin scan|destination scan/.test(text)) return "in_transit";
  return "unknown";
}

function apiErrorMessage(data, fallback) {
  return (
    data?.error?.message ||
    data?.error?.errors?.[0]?.detail ||
    data?.error?.errors?.[0]?.message ||
    data?.errors?.[0]?.message ||
    data?.response?.errors?.[0]?.message ||
    data?.output?.cxsErrors?.[0]?.message ||
    data?.message ||
    fallback
  );
}

class CarrierError extends Error {
  constructor(message, { carrier, code, status } = {}) {
    super(message);
    this.carrier = carrier || null;
    this.code = code || null;
    this.status = status || null;
  }
}

async function jsonFetch(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    if (error?.name === "AbortError") throw new CarrierError("Carrier request timed out.");
    throw new CarrierError("Could not reach the carrier API.");
  } finally {
    clearTimeout(timer);
  }
}

async function cachedToken(key, fetcher) {
  const now = Date.now();
  const existing = tokenState.get(key);

  if (existing?.token && existing.expiresAt > now + 60000) return existing.token;
  if (existing?.promise) return existing.promise;

  const promise = (async () => {
    const result = await fetcher();
    const expiresIn = Math.max(Number(result.expires_in || result.expiresIn || 3600), 180);
    const entry = {
      token: result.access_token,
      expiresAt: Date.now() + Math.max(expiresIn - 120, 60) * 1000
    };
    tokenState.set(key, entry);
    return entry.token;
  })();

  tokenState.set(key, { promise });

  try {
    return await promise;
  } catch (error) {
    tokenState.delete(key);
    throw error;
  }
}

function carrierConfigured(carrier) {
  if (carrier === "usps") return Boolean(process.env.USPS_CLIENT_ID && process.env.USPS_CLIENT_SECRET);
  if (carrier === "fedex") return Boolean(process.env.FEDEX_CLIENT_ID && process.env.FEDEX_CLIENT_SECRET);
  if (carrier === "ups") return Boolean(process.env.UPS_CLIENT_ID && process.env.UPS_CLIENT_SECRET);
  return false;
}

function missingCredentialMessage(carrier) {
  if (carrier === "usps") return "USPS tracking needs USPS_CLIENT_ID and USPS_CLIENT_SECRET in Vercel.";
  if (carrier === "fedex") return "FedEx tracking needs FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET in Vercel.";
  if (carrier === "ups") return "UPS tracking needs UPS_CLIENT_ID and UPS_CLIENT_SECRET in Vercel.";
  return "Carrier API credentials are not configured.";
}

function carrierCandidates(code, explicitCarrier = "") {
  if (["ups", "fedex", "usps"].includes(explicitCarrier)) return [explicitCarrier];

  if (/^1Z[0-9A-Z]{16}$/.test(code)) return ["ups"];
  if (/^[A-Z]{2}\d{9}US$/.test(code)) return ["usps"];

  if (/^\d+$/.test(code)) {
    if ([26, 30, 34].includes(code.length)) return ["usps"];
    if ([12, 15].includes(code.length)) return ["fedex"];
    if ([20, 22].includes(code.length)) {
      if (/^(92|93|94|95|96|97|98|99)/.test(code)) return ["usps", "fedex"];
      return ["fedex", "usps"];
    }
  }

  return ["ups", "fedex", "usps"];
}

/* ---------------- USPS ---------------- */

async function getUspsToken() {
  if (!carrierConfigured("usps")) {
    throw new CarrierError(missingCredentialMessage("usps"), {
      carrier: "usps",
      code: "CARRIER_NOT_CONFIGURED"
    });
  }

  return cachedToken("usps", async () => {
    const { response, data } = await jsonFetch("https://apis.usps.com/oauth2/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: process.env.USPS_CLIENT_ID,
        client_secret: process.env.USPS_CLIENT_SECRET
      })
    });

    if (!response.ok || !data.access_token) {
      throw new CarrierError(apiErrorMessage(data, "USPS authentication failed."), {
        carrier: "usps",
        code: "USPS_AUTH",
        status: response.status
      });
    }
    return data;
  });
}

function normalizeUsps(record, code) {
  const events = Array.isArray(record?.trackingEvents) ? record.trackingEvents : [];
  const statusText = record?.status || record?.statusCategory || "";
  const detail = record?.statusSummary || statusText || "USPS tracking update";
  const eta =
    record?.deliveryDateExpectation?.expectedDeliveryDate ||
    record?.deliveryDateExpectation?.predictedDeliveryDate ||
    record?.deliveryDateExpectation?.guaranteedDeliveryDate ||
    null;

  const normalizedEvents = events
    .map(e => ({
      datetime: e.eventTimestamp || e.GMTTimestamp || null,
      message: e.eventType || e.eventDescription || null,
      status: canonicalStatus(e.eventType),
      statusDetail: e.eventType || null,
      location: {
        city: e.eventCity || null,
        state: e.eventState || null,
        country: e.eventCountry || null,
        zip: e.eventZIPCode || e.eventZIP || null
      }
    }))
    .sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));

  return {
    ok: true,
    trackingCode: record?.trackingNumber || code,
    carrier: "usps",
    carrierLabel: "USPS",
    status: canonicalStatus(record?.statusCategory, record?.status, record?.statusSummary),
    statusDetail: detail,
    estimatedDelivery: eta,
    estimatedDeliveryTime:
      record?.deliveryDateExpectation?.predictedDeliveryWindowEndTime ||
      record?.deliveryDateExpectation?.endOfDay ||
      null,
    service: stripHtml(record?.mailClass || record?.services?.[0] || ""),
    signedBy: normalizedEvents.find(e => /delivered/i.test(e.message || ""))?.recipientName || null,
    updatedAt: normalizedEvents[0]?.datetime || null,
    events: normalizedEvents
  };
}

async function trackUsps(code) {
  const token = await getUspsToken();

  const { response, data } = await jsonFetch("https://apis.usps.com/tracking/v3r2/tracking", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify([{ trackingNumber: code }])
  });

  if (![200, 207].includes(response.status)) {
    throw new CarrierError(apiErrorMessage(data, `USPS tracking returned ${response.status}.`), {
      carrier: "usps",
      code: response.status === 404 ? "NOT_FOUND" : "USPS_TRACK",
      status: response.status
    });
  }

  const record = Array.isArray(data)
    ? data.find(x => x?.trackingNumber === code) || data[0]
    : data;

  if (!record || record.error) {
    throw new CarrierError(apiErrorMessage(record, "USPS did not return tracking information."), {
      carrier: "usps",
      code: "NOT_FOUND"
    });
  }

  return normalizeUsps(record, code);
}

/* ---------------- FedEx ---------------- */

async function getFedexToken() {
  if (!carrierConfigured("fedex")) {
    throw new CarrierError(missingCredentialMessage("fedex"), {
      carrier: "fedex",
      code: "CARRIER_NOT_CONFIGURED"
    });
  }

  return cachedToken("fedex", async () => {
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.FEDEX_CLIENT_ID,
      client_secret: process.env.FEDEX_CLIENT_SECRET
    });

    const { response, data } = await jsonFetch("https://apis.fedex.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: form.toString()
    });

    if (!response.ok || !data.access_token) {
      throw new CarrierError(apiErrorMessage(data, "FedEx authentication failed."), {
        carrier: "fedex",
        code: "FEDEX_AUTH",
        status: response.status
      });
    }
    return data;
  });
}

function fedexDate(track, types) {
  const values = Array.isArray(track?.dateAndTimes) ? track.dateAndTimes : [];
  for (const type of types) {
    const found = values.find(x => String(x?.type || "").toUpperCase() === type);
    if (found?.dateTime) return found.dateTime;
  }
  return null;
}

function normalizeFedex(track, code) {
  const latest = track?.latestStatusDetail || {};
  const scans = Array.isArray(track?.scanEvents) ? track.scanEvents : [];
  const latestText =
    latest?.statusByLocale ||
    latest?.description ||
    latest?.code ||
    "FedEx tracking update";

  const events = scans
    .map(e => ({
      datetime: e.date || e.dateTime || null,
      message: e.eventDescription || e.derivedStatus || e.eventType || null,
      status: canonicalStatus(e.derivedStatus, e.eventDescription, e.eventType),
      statusDetail: e.eventDescription || null,
      location: {
        city: e.scanLocation?.city || null,
        state: e.scanLocation?.stateOrProvinceCode || null,
        country: e.scanLocation?.countryCode || null,
        zip: e.scanLocation?.postalCode || null
      }
    }))
    .sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));

  return {
    ok: true,
    trackingCode: track?.trackingNumberInfo?.trackingNumber || code,
    carrier: "fedex",
    carrierLabel: "FedEx",
    status: canonicalStatus(latestText, events[0]?.message),
    statusDetail: latestText,
    estimatedDelivery: fedexDate(track, [
      "ESTIMATED_DELIVERY",
      "ESTIMATED_DELIVERY_DATE",
      "ACTUAL_DELIVERY"
    ]),
    estimatedDeliveryTime: null,
    service:
      track?.serviceDetail?.description ||
      track?.serviceDetail?.shortDescription ||
      null,
    signedBy:
      track?.deliveryDetails?.receivedByName ||
      track?.deliveryDetails?.signedByName ||
      null,
    updatedAt: events[0]?.datetime || null,
    events
  };
}

async function trackFedex(code) {
  const token = await getFedexToken();
  const transactionId =
    globalThis.crypto?.randomUUID?.() ||
    `internalapps-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { response, data } = await jsonFetch("https://apis.fedex.com/track/v1/trackingnumbers", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-locale": "en_US",
      "x-customer-transaction-id": transactionId
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber: code } }]
    })
  });

  if (!response.ok) {
    throw new CarrierError(apiErrorMessage(data, `FedEx tracking returned ${response.status}.`), {
      carrier: "fedex",
      code: response.status === 404 ? "NOT_FOUND" : "FEDEX_TRACK",
      status: response.status
    });
  }

  const complete = data?.output?.completeTrackResults || [];
  const group = complete.find(x => x?.trackingNumber === code) || complete[0];
  const track = group?.trackResults?.[0];

  if (!track) {
    throw new CarrierError(
      data?.output?.cxsErrors?.[0]?.message || "FedEx did not return tracking information.",
      { carrier: "fedex", code: "NOT_FOUND" }
    );
  }

  return normalizeFedex(track, code);
}

/* ---------------- UPS ---------------- */

async function getUpsToken() {
  if (!carrierConfigured("ups")) {
    throw new CarrierError(missingCredentialMessage("ups"), {
      carrier: "ups",
      code: "CARRIER_NOT_CONFIGURED"
    });
  }

  return cachedToken("ups", async () => {
    const auth = Buffer.from(
      `${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`
    ).toString("base64");

    const headers = {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    };
    if (process.env.UPS_ACCOUNT_NUMBER) headers["x-merchant-id"] = process.env.UPS_ACCOUNT_NUMBER;

    const { response, data } = await jsonFetch(
      "https://onlinetools.ups.com/security/v1/oauth/token",
      {
        method: "POST",
        headers,
        body: "grant_type=client_credentials"
      }
    );

    if (!response.ok || !data.access_token) {
      throw new CarrierError(apiErrorMessage(data, "UPS authentication failed."), {
        carrier: "ups",
        code: "UPS_AUTH",
        status: response.status
      });
    }
    return data;
  });
}

function compactDate(value) {
  const v = String(value || "");
  return /^\d{8}$/.test(v)
    ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
    : value || null;
}

function upsDateTime(date, time) {
  const d = compactDate(date);
  const t = String(time || "");
  if (!d) return null;
  if (/^\d{6}$/.test(t)) return `${d}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  return d;
}

function normalizeUps(pkg, code) {
  const current = pkg?.currentStatus || {};
  const statusText =
    current?.simplifiedTextDescription ||
    current?.description ||
    pkg?.statusDescription ||
    "UPS tracking update";

  const activities = Array.isArray(pkg?.activity) ? pkg.activity : [];
  const events = activities
    .map(a => ({
      datetime: upsDateTime(a?.date, a?.time),
      message:
        a?.status?.description ||
        a?.status?.simplifiedTextDescription ||
        a?.status?.type ||
        null,
      status: canonicalStatus(
        a?.status?.simplifiedTextDescription,
        a?.status?.description,
        a?.status?.type
      ),
      statusDetail: a?.status?.description || null,
      location: {
        city: a?.location?.address?.city || null,
        state: a?.location?.address?.stateProvince || null,
        country: a?.location?.address?.countryCode || null,
        zip: a?.location?.address?.postalCode || null
      }
    }))
    .sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));

  const deliveryDates = Array.isArray(pkg?.deliveryDate) ? pkg.deliveryDate : [];
  const etaRecord =
    deliveryDates.find(x => ["DEL", "EST"].includes(String(x?.type || "").toUpperCase())) ||
    deliveryDates[0];

  return {
    ok: true,
    trackingCode: code,
    carrier: "ups",
    carrierLabel: "UPS",
    status: canonicalStatus(statusText, events[0]?.message),
    statusDetail: statusText,
    estimatedDelivery: compactDate(etaRecord?.date),
    estimatedDeliveryTime:
      pkg?.deliveryTime?.endTime ||
      pkg?.deliveryTime?.startTime ||
      null,
    service: pkg?.service?.description || null,
    signedBy:
      pkg?.deliveryInformation?.receivedBy ||
      pkg?.deliveryInformation?.signature?.name ||
      null,
    updatedAt: events[0]?.datetime || null,
    events
  };
}

async function trackUps(code) {
  const token = await getUpsToken();
  const transId =
    globalThis.crypto?.randomUUID?.() ||
    `internalapps-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const url =
    `https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(code)}` +
    "?locale=en_US&returnSignature=false&returnMilestones=false&returnPOD=false";

  const { response, data } = await jsonFetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "transId": transId,
      "transactionSrc": "InternalApps"
    }
  });

  if (!response.ok) {
    throw new CarrierError(apiErrorMessage(data, `UPS tracking returned ${response.status}.`), {
      carrier: "ups",
      code: response.status === 404 ? "NOT_FOUND" : "UPS_TRACK",
      status: response.status
    });
  }

  const shipment = data?.trackResponse?.shipment?.[0];
  const pkg = shipment?.package?.[0];

  if (!pkg) {
    throw new CarrierError("UPS did not return tracking information.", {
      carrier: "ups",
      code: "NOT_FOUND"
    });
  }

  return normalizeUps(pkg, code);
}

/* ---------------- Router ---------------- */

async function trackCarrier(carrier, code) {
  if (carrier === "usps") return trackUsps(code);
  if (carrier === "fedex") return trackFedex(code);
  if (carrier === "ups") return trackUps(code);
  throw new CarrierError("Unsupported carrier.", { carrier, code: "UNSUPPORTED_CARRIER" });
}

async function trackOne(item) {
  const trackingCode = cleanTracking(item?.trackingCode);
  const explicitCarrier = String(item?.carrier || "").toLowerCase();

  if (
    !trackingCode ||
    trackingCode.length < 7 ||
    trackingCode.length > 40 ||
    !/^[A-Z0-9-]+$/.test(trackingCode)
  ) {
    return {
      ok: false,
      trackingCode,
      carrier: explicitCarrier || null,
      errorCode: "INVALID_TRACKING_NUMBER",
      error: "Invalid tracking number."
    };
  }

  const candidates = carrierCandidates(trackingCode, explicitCarrier);
  const configured = candidates.filter(carrierConfigured);

  if (!configured.length) {
    const primary = candidates[0];
    return {
      ok: false,
      trackingCode,
      carrier: primary,
      errorCode: "CARRIER_NOT_CONFIGURED",
      error: missingCredentialMessage(primary),
      needsCarrier: candidates.length > 1,
      candidates
    };
  }

  const errors = [];

  for (const carrier of configured) {
    try {
      return await trackCarrier(carrier, trackingCode);
    } catch (error) {
      errors.push({
        carrier,
        code: error?.code || "TRACKING_ERROR",
        status: error?.status || null,
        message: error?.message || "Tracking request failed."
      });

      // For an unambiguous tracking number, no reason to try a different carrier.
      if (candidates.length === 1) break;
    }
  }

  const first = errors[0] || {};
  return {
    ok: false,
    trackingCode,
    carrier: first.carrier || candidates[0] || null,
    errorCode: first.code || "TRACKING_ERROR",
    error: first.message || "No carrier returned tracking information.",
    needsCarrier: candidates.length > 1,
    candidates,
    attempts: errors
  };
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

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, run)
  );
  return results;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return send(res, 200, {
      provider: "direct-carrier-apis",
      configured: {
        usps: carrierConfigured("usps"),
        fedex: carrierConfigured("fedex"),
        ups: carrierConfigured("ups")
      }
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const input = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!input.length) return send(res, 400, { error: "No tracking numbers supplied." });
  if (input.length > MAX_ITEMS) {
    return send(res, 400, { error: `Maximum ${MAX_ITEMS} tracking numbers per request.` });
  }

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

  const results = await mapLimit(items, CONCURRENCY, trackOne);

  return send(res, 200, {
    provider: "direct-carrier-apis",
    checkedAt: new Date().toISOString(),
    configured: {
      usps: carrierConfigured("usps"),
      fedex: carrierConfigured("fedex"),
      ups: carrierConfigured("ups")
    },
    count: results.length,
    results
  });
}
