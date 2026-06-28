import { parseAdm } from "./adm-parser.js";
import {
  dataTimeExtent,
  enrichPoints,
  filterPointsByDate,
  formatDuration,
  timeValue,
  trackStats,
} from "./track-utils.js";

const colors = ["#38bdf8", "#f97316", "#34d399", "#a78bfa", "#f472b6", "#facc15", "#60a5fa", "#fb7185"];
const datasets = [];
let nextDatasetId = 1;
let dateFilterTouched = false;
let selectedPointJson = "";
let playback = {
  trackKey: "",
  points: [],
  position: 0,
  playing: false,
  frame: null,
  lastTime: 0,
  renderedIndex: -1,
  marker: null,
  trail: null,
};

const elementIds = [
  "browseButton", "clearAllButton", "closeInspectorButton", "colorModeSelect",
  "copyPointButton", "dateCoverage", "demoButton", "endDateInput", "fileCount", "fileInput",
  "fileList", "fitButton", "followToggle", "playbackSpeedSelect", "playbackTime",
  "playButton", "pointGrid", "pointInspector", "pointJson", "pointTitle",
  "resetDateButton", "routeCount", "startDateInput", "statDistance", "statDuration",
  "statElevation", "statSpeed", "status", "timelineInput", "trackCount", "trackSelect",
  "uploadZone", "waypointCount",
];
const elements = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));

const map = L.map("map", { preferCanvas: true }).setView([39.5, -104.8], 8);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

function safeText(value) {
  return String(value || "").trim();
}

function descendants(node, localName) {
  return [...node.getElementsByTagNameNS("*", localName)];
}

function directChildText(node, localName) {
  const child = [...node.children].find((item) => item.localName?.toLowerCase() === localName.toLowerCase());
  return safeText(child?.textContent);
}

function descendantText(node, names) {
  const wanted = names.map((name) => name.toLowerCase());
  const match = [...node.getElementsByTagName("*")]
    .find((item) => wanted.includes(item.localName?.toLowerCase()));
  return safeText(match?.textContent);
}

