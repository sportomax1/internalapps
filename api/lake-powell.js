/**
 * Lake Powell data relay, limited to read-only, fixed third-party endpoints.
 * Browser -> /api/lake-powell?view=elevation|inflows|outflows|rivers|rivers30|rivers2yr
 */
const SOURCES = Object.freeze({
  elevation: "https://www.water-data.com/api/charts/all-time/elevation?lake_id=Lake%20Powell",
  inflows: "https://www.water-data.com/api/charts/all-time/inflows?lake_id=Lake%20Powell",
  outflows: "https://www.water-data.com/api/charts/all-time/outflows?lake_id=Lake%20Powell",
  rivers: "https://lakepowell.water-data.com/?get_rivers=1",
  rivers30: "https://lakepowell.water-data.com/?get_rivers_30d=1",
  rivers2yr: "https://lakepowell.water-data.com/?get_rivers_2yr=1"
});
const FAST = new Set(["rivers", "rivers30"]);
const HEADERS = {
  Accept: "application/json, text/plain;q=0.8",
  "User-Agent": "InternalApps-LakePowellDashboard/1.0"
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Only GET is supported." });
  }
  const view = typeof req.query.view === "string" ? req.query.view : "";
  if (!Object.prototype.hasOwnProperty.call(SOURCES, view)) {
    return res.status(400).json({ error: "Invalid data view.", allowed: Object.keys(SOURCES) });
  }
  const upstream = SOURCES[view];
  try {
    const response = await fetch(upstream, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(18000)
    });
    if (!response.ok) {
      return res.status(502).json({
        error: "Lake Powell source returned an HTTP error.",
        upstreamStatus: response.status,
        source: new URL(upstream).hostname
      });
    }
    const type = response.headers.get("content-type") || "";
    if (type && !/json|text\/plain|octet-stream/i.test(type)) {
      return res.status(502).json({
        error: "Lake Powell source did not return JSON.",
        upstreamType: type.split(";")[0]
      });
    }
    const body = await response.text();
    if (body.length > 9_000_000) {
      return res.status(502).json({ error: "Lake Powell source response exceeded the size limit." });
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return res.status(502).json({ error: "Lake Powell source response is not valid JSON." });
    }
    if (!data || typeof data !== "object" || data.error) {
      return res.status(502).json({ error: "Lake Powell source returned an invalid dataset." });
    }
    const ttl = FAST.has(view) ? 300 : 1800;
    res.setHeader("Cache-Control", "public, s-maxage=" + ttl + ", stale-while-revalidate=" + ttl * 2);
    res.setHeader("X-Data-Source", new URL(upstream).hostname);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(JSON.stringify({ view, fetchedAt: new Date().toISOString(), data }));
  } catch (err) {
    const timedOut = err && err.name === "TimeoutError";
    return res.status(502).json({
      error: timedOut ? "Lake Powell source timed out." : "Lake Powell source could not be reached.",
      detail: err instanceof Error ? err.message : "Unknown source error"
    });
  }
}
