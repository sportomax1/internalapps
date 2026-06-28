import { parseAdm } from "./adm-parser.js";

const colors = ["#38bdf8", "#f97316", "#34d399", "#a78bfa", "#f472b6", "#facc15", "#60a5fa", "#fb7185"];
const datasets = [];
const elements = Object.fromEntries([
  "browseButton", "clearAllButton", "fileCount", "fileInput", "fileList", "fitButton",
  "routeCount", "status", "trackCount", "uploadZone", "waypointCount",
].map((id) => [id, document.getElementById(id)]));

const map = L.map("map").setView([39.5, -104.8], 8);
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
  const child = [...node.children].find((item) => item.localName === localName);
  return safeText(child?.textContent);
}

function pointFromNode(node) {
  const lat = Number.parseFloat(node.getAttribute("lat"));
  const lon = Number.parseFloat(node.getAttribute("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    name: directChildText(node, "name"),
    comment: directChildText(node, "cmt") || directChildText(node, "desc"),
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
    points: descendants(route, "rtept").map(pointFromNode).filter(Boolean),
  }));
  const tracks = descendants(root, "trk").flatMap((track, trackIndex) => {
    const name = directChildText(track, "name") || `Track ${trackIndex + 1}`;
    const segments = descendants(track, "trkseg");
    return segments.map((segment, segmentIndex) => ({
      name: segments.length > 1 ? `${name} · Segment ${segmentIndex + 1}` : name,
      points: descendants(segment, "trkpt").map(pointFromNode).filter(Boolean),
    }));
  });
  return { waypoints, routes, tracks };
}

function popupContent(title, detail) {
  const wrapper = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  wrapper.append(strong);
  if (detail) {
    const line = document.createElement("div");
    line.textContent = detail;
    wrapper.append(line);
  }
  return wrapper;
}

function renderDataset(dataset) {
  dataset.layer.clearLayers();
  if (!dataset.visible) return;

  dataset.data.waypoints.forEach((point, index) => {
    L.circleMarker([point.lat, point.lon], {
      radius: 7, color: "#fff", weight: 2, fillColor: dataset.color, fillOpacity: 1,
    }).bindPopup(popupContent(point.name || `Waypoint ${index + 1}`, point.comment))
      .addTo(dataset.layer);
  });
  dataset.data.routes.forEach((route) => {
    if (!route.points.length) return;
    L.polyline(route.points.map((point) => [point.lat, point.lon]), {
      color: dataset.color, weight: 4, opacity: 0.9, dashArray: "9 7",
    }).bindPopup(popupContent(route.name, `${route.points.length.toLocaleString()} route points`))
      .addTo(dataset.layer);
  });
  dataset.data.tracks.forEach((track) => {
    if (!track.points.length) return;
    L.polyline(track.points.map((point) => [point.lat, point.lon]), {
      color: dataset.color, weight: 4, opacity: 0.9,
    }).bindPopup(popupContent(track.name, `${track.points.length.toLocaleString()} track points`))
      .addTo(dataset.layer);
  });
}

function datasetBounds(dataset) {
  return [
    ...dataset.data.waypoints,
    ...dataset.data.routes.flatMap((route) => route.points),
    ...dataset.data.tracks.flatMap((track) => track.points),
  ].map((point) => [point.lat, point.lon]);
}

function fitData(dataset = null) {
  const source = dataset ? [dataset] : datasets.filter((item) => item.visible);
  const points = source.flatMap(datasetBounds);
  if (points.length) map.fitBounds(points, { padding: [35, 35], maxZoom: 16 });
}

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
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
      updateSummary();
    });
    const fit = controlButton("focus", "Fit this file");
    fit.addEventListener("click", () => fitData(dataset));
    const remove = controlButton("x", "Remove file", "remove");
    remove.addEventListener("click", () => {
      map.removeLayer(dataset.layer);
      datasets.splice(datasets.indexOf(dataset), 1);
      renderFileList();
      updateSummary();
      setStatus(`Removed ${dataset.name}.`);
    });
    controls.append(visibility, fit, remove);
    card.append(title, meta, controls);
    elements.fileList.append(card);
  });
  lucide.createIcons({ attrs: { width: 16, height: 16, "stroke-width": 2 } });
}

async function loadFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["adm", "gpx"].includes(extension)) throw new Error(`${file.name}: choose a .adm or .gpx file.`);
  const data = extension === "adm" ? parseAdm(await file.arrayBuffer()) : parseGpx(await file.text());
  const pointCount = data.waypoints.length +
    data.routes.reduce((sum, route) => sum + route.points.length, 0) +
    data.tracks.reduce((sum, track) => sum + track.points.length, 0);
  if (!pointCount) throw new Error(`${file.name}: no mappable GPS points were found.`);
  const dataset = {
    name: file.name,
    color: colors[datasets.length % colors.length],
    data,
    visible: true,
    layer: L.layerGroup().addTo(map),
  };
  datasets.push(dataset);
  renderDataset(dataset);
  return dataset;
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
  renderFileList();
  updateSummary();
  if (loaded) fitData();
  setStatus(
    errors.length ? `${loaded ? `Loaded ${loaded}. ` : ""}${errors.join(" ")}` : `Loaded ${loaded} GPS file${loaded === 1 ? "" : "s"}.`,
    errors.length ? "error" : "success",
  );
  elements.browseButton.disabled = false;
  elements.fileInput.value = "";
}

elements.browseButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => handleFiles(elements.fileInput.files));
elements.fitButton.addEventListener("click", () => fitData());
elements.clearAllButton.addEventListener("click", () => {
  datasets.forEach((dataset) => map.removeLayer(dataset.layer));
  datasets.length = 0;
  renderFileList();
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
setTimeout(() => map.invalidateSize(), 0);