function numberOrNull(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function pointFromNode(node, index) {
  const lat = numberOrNull(node.getAttribute("lat"));
  const lon = numberOrNull(node.getAttribute("lon"));
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const speedMetersPerSecond = numberOrNull(
    directChildText(node, "speed") || descendantText(node, ["speed", "velocity"]));
  return {
    lat,
    lon,
    name: directChildText(node, "name"),
    comment: directChildText(node, "cmt") || directChildText(node, "desc"),
    time: directChildText(node, "time") || null,
    elevation: numberOrNull(directChildText(node, "ele")),
    depth: numberOrNull(descendantText(node, ["depth"])),
    temperature: numberOrNull(descendantText(node, ["temperature", "temp"])),
    speedKph: speedMetersPerSecond === null ? null : speedMetersPerSecond * 3.6,
    sourceIndex: index,
  };
}

function parseGpx(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("The GPX file is not valid XML.");
  const root = xml.documentElement;
  if (root.localName?.toLowerCase() !== "gpx") {
    throw new Error("The selected file does not contain a GPX document.");
  }

  const waypoints = descendants(root, "wpt").map(pointFromNode).filter(Boolean);
  const routes = descendants(root, "rte").map((route, index) => ({
    name: directChildText(route, "name") || `Route ${index + 1}`,
    points: enrichPoints(descendants(route, "rtept").map(pointFromNode).filter(Boolean)),
  }));
  const tracks = descendants(root, "trk").flatMap((track, trackIndex) => {
    const name = directChildText(track, "name") || `Track ${trackIndex + 1}`;
    const segments = descendants(track, "trkseg");
    return segments.map((segment, segmentIndex) => ({
      name: segments.length > 1 ? `${name} · Segment ${segmentIndex + 1}` : name,
      points: enrichPoints(descendants(segment, "trkpt").map(pointFromNode).filter(Boolean)),
    }));
  });
  return { waypoints, routes, tracks };
}

function prepareData(data) {
  return {
    waypoints: data.waypoints.map((point, index) => ({ ...point, sourceIndex: point.sourceIndex ?? index })),
    routes: data.routes.map((route) => ({ ...route, points: enrichPoints(route.points) })),
    tracks: data.tracks.map((track) => ({ ...track, points: enrichPoints(track.points) })),
  };
}

function currentDateRange() {
  return {
    start: elements.startDateInput.value ? Date.parse(elements.startDateInput.value) : null,
    end: elements.endDateInput.value ? Date.parse(elements.endDateInput.value) : null,
  };
}

function filteredPoints(points) {
  const { start, end } = currentDateRange();
  return filterPointsByDate(points, start, end);
}

function allPointCollections() {
  return datasets.flatMap((dataset) => [
    dataset.data.waypoints,
    ...dataset.data.routes.map((route) => route.points),
    ...dataset.data.tracks.map((track) => track.points),
  ]);
}

function toLocalDateTime(timestamp) {
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

function formatDateTime(value) {
  const timestamp = timeValue(value);
  return timestamp === null
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(timestamp);
}

function updateDateControls(resetValues = false) {
  const extent = dataTimeExtent(allPointCollections());
  const enabled = Boolean(extent);
  [elements.startDateInput, elements.endDateInput, elements.resetDateButton]
    .forEach((element) => { element.disabled = !enabled; });
  if (!extent) {
    elements.startDateInput.value = "";
    elements.endDateInput.value = "";
    elements.dateCoverage.textContent = "No timestamps found. Playback still works by point order.";
    return;
  }
  const min = toLocalDateTime(extent.min);
  const max = toLocalDateTime(extent.max);
  elements.startDateInput.min = min;
  elements.startDateInput.max = max;
  elements.endDateInput.min = min;
  elements.endDateInput.max = max;
  if (resetValues || !dateFilterTouched) {
    elements.startDateInput.value = min;
    elements.endDateInput.value = max;
  }
  let count = 0;
  allPointCollections().forEach((points) => points.forEach((point) => {
    if (timeValue(point.time) !== null) count += 1;
  }));
  elements.dateCoverage.textContent = `${count.toLocaleString()} timestamped points · ${formatDateTime(extent.min)} to ${formatDateTime(extent.max)}`;
}

function pointDetails(point) {
  return [
    ["Coordinates", `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`],
    ["Timestamp", formatDateTime(point.time)],
    ["Source index", Number.isFinite(point.sourceIndex) ? `#${point.sourceIndex + 1}` : "—"],
    ["Distance", Number.isFinite(point.distanceKm) ? `${point.distanceKm.toFixed(2)} km` : "—"],
    ["Speed", Number.isFinite(point.speedKph) ? `${point.speedKph.toFixed(1)} km/h` : "—"],
    ["Elevation", Number.isFinite(point.elevation) ? `${point.elevation.toFixed(1)} m` : "—"],
    ["Depth", Number.isFinite(point.depth) ? `${point.depth.toFixed(1)} m` : "—"],
    ["Temperature", Number.isFinite(point.temperature) ? `${point.temperature.toFixed(1)} °C` : "—"],
  ];
}

function showPointInspector(point, context) {
  selectedPointJson = JSON.stringify({
    dataset: context.dataset,
    type: context.type,
    trackOrRoute: context.name,
    ...point,
  }, null, 2);
  elements.pointTitle.textContent = point.name || `${context.type} point ${point.sourceIndex + 1}`;
  elements.pointGrid.replaceChildren();
  pointDetails(point).forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("span");
    const detail = document.createElement("strong");
    term.textContent = label;
    detail.textContent = value;
    item.append(term, detail);
    elements.pointGrid.append(item);
  });
  elements.pointJson.textContent = selectedPointJson;
  elements.pointInspector.hidden = false;
}

function nearestPoint(points, latlng) {
  const target = map.latLngToLayerPoint(latlng);
  let nearest = points[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point) => {
    const pixel = map.latLngToLayerPoint([point.lat, point.lon]);
    const distance = pixel.distanceTo(target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  });
  return nearest;
}

function bindPointInspection(layer, points, context) {
  layer.on("click", (event) => {
    L.DomEvent.stopPropagation(event);
    showPointInspector(nearestPoint(points, event.latlng), context);
  });
}

function speedColor(speed, maximum) {
  const ratio = Math.max(0, Math.min(1, (speed || 0) / (maximum || 1)));
  return `hsl(${210 - ratio * 205} 88% 57%)`;
}

function timeColor(index, total) {
  const ratio = total > 1 ? index / (total - 1) : 0;
  return `hsl(${265 - ratio * 245} 85% 62%)`;
}

