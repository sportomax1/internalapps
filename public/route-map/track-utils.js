const EARTH_RADIUS_KM = 6371.0088;

export function timeValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function haversineKm(a, b) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function enrichPoints(points) {
  let distanceKm = 0;
  return points.map((point, index) => {
    const previous = points[index - 1];
    const segmentKm = previous ? haversineKm(previous, point) : 0;
    distanceKm += segmentKm;
    const currentTime = timeValue(point.time);
    const previousTime = timeValue(previous?.time);
    const elapsedHours = currentTime && previousTime && currentTime > previousTime
      ? (currentTime - previousTime) / 3600000
      : null;
    return {
      ...point,
      sourceIndex: point.sourceIndex ?? index,
      segmentKm,
      distanceKm,
      speedKph: elapsedHours ? segmentKm / elapsedHours : point.speedKph ?? null,
    };
  });
}

export function filterPointsByDate(points, startTime, endTime) {
  if (!startTime && !endTime) return points;
  return points.filter((point) => {
    const timestamp = timeValue(point.time);
    if (timestamp === null) return true;
    return (!startTime || timestamp >= startTime) && (!endTime || timestamp <= endTime);
  });
}

export function trackStats(points) {
  if (!points.length) {
    return { distanceKm: 0, durationMs: 0, averageKph: null, elevationGainM: 0, minElevationM: null, maxElevationM: null };
  }
  let distanceKm = 0;
  let elevationGainM = 0;
  const elevations = [];
  const times = [];
  points.forEach((point, index) => {
    if (index) {
      distanceKm += haversineKm(points[index - 1], point);
      const previousElevation = points[index - 1].elevation;
      if (Number.isFinite(point.elevation) && Number.isFinite(previousElevation)) {
        elevationGainM += Math.max(0, point.elevation - previousElevation);
      }
    }
    if (Number.isFinite(point.elevation)) elevations.push(point.elevation);
    const timestamp = timeValue(point.time);
    if (timestamp !== null) times.push(timestamp);
  });
  let minimumTime = Number.POSITIVE_INFINITY;
  let maximumTime = Number.NEGATIVE_INFINITY;
  times.forEach((timestamp) => {
    minimumTime = Math.min(minimumTime, timestamp);
    maximumTime = Math.max(maximumTime, timestamp);
  });
  const durationMs = times.length > 1 ? maximumTime - minimumTime : 0;
  return {
    distanceKm,
    durationMs,
    averageKph: durationMs > 0 ? distanceKm / (durationMs / 3600000) : null,
    elevationGainM,
    minElevationM: elevations.length ? Math.min(...elevations) : null,
    maxElevationM: elevations.length ? Math.max(...elevations) : null,
  };
}

export function dataTimeExtent(collections) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let count = 0;
  collections.forEach((points) => points.forEach((point) => {
    const timestamp = timeValue(point.time);
    if (timestamp === null) return;
    min = Math.min(min, timestamp);
    max = Math.max(max, timestamp);
    count += 1;
  }));
  return count ? { min, max } : null;
}

export function formatDuration(milliseconds) {
  if (!milliseconds) return "—";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
