(() => {
  const MILES_PER_KM = 0.621371;
  const MAX_REASONABLE_MPH = 85;
  const activeLogSegments = [];
  const elements = {};

  const ids = [
    "activeLogStatus", "activeLogClearButton", "activeLogSegmentTotal", "activeLogTimeTotal",
    "activeLogDistanceTotal", "activeLogMaxSpeedTotal", "analyticsYearBody", "analyticsMonthBody",
    "analyticsWeekBody", "analyticsDayBody", "analyticsSegmentBody", "fileInput", "uploadZone",
    "startDateInput", "endDateInput", "clearAllButton",
  ];

  function initElements() {
    ids.forEach((id) => { elements[id] = document.getElementById(id); });
  }

  function timestamp(value) {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function directChildText(node, localName) {
    return [...node.children].find((child) => child.localName?.toLowerCase() === localName.toLowerCase())?.textContent?.trim() || "";
  }

  function descendants(node, localName) {
    return [...node.getElementsByTagNameNS("*", localName)];
  }

  function numberOrNull(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function haversineKm(a, b) {
    const radius = 6371.0088;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const dLat = toRadians(b.lat - a.lat);
    const dLon = toRadians(b.lon - a.lon);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }

  function parseGpxActiveLog(text, fileName) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror") || xml.documentElement.localName?.toLowerCase() !== "gpx") {
      throw new Error(`${fileName}: not a valid GPX file.`);
    }
    const rows = [];
    descendants(xml.documentElement, "trk").forEach((track) => {
      const trackName = directChildText(track, "name") || "Track";
      if (!/^active\s+log$/i.test(trackName.trim())) return;
      descendants(track, "trkseg").forEach((segment, segmentIndex) => {
        const points = descendants(segment, "trkpt").map((node, pointIndex) => {
          const lat = numberOrNull(node.getAttribute("lat"));
          const lon = numberOrNull(node.getAttribute("lon"));
          if (lat === null || lon === null) return null;
          return {
            lat,
            lon,
            time: directChildText(node, "time") || null,
            depth: numberOrNull(descendants(node, "depth")[0]?.textContent),
            sourceIndex: pointIndex,
          };
        }).filter(Boolean);
        if (points.length > 1) rows.push({ fileName, trackName, segmentIndex, points });
      });
    });
    return rows;
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return "—";
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : "—";
  }

  function localDateKey(ms) {
    const date = new Date(ms);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function localMonthKey(ms) {
    return localDateKey(ms).slice(0, 7);
  }

  function isoWeekKey(ms) {
    const date = new Date(ms);
    const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function yearKey(ms) {
    return String(new Date(ms).getFullYear());
  }

  function selectedRange() {
    return {
      start: elements.startDateInput?.value ? Date.parse(elements.startDateInput.value) : null,
      end: elements.endDateInput?.value ? Date.parse(elements.endDateInput.value) : null,
    };
  }

  function summarizeSegment(segment) {
    const { start, end } = selectedRange();
    const points = segment.points.filter((point) => {
      const value = timestamp(point.time);
      if (value === null) return false;
      return (!start || value >= start) && (!end || value <= end);
    });
    if (points.length < 2) return null;

    let distanceMiles = 0;
    let maxMph = null;
    const depths = [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const km = haversineKm(previous, current);
      const miles = km * MILES_PER_KM;
      distanceMiles += miles;
      const t1 = timestamp(previous.time);
      const t2 = timestamp(current.time);
      const hours = t1 !== null && t2 !== null && t2 > t1 ? (t2 - t1) / 3600000 : null;
      const mph = hours ? miles / hours : null;
      if (Number.isFinite(mph) && mph <= MAX_REASONABLE_MPH) maxMph = Math.max(maxMph ?? 0, mph);
    }
    points.forEach((point) => { if (Number.isFinite(point.depth)) depths.push(point.depth); });
    const times = points.map((point) => timestamp(point.time)).filter((value) => value !== null);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const durationMs = maxTime - minTime;
    const avgMph = durationMs > 0 ? distanceMiles / (durationMs / 3600000) : null;
    return {
      ...segment,
      points,
      startTime: minTime,
      endTime: maxTime,
      durationMs,
      distanceMiles,
      avgMph,
      maxMph,
      minDepth: depths.length ? Math.min(...depths) : null,
      maxDepth: depths.length ? Math.max(...depths) : null,
      pointCount: points.length,
    };
  }

  function fingerprint(segment) {
    const first = segment.points[0];
    const last = segment.points[segment.points.length - 1];
    return [
      segment.startTime,
      segment.endTime,
      segment.pointCount,
      first.lat.toFixed(5), first.lon.toFixed(5),
      last.lat.toFixed(5), last.lon.toFixed(5),
    ].join("|");
  }

  function addToBucket(map, key, segment) {
    if (!map.has(key)) {
      map.set(key, { label: key, segments: 0, durationMs: 0, distanceMiles: 0, weightedMphMiles: 0, maxMph: null, points: 0 });
    }
    const row = map.get(key);
    row.segments += 1;
    row.durationMs += segment.durationMs;
    row.distanceMiles += segment.distanceMiles;
    row.weightedMphMiles += (segment.avgMph || 0) * segment.distanceMiles;
    row.maxMph = Math.max(row.maxMph ?? 0, segment.maxMph ?? 0);
    row.points += segment.pointCount;
  }

  function rowHtml(row) {
    const avg = row.distanceMiles > 0 ? row.weightedMphMiles / row.distanceMiles : null;
    return `<tr><td>${row.label}</td><td>${row.segments.toLocaleString()}</td><td>${formatDuration(row.durationMs)}</td><td>${formatNumber(row.distanceMiles)}</td><td>${formatNumber(avg)}</td><td>${formatNumber(row.maxMph)}</td></tr>`;
  }

  function renderTable(body, rows, emptyText = "No ACTIVE LOG data") {
    if (!body) return;
    body.innerHTML = rows.length ? rows.map(rowHtml).join("") : `<tr><td colspan="6" class="analytics-empty">${emptyText}</td></tr>`;
  }

  function renderSegmentTable(body, rows) {
    if (!body) return;
    body.innerHTML = rows.length ? rows.map((segment) => `
      <tr>
        <td title="${segment.fileName}">${localDateKey(segment.startTime)}</td>
        <td>${formatDuration(segment.durationMs)}</td>
        <td>${formatNumber(segment.distanceMiles)}</td>
        <td>${formatNumber(segment.avgMph)}</td>
        <td>${formatNumber(segment.maxMph)}</td>
        <td>${segment.pointCount.toLocaleString()}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="analytics-empty">No ACTIVE LOG segments</td></tr>`;
  }

  function renderAnalytics() {
    const deduped = new Map();
    activeLogSegments.map(summarizeSegment).filter(Boolean).forEach((segment) => {
      deduped.set(fingerprint(segment), segment);
    });
    const segments = [...deduped.values()].sort((a, b) => a.startTime - b.startTime);
    const totals = { label: "Total", segments: 0, durationMs: 0, distanceMiles: 0, weightedMphMiles: 0, maxMph: null, points: 0 };
    const buckets = { year: new Map(), month: new Map(), week: new Map(), day: new Map() };

    segments.forEach((segment) => {
      addToBucket(new Map([["Total", totals]]), "Total", segment);
      addToBucket(buckets.year, yearKey(segment.startTime), segment);
      addToBucket(buckets.month, localMonthKey(segment.startTime), segment);
      addToBucket(buckets.week, isoWeekKey(segment.startTime), segment);
      addToBucket(buckets.day, localDateKey(segment.startTime), segment);
    });

    elements.activeLogSegmentTotal.textContent = totals.segments.toLocaleString();
    elements.activeLogTimeTotal.textContent = formatDuration(totals.durationMs);
    elements.activeLogDistanceTotal.textContent = Number.isFinite(totals.distanceMiles) && totals.distanceMiles > 0 ? `${totals.distanceMiles.toFixed(1)} mi` : "—";
    elements.activeLogMaxSpeedTotal.textContent = Number.isFinite(totals.maxMph) && totals.maxMph > 0 ? `${totals.maxMph.toFixed(1)}` : "—";
    elements.activeLogClearButton.disabled = activeLogSegments.length === 0;
    elements.activeLogStatus.textContent = activeLogSegments.length
      ? `${segments.length.toLocaleString()} unique ACTIVE LOG segment${segments.length === 1 ? "" : "s"} shown. Exact duplicate imports are deduped; speeds over ${MAX_REASONABLE_MPH} mph are ignored for max-speed stats.`
      : "Load GPX files with an ACTIVE LOG track to compare ride time, distance, speed, and segment counts.";

    renderTable(elements.analyticsYearBody, [...buckets.year.values()].sort((a, b) => b.label.localeCompare(a.label)));
    renderTable(elements.analyticsMonthBody, [...buckets.month.values()].sort((a, b) => b.label.localeCompare(a.label)));
    renderTable(elements.analyticsWeekBody, [...buckets.week.values()].sort((a, b) => b.label.localeCompare(a.label)));
    renderTable(elements.analyticsDayBody, [...buckets.day.values()].sort((a, b) => b.label.localeCompare(a.label)));
    renderSegmentTable(elements.analyticsSegmentBody, [...segments].sort((a, b) => b.startTime - a.startTime).slice(0, 250));
  }

  async function ingestFiles(fileList) {
    const files = [...fileList].filter((file) => file.name.toLowerCase().endsWith(".gpx"));
    if (!files.length) return;
    const errors = [];
    for (const file of files) {
      try {
        activeLogSegments.push(...parseGpxActiveLog(await file.text(), file.name));
      } catch (error) {
        errors.push(error.message || `${file.name}: could not parse ACTIVE LOG data.`);
      }
    }
    renderAnalytics();
    if (errors.length) elements.activeLogStatus.textContent = errors.join(" ");
  }

  function clearAnalytics() {
    activeLogSegments.length = 0;
    renderAnalytics();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initElements();
    renderAnalytics();
    elements.fileInput?.addEventListener("change", () => ingestFiles(elements.fileInput.files));
    elements.uploadZone?.addEventListener("drop", (event) => ingestFiles(event.dataTransfer.files));
    elements.startDateInput?.addEventListener("input", renderAnalytics);
    elements.startDateInput?.addEventListener("change", renderAnalytics);
    elements.endDateInput?.addEventListener("input", renderAnalytics);
    elements.endDateInput?.addEventListener("change", renderAnalytics);
    elements.activeLogClearButton?.addEventListener("click", clearAnalytics);
    elements.clearAllButton?.addEventListener("click", clearAnalytics);
  });
})();