function drawTrack(dataset, track, trackIndex, points) {
  if (points.length < 2) return;
  const context = { dataset: dataset.name, type: "Track", name: track.name };
  const mode = elements.colorModeSelect.value;
  if (mode === "file") {
    const line = L.polyline(points.map((point) => [point.lat, point.lon]), {
      color: dataset.color, weight: 4, opacity: 0.92,
    }).addTo(dataset.layer);
    bindPointInspection(line, points, context);
    return;
  }

  let maximumSpeed = 0;
  points.forEach((point) => { maximumSpeed = Math.max(maximumSpeed, point.speedKph || 0); });
  const stride = Math.max(1, Math.ceil((points.length - 1) / 700));
  for (let index = 0; index < points.length - 1; index += stride) {
    const end = Math.min(points.length - 1, index + stride);
    const color = mode === "speed"
      ? speedColor(points[end].speedKph, maximumSpeed)
      : timeColor(index, points.length);
    L.polyline([[points[index].lat, points[index].lon], [points[end].lat, points[end].lon]], {
      color, weight: 5, opacity: 0.92, interactive: false,
    }).addTo(dataset.layer);
  }
  const hitLine = L.polyline(points.map((point) => [point.lat, point.lon]), {
    color: "#fff", weight: 18, opacity: 0.01,
  }).addTo(dataset.layer);
  bindPointInspection(hitLine, points, context);
}

function renderDataset(dataset) {
  dataset.layer.clearLayers();
  if (!dataset.visible) return;

  filteredPoints(dataset.data.waypoints).forEach((point, index) => {
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: 7, color: "#fff", weight: 2, fillColor: dataset.color, fillOpacity: 1,
    }).addTo(dataset.layer);
    marker.on("click", () => showPointInspector(point, {
      dataset: dataset.name,
      type: "Waypoint",
      name: point.name || `Waypoint ${index + 1}`,
    }));
  });

  dataset.data.routes.forEach((route) => {
    const points = filteredPoints(route.points);
    if (points.length < 2) return;
    const line = L.polyline(points.map((point) => [point.lat, point.lon]), {
      color: dataset.color, weight: 4, opacity: 0.9, dashArray: "9 7",
    }).addTo(dataset.layer);
    bindPointInspection(line, points, { dataset: dataset.name, type: "Route", name: route.name });
  });
  dataset.data.tracks.forEach((track, index) => drawTrack(dataset, track, index, filteredPoints(track.points)));
}

function renderAllDatasets() {
  datasets.forEach(renderDataset);
}

function datasetBounds(dataset) {
  return [
    ...filteredPoints(dataset.data.waypoints),
    ...dataset.data.routes.flatMap((route) => filteredPoints(route.points)),
    ...dataset.data.tracks.flatMap((track) => filteredPoints(track.points)),
  ].map((point) => [point.lat, point.lon]);
}

function fitData(dataset = null) {
  const source = dataset ? [dataset] : datasets.filter((item) => item.visible);
  const points = source.flatMap(datasetBounds);
  if (points.length) map.fitBounds(points, { paddingTopLeft: [35, 35], paddingBottomRight: [35, 185], maxZoom: 16 });
}

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function availableTracks() {
  return datasets.filter((dataset) => dataset.visible).flatMap((dataset) =>
    dataset.data.tracks.map((track, index) => ({
      key: `${dataset.id}:${index}`,
      dataset,
      track,
      points: filteredPoints(track.points),
    })));
}

function selectedTrack() {
  return availableTracks().find((entry) => entry.key === playback.trackKey) || null;
}

function clearPlaybackLayers() {
  if (playback.marker) map.removeLayer(playback.marker);
  if (playback.trail) map.removeLayer(playback.trail);
  playback.marker = null;
  playback.trail = null;
  playback.renderedIndex = -1;
}

function setPlayButtonIcon() {
  elements.playButton.replaceChildren(icon(playback.playing ? "pause" : "play"));
  elements.playButton.ariaLabel = playback.playing ? "Pause track" : "Play track";
  lucide.createIcons({ attrs: { width: 19, height: 19, "stroke-width": 2.4 } });
}

function pausePlayback() {
  playback.playing = false;
  playback.lastTime = 0;
  if (playback.frame) cancelAnimationFrame(playback.frame);
  playback.frame = null;
  setPlayButtonIcon();
}

