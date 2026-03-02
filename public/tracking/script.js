const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSlVJNYUaEcY1as9YcKPu18BaceP9vQvg1vxg3KD_Z1WOsv9lL5OOnHIqJ_sY5yJOKLPcgEsSopQTc8/pub?output=csv";

// ---- Globals ----
let map, markers;
let heatLayer = null;
let heatOn = false;
let data = [];
let lastFiltered = [];
let daysOffset = 0;
let pathLine = null;
let pathDeco = null;
let playTimer = null;
let playIndex = 0;
let isPlaying = false;
let playPolyline = null;

// DOM Elements
let rangeSelect, startInput, endInput, modeSelect, nav24, playControls, playToggle, stepPlayBtn, playSpeed, prevDay, nextDay, todayBtn, detailsBtn, detailsModal, detailsList, closeModal, loginModal, sitePassword, loginSubmit, loginCancel, loginError;

// ---- Initialization ----
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Elements
  rangeSelect = document.getElementById("rangeSelect");
  startInput = document.getElementById("startDate");
  endInput = document.getElementById("endDate");
  modeSelect = document.getElementById("modeSelect");
  nav24 = document.getElementById("nav24");
  playControls = document.getElementById('playControls');
  playToggle = document.getElementById('playToggle');
  stepPlayBtn = document.getElementById('stepPlay');
  playSpeed = document.getElementById('playSpeed');
  prevDay = document.getElementById("prevDay");
  nextDay = document.getElementById("nextDay");
  todayBtn = document.getElementById("todayBtn");
  detailsBtn = document.getElementById("detailsBtn");
  detailsModal = document.getElementById("detailsModal");
  detailsList = document.getElementById("detailsList");
  closeModal = document.getElementById("closeModal");
  loginModal = document.getElementById("loginModal");
  sitePassword = document.getElementById("sitePassword");
  loginSubmit = document.getElementById("loginSubmit");
  loginCancel = document.getElementById("loginCancel");
  loginError = document.getElementById("loginError");

  // Initialize Map
  map = L.map("map").setView([38.25115, -104.5884], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  markers = L.featureGroup().addTo(map);

  // Fix Leaflet icon paths
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });

  // Event Listeners
  loginSubmit.onclick = () => attemptLogin(sitePassword.value || '');
  loginCancel.onclick = () => { sitePassword.value = ''; };
  
  rangeSelect.onchange = () => {
    daysOffset = 0;
    applyRange();
    stopPlay();
  };

  document.getElementById("applyBtn").onclick = () => {
    if (rangeSelect.value !== "custom") applyRange();
    stopPlay();
    playIndex = 0;
    render();
  };

  prevDay.onclick = () => { daysOffset++; applyRange(); render(); };
  nextDay.onclick = () => { if (daysOffset > 0) daysOffset--; applyRange(); render(); };
  todayBtn.onclick = () => { daysOffset = 0; applyRange(); render(); };
  
  detailsBtn.onclick = showDetails;
  closeModal.onclick = () => { detailsModal.style.display = "none"; };
  
  document.getElementById("heatBtn").onclick = () => {
    heatOn = !heatOn;
    render();
  };

  // Initial Auth Check
  setDefaultRange();
  if (checkAuth()) {
    startAppAfterAuth();
  } else {
    showLogin();
  }
});

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(v) {
  if (!v) return new Date();
  const parts = v.split('-').map(s => Number(s));
  if (parts.length < 3 || parts.some(isNaN)) return new Date(v);
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function parseTimestamp(ts) {
  if (!ts) return new Date();
  if (/[zZ]|[+-]\d{2}:?\d{2}/.test(ts)) return new Date(ts);
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(ts)) {
    const [datePart, timePart] = ts.split(' ');
    const [m, d, y] = datePart.split('/').map(s => Number(s));
    const t = (timePart || '').split(':').map(s => Number(s));
    return new Date(y, (m || 1) - 1, d || 1, t[0] || 0, t[1] || 0, t[2] || 0);
  }
  const cleaned = ts.replace('T', ' ').replace(/-/g, ' ').replace(/:/g, ' ');
  const parts = cleaned.split(/\s+/).map(p => Number(p)).filter(n => !isNaN(n));
  return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1, parts[3] || 0, parts[4] || 0, parts[5] || 0);
}

function setDefaultRange() {
  rangeSelect.value = "last7";
  applyRange();
}

async function loadData() {
  try {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    const text = await res.text();
    const parsed = parseCSV(text);
    if (parsed.length && /timestamp/i.test((parsed[0][0]||''))) parsed.shift();

    data = parsed.map(cols => {
      const c = cols.map(x => (x || '').trim());
      const tail = c.slice(-4);
      return {
        date: parseTimestamp(c[0] || ''),
        lat: Number(c[1] || ''),
        lng: Number(c[2] || ''),
        street: c.slice(3, c.length - 4).join(', ').trim(),
        city: tail[0] || '',
        state: tail[1] || '',
        zip: tail[2] || '',
        count: Number(tail[3]) || 1
      };
    }).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lng) && d.date instanceof Date && !isNaN(d.date));

    applyRange();
    render();
  } catch (e) {
    console.error("Failed to load CSV:", e);
  }
}