function updatePlaybackPosition(index, follow = false) {
  if (!playback.points.length) return;
  const safeIndex = Math.max(0, Math.min(playback.points.length - 1, Math.round(index)));
  playback.position = safeIndex;
  elements.timelineInput.value = String(safeIndex);
  const point = playback.points[safeIndex];
  elements.playbackTime.textContent = point.time
    ? formatDateTime(point.time)
    : `Point ${safeIndex + 1} of ${playback.points.length}`;

  if (playback.renderedIndex === safeIndex) return;
  playback.renderedIndex = safeIndex;
  if (!playback.marker) {
    playback.marker = L.circleMarker([point.lat, point.lon], {
      radius: 9, color: "#fff", weight: 3, fillColor: "#0ea5e9", fillOpacity: 1,
    }).addTo(map);
  } else {
    playback.marker.setLatLng([point.lat, point.lon]);
  }
  const trailPoints = playback.points.slice(0, safeIndex + 1).map((item) => [item.lat, item.lon]);
  if (!playback.trail) {
    playback.trail = L.polyline(trailPoints, { color: "#fff", weight: 3, opacity: 0.75 }).addTo(map);
  } else {
    playback.trail.setLatLngs(trailPoints);
  }
  playback.marker.bringToFront();
  if (follow && elements.followToggle.checked) map.panTo([point.lat, point.lon], { animate: true, duration: 0.25 });
}

function playbackFrame(timestamp) {
  if (!playback.playing) return;
  if (!playback.lastTime) playback.lastTime = timestamp;
  const elapsed = Math.min(500, timestamp - playback.lastTime);
  playback.lastTime = timestamp;
  const speed = Number.parseFloat(elements.playbackSpeedSelect.value) || 1;
  const basePointsPerSecond = Math.max(1, playback.points.length / 60);
  playback.position += elapsed / 1000 * basePointsPerSecond * speed;
  if (playback.position >= playback.points.length - 1) {
    updatePlaybackPosition(playback.points.length - 1, true);
    pausePlayback();
    return;
  }
  updatePlaybackPosition(playback.position, true);
  playback.frame = requestAnimationFrame(playbackFrame);
}

function startPlayback() {
  if (playback.points.length < 2) return;
  if (playback.position >= playback.points.length - 1) updatePlaybackPosition(0);
  playback.playing = true;
  playback.lastTime = 0;
  setPlayButtonIcon();
  playback.frame = requestAnimationFrame(playbackFrame);
}

function setSelectedTrack(key, fit = false) {
  pausePlayback();
  clearPlaybackLayers();
  playback.trackKey = key;
  const entry = selectedTrack();
  playback.points = entry?.points || [];
  playback.position = 0;
  const enabled = playback.points.length > 1;
  [elements.playButton, elements.timelineInput, elements.playbackSpeedSelect, elements.followToggle]
    .forEach((element) => { element.disabled = !enabled; });
  elements.timelineInput.max = String(Math.max(1, playback.points.length - 1));
  elements.timelineInput.value = "0";

  const stats = trackStats(playback.points);
  elements.statDistance.textContent = playback.points.length ? `${stats.distanceKm.toFixed(1)} km` : "—";
  elements.statDuration.textContent = formatDuration(stats.durationMs);
  elements.statSpeed.textContent = stats.averageKph === null ? "—" : `${stats.averageKph.toFixed(1)} km/h`;
  elements.statElevation.textContent = stats.elevationGainM ? `${Math.round(stats.elevationGainM)} m` : "—";
  elements.playbackTime.textContent = enabled ? "Ready to play" : "No timeline";
  if (enabled) {
    updatePlaybackPosition(0);
    if (fit) map.fitBounds(playback.points.map((point) => [point.lat, point.lon]), { padding: [50, 150], maxZoom: 16 });
  }
}

function updateTrackPicker(preferredKey = playback.trackKey) {
  const tracks = availableTracks();
  elements.trackSelect.replaceChildren();
  if (!tracks.length) {
    const option = document.createElement("option");
    option.textContent = "Load a track to begin";
    option.value = "";
    elements.trackSelect.append(option);
    elements.trackSelect.disabled = true;
    elements.colorModeSelect.disabled = true;
    setSelectedTrack("");
    return;
  }
  tracks.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.key;
    option.textContent = `${entry.track.name} · ${entry.dataset.name} (${entry.points.length.toLocaleString()} pts)`;
    elements.trackSelect.append(option);
  });
  elements.trackSelect.disabled = false;
  elements.colorModeSelect.disabled = false;
  const nextKey = tracks.some((entry) => entry.key === preferredKey) ? preferredKey : tracks[0].key;
  elements.trackSelect.value = nextKey;
  setSelectedTrack(nextKey);
}

function updateSummary() {
  const totals = datasets.reduce((sum, dataset) => ({
    waypoints: sum.waypoints + dataset.data.waypoints.length,
    routes: sum.routes + dataset.data.routes.length,
    tracks: sum.tracks + dataset.data.tracks.length,
  }), { waypoints: 0, routes: 0, tracks: 0 });
  elements.waypointCount.textContent = totals.waypoints.toLocaleString();
  elements.routeCount.textContent = totals.routes.toLocaleString();
  elements.trackCount.textContent = totals.tracks.toLocaleString();
  elements.fileCount.textContent = datasets.length.toLocaleString();
  elements.fitButton.disabled = !datasets.some((dataset) => datasetBounds(dataset).length);
  elements.clearAllButton.disabled = datasets.length === 0;
}

function icon(name) {
  const element = document.createElement("i");
  element.dataset.lucide = name;
  element.ariaHidden = "true";
  return element;
}

function controlButton(name, label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${className}`.trim();
  button.title = label;
  button.ariaLabel = label;
  button.append(icon(name));
  return button;
}

function renderFileList() {
  elements.fileList.replaceChildren();
  if (!datasets.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Add an ADM or GPX file to begin.";
    elements.fileList.append(empty);
  }

  datasets.forEach((dataset) => {
    const card = document.createElement("article");
    card.className = "file-card";
    const title = document.createElement("div");
    title.className = "file-title";
    const swatch = document.createElement("span");
    swatch.className = "file-color";
    swatch.style.background = dataset.color;
    const name = document.createElement("strong");
    name.textContent = dataset.name;
    name.title = dataset.name;
    title.append(swatch, name);
    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.textContent = [
      `${dataset.data.waypoints.length} waypoint${dataset.data.waypoints.length === 1 ? "" : "s"}`,
      `${dataset.data.routes.length} route${dataset.data.routes.length === 1 ? "" : "s"}`,
      `${dataset.data.tracks.length} track${dataset.data.tracks.length === 1 ? "" : "s"}`,
    ].join(" · ");
    const controls = document.createElement("div");
    controls.className = "file-controls";
    const visibility = controlButton(dataset.visible ? "eye" : "eye-off", dataset.visible ? "Hide file" : "Show file", dataset.visible ? "active" : "");
    visibility.addEventListener("click", () => {
      dataset.visible = !dataset.visible;
      renderDataset(dataset);
      renderFileList();
      updateTrackPicker();
      updateSummary();
    });
    const fit = controlButton("focus", "Fit this file");
    fit.addEventListener("click", () => fitData(dataset));
    controls.append(visibility, fit);
    if (dataset.data.tracks.length) {
      const play = controlButton("circle-play", "Play first track");
      play.addEventListener("click", () => {
        const key = `${dataset.id}:0`;
        elements.trackSelect.value = key;
        setSelectedTrack(key, true);
      });
      controls.append(play);
    }
    const remove = controlButton("x", "Remove file", "remove");
    remove.addEventListener("click", () => {
      map.removeLayer(dataset.layer);
      datasets.splice(datasets.indexOf(dataset), 1);
      updateDateControls();
      renderFileList();
      updateTrackPicker();
      updateSummary();
      setStatus(`Removed ${dataset.name}.`);
    });
    controls.append(remove);
    card.append(title, meta, controls);
    elements.fileList.append(card);
  });
  lucide.createIcons({ attrs: { width: 16, height: 16, "stroke-width": 2 } });
}

async function loadFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["adm", "gpx"].includes(extension)) throw new Error(`${file.name}: choose a .adm or .gpx file.`);
  const parsed = extension === "adm" ? parseAdm(await file.arrayBuffer()) : parseGpx(await file.text());
  const data = prepareData(parsed);
  const pointCount = data.waypoints.length +
    data.routes.reduce((sum, route) => sum + route.points.length, 0) +
    data.tracks.reduce((sum, track) => sum + track.points.length, 0);
  if (!pointCount) throw new Error(`${file.name}: no mappable GPS points were found.`);
  return addDataset(file.name, data);
}

function addDataset(name, data) {
  const dataset = {
    id: nextDatasetId++,
    name,
    color: colors[datasets.length % colors.length],
    data,
    visible: true,
    layer: L.layerGroup().addTo(map),
  };
  datasets.push(dataset);
  return dataset;
}

function loadDemo() {
  const startedAt = Date.parse("2026-06-21T13:00:00Z");
  const points = enrichPoints(Array.from({ length: 96 }, (_, index) => {
    const progress = index / 95;
    const angle = progress * Math.PI * 2;
    return {
      lat: 39.7392 + Math.sin(angle) * 0.075 + Math.sin(angle * 3) * 0.008,
      lon: -104.9903 + Math.cos(angle) * 0.11,
      elevation: 1600 + Math.sin(angle * 2) * 145 + progress * 45,
      time: new Date(startedAt + index * 90000).toISOString(),
      temperature: 18 + Math.sin(angle) * 4,
      sourceIndex: index,
    };
  }));
  const data = {
    waypoints: [
      { ...points[0], name: "Start / finish", comment: "Demo trailhead" },
      { ...points[32], name: "Ridgeline", comment: "Highest scenic section" },
      { ...points[64], name: "Creek crossing", comment: "Low point" },
    ],
    routes: [],
    tracks: [{ name: "Front Range explorer", points }],
  };
  addDataset("Colorado demo.gpx", data);
  updateDateControls();
  renderAllDatasets();
  renderFileList();
  updateTrackPicker();
  updateSummary();
  fitData();
  setStatus("Demo loaded. Press play or click the track to inspect a raw point.", "success");
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  elements.browseButton.disabled = true;
  setStatus(`Reading ${files.length} file${files.length === 1 ? "" : "s"}…`);
  const errors = [];
  let loaded = 0;
  for (const file of files) {
    try {
      await loadFile(file);
      loaded += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${file.name}: could not be read.`);
    }
  }
  updateDateControls();
  renderAllDatasets();
  renderFileList();
  updateTrackPicker();
  updateSummary();
  if (loaded) fitData();
  setStatus(
    errors.length ? `${loaded ? `Loaded ${loaded}. ` : ""}${errors.join(" ")}` : `Loaded ${loaded} GPS file${loaded === 1 ? "" : "s"}.`,
    errors.length ? "error" : "success",
  );
  elements.browseButton.disabled = false;
  elements.fileInput.value = "";
}