function parseCSV(txt) {
  const rows = [];
  let cur = '', row = [], inQuotes = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '"') {
      if (inQuotes && txt[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { row.push(cur); cur = ''; }
    else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && txt[i+1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function showLogin() {
  loginError.style.display = 'none';
  sitePassword.value = '';
  loginModal.style.display = 'flex';
}

function hideLogin() {
  loginModal.style.display = 'none';
}

async function attemptLogin(pw) {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (res.ok) {
      sessionStorage.setItem('mymaps_auth', '1');
      hideLogin();
      startAppAfterAuth();
      return true;
    }
    const j = await res.json().catch(()=>({}));
    loginError.textContent = j?.error || 'Incorrect password';
    loginError.style.display = 'block';
  } catch (err) {
    loginError.textContent = 'Network error';
    loginError.style.display = 'block';
  }
  return false;
}

function checkAuth() { return sessionStorage.getItem('mymaps_auth') === '1'; }

function startAppAfterAuth() {
  loadData();
  if (!window._mymaps_interval) window._mymaps_interval = setInterval(loadData, 60000);
}

function pinColor(count) {
  if (count >= 5) return "red";
  if (count >= 3) return "orange";
  return "green";
}

function render() {
  if (!map) return;
  markers.clearLayers();
  if (heatLayer) map.removeLayer(heatLayer);
  if (pathLine) { map.removeLayer(pathLine); pathLine = null; }
  if (pathDeco) { map.removeLayer(pathDeco); pathDeco = null; }
  
  const start = parseDateInput(startInput.value);
  const end = parseDateInput(endInput.value);
  end.setHours(23, 59, 59, 999);
  
  const filtered = data.filter(d => d.date >= start && d.date <= end);
  lastFiltered = (modeSelect?.value === 'path' || modeSelect?.value === 'play') 
    ? filtered.slice().sort((a, b) => a.date - b.date) 
    : filtered;

  const heatPoints = [];
  lastFiltered.forEach(d => {
    const popup = `<strong>${d.street}</strong><br>${d.city}, ${d.state} ${d.zip}<br>Count: ${d.count}<br>${d.date.toLocaleString()}`;
    L.circleMarker([d.lat, d.lng], { radius: 8, color: pinColor(d.count), fillOpacity: 0.8 })
      .bindPopup(popup).addTo(markers);
    d._popup = popup;
    heatPoints.push([d.lat, d.lng, d.count]);
  });

  if (modeSelect?.value === 'path' && lastFiltered.length > 1) {
    pathLine = L.polyline(lastFiltered.map(d => [d.lat, d.lng]), { color: '#007aff', weight: 4, opacity: 0.9 }).addTo(map);
    if (L.polylineDecorator) {
      pathDeco = L.polylineDecorator(pathLine, {
        patterns: [{ offset: '5%', repeat: '12%', symbol: L.Symbol.arrowHead({ pixelSize: 8, pathOptions: { color: '#007aff' } }) }]
      }).addTo(map);
    }
  }

  if (pathLine) map.fitBounds(pathLine.getBounds(), { padding: [30, 30] });
  else if (markers.getLayers().length) map.fitBounds(markers.getBounds(), { padding: [30, 30] });

  if (heatOn) heatLayer = L.heatLayer(heatPoints, { radius: 25, blur: 18 }).addTo(map);
}

function applyRange() {
  const now = new Date();
  if (rangeSelect.value === "last24") {
    nav24.style.display = "flex";
    const target = new Date(now.getTime() - daysOffset * 24 * 60 * 60 * 1000);
    startInput.value = endInput.value = formatDate(target);
  } else {
    nav24.style.display = "none";
    daysOffset = 0;
    const start = new Date();
    if (rangeSelect.value === "last7") start.setDate(now.getDate() - 7);
    else if (rangeSelect.value === "last30") start.setDate(now.getDate() - 30);
    else if (rangeSelect.value === "last365") start.setFullYear(now.getFullYear() - 1);
    else if (rangeSelect.value === "all") start.setFullYear(1970);
    
    if (rangeSelect.value !== "custom") {
      startInput.value = formatDate(start);
      endInput.value = formatDate(now);
    }
  }
}

function stopPlay() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  isPlaying = false;
  if (playToggle) playToggle.textContent = "Play";
}

function showDetails() {
  detailsList.innerHTML = "";
  lastFiltered.forEach((d, i) => {
    const el = document.createElement("div");
    el.className = "detail-item";
    el.innerHTML = `<strong>${d.street}</strong><br><span>${d.city}, ${d.state} ${d.zip}</span><br>Count: <strong>${d.count}</strong><br><button class="focusBtn" onclick="focusOn(${i})">📍 Show</button>`;
    detailsList.appendChild(el);
  });
  detailsModal.style.display = "flex";
}

window.focusOn = (idx) => {
  const d = lastFiltered[idx];
  map.setView([d.lat, d.lng], 17);
  detailsModal.style.display = "none";
};