function applyDateFilter() {
  dateFilterTouched = true;
  pausePlayback();
  clearPlaybackLayers();
  renderAllDatasets();
  updateTrackPicker();
  updateSummary();
  fitData();
}

elements.browseButton.addEventListener("click", () => elements.fileInput.click());
elements.demoButton.addEventListener("click", loadDemo);
elements.fileInput.addEventListener("change", () => handleFiles(elements.fileInput.files));
elements.fitButton.addEventListener("click", () => fitData());
elements.colorModeSelect.addEventListener("change", renderAllDatasets);
[elements.startDateInput, elements.endDateInput].forEach((input) => {
  input.addEventListener("input", applyDateFilter);
  input.addEventListener("change", applyDateFilter);
});
elements.resetDateButton.addEventListener("click", () => {
  dateFilterTouched = false;
  updateDateControls(true);
  applyDateFilter();
  dateFilterTouched = false;
});
elements.trackSelect.addEventListener("change", () => setSelectedTrack(elements.trackSelect.value, true));
elements.playButton.addEventListener("click", () => playback.playing ? pausePlayback() : startPlayback());
elements.timelineInput.addEventListener("input", () => {
  pausePlayback();
  updatePlaybackPosition(Number.parseFloat(elements.timelineInput.value), true);
});
elements.closeInspectorButton.addEventListener("click", () => { elements.pointInspector.hidden = true; });
elements.copyPointButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(selectedPointJson);
  elements.copyPointButton.textContent = "Copied";
  setTimeout(() => { elements.copyPointButton.textContent = "Copy JSON"; }, 1200);
});
elements.clearAllButton.addEventListener("click", () => {
  pausePlayback();
  clearPlaybackLayers();
  datasets.forEach((dataset) => map.removeLayer(dataset.layer));
  datasets.length = 0;
  dateFilterTouched = false;
  elements.pointInspector.hidden = true;
  updateDateControls(true);
  renderFileList();
  updateTrackPicker();
  updateSummary();
  setStatus("All GPS files cleared.");
});
["dragenter", "dragover"].forEach((eventName) => {
  elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.remove("dragging");
  });
});
elements.uploadZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));
window.addEventListener("resize", () => map.invalidateSize());
lucide.createIcons({ attrs: { width: 18, height: 18, "stroke-width": 2 } });
setPlayButtonIcon();
updateDateControls();
updateTrackPicker();
setTimeout(() => map.invalidateSize(), 0);
