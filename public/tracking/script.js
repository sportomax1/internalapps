const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSlVJNYUaEcY1as9YcKPu18BaceP9vQvg1vxg3KD_Z1WOsv9lL5OOnHIqJ_sY5yJOKLPcgEsSopQTc8/pub?output=csv";

// ---- Map ----
const map = L.map("map").setView([38.25115, -104.5884], 15);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

let markers = L.featureGroup().addTo(map);
let heatLayer = null;
let heatOn = false;
let data = [];
let lastFiltered = [];
let daysOffset = 0; // for last24 navigation (0 = ending now)
let pathLine = null;
let pathDeco = null;
// Play mode state
let playTimer = null;
let playIndex = 0;
let isPlaying = false;
let playPolyline = null;

// ---- Inputs ----
const rangeSelect = document.getElementById("rangeSelect");
const startInput = document.getElementById("startDate");
const endInput = document.getElementById("endDate");
const modeSelect = document.getElementById("modeSelect");
const nav24 = document.getElementById("nav24");
const playControls = document.getElementById('playControls');
const playToggle = document.getElementById('playToggle');
const stepPlayBtn = document.getElementById('stepPlay');
const playSpeed = document.getElementById('playSpeed');
const prevDay = document.getElementById("prevDay");
const nextDay = document.getElementById("nextDay");
const todayBtn = document.getElementById("todayBtn");
const detailsBtn = document.getElementById("detailsBtn");
const detailsModal = document.getElementById("detailsModal");
const detailsList = document.getElementById("detailsList");
const closeModal = document.getElementById("closeModal");
const loginModal = document.getElementById("loginModal");
const sitePassword = document.getElementById("sitePassword");
const loginSubmit = document.getElementById("loginSubmit");
const loginCancel = document.getElementById("loginCancel");
const loginError = document.getElementById("loginError");

function formatDate(d) {
  // Use local timezone instead of UTC to avoid date shifting
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(v) {
  // parse YYYY-MM-DD from input[type=date] into a local Date at midnight
  if (!v) return new Date();
  const parts = v.split('-').map(s => Number(s));
  if (parts.length < 3 || parts.some(isNaN)) return new Date(v);
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function parseTimestamp(ts) {
  if (!ts) return new Date();
  // If string contains timezone indicator (Z or +hh:mm/-hh:mm) let Date handle it
  if (/[zZ]|[+-]\d{2}:?\d{2}/.test(ts)) return new Date(ts);

  // Normalize common separators and extract numbers: YYYY MM DD hh mm ss
  // Handle common US style with slashes: M/D/YYYY HH:MM:SS
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(ts)) {
    // split date and time
    const [datePart, timePart] = ts.split(' ');
    const [m, d, y] = datePart.split('/').map(s => Number(s));
    const t = (timePart || '').split(':').map(s => Number(s));
    const hour = t[0] || 0;
    const minute = t[1] || 0;
    const second = t[2] || 0;
    return new Date(y, (m || 1) - 1, d || 1, hour, minute, second);
  }

  // Normalize common separators and extract numbers: YYYY MM DD hh mm ss
  const cleaned = ts.replace('T', ' ').replace(/-/g, ' ').replace(/:/g, ' ');
  const parts = cleaned.split(/\s+/).map(p => Number(p)).filter(n => !isNaN(n));
  const year = parts[0] || 1970;
  const month = (parts[1] || 1) - 1;
  const day = parts[2] || 1;
  const hour = parts[3] || 0;
  const minute = parts[4] || 0;
  const second = parts[5] || 0;
  // Construct date in local timezone to preserve calendar day as intended
  return new Date(year, month, day, hour, minute, second);
}

// Default = last 7 days
function setDefaultRange() {
  rangeSelect.value = "last7";
  applyRange();
}

// ---- Load CSV ----
async function loadData() {
  const res = await fetch(CSV_URL, { cache: "no-store" });
  const text = await res.text();
  // Robust CSV parsing to handle quoted fields with commas/newlines
  function parseCSV(txt) {
    const rows = [];
    let cur = '';
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      const next = txt[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') {
          // escaped quote
          cur += '"';
          i++; // skip next
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === ',' && !inQuotes) {
        row.push(cur);
        cur = '';
        continue;
      }
      if ((ch === '\n' || ch === '\r') && !inQuotes) {
        // handle CRLF by checking next char
        if (ch === '\r' && txt[i + 1] === '\n') {
          i++;
        }
        row.push(cur);
        cur = '';
        // ignore empty trailing row from final newline
        // only push non-empty row (or if any field exists)
        if (row.length === 1 && row[0] === '') {
          row = [];
          continue;
        }
        rows.push(row);
        row = [];
        continue;
      }
      cur += ch;
    }
    // push last field
    if (cur !== '' || inQuotes || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  const parsed = parseCSV(text);
  // remove header if present
  if (parsed.length && parsed[0] && /timestamp/i.test((parsed[0][0]||''))) parsed.shift();

  data = parsed.map(cols => {
    // Normalize columns by trimming
    const c = cols.map(x => (x || '').trim());
    const timestamp = c[0] || '';
    const lat = c[1] || '';
    const lng = c[2] || '';
    // The CSV may include commas inside the street field; assume final columns are city,state,zip,count
    const tail = c.slice(-4);
    const count = tail[3] || '';
    const zip = tail[2] || '';
    const state = tail[1] || '';
    const city = tail[0] || '';
    const streetParts = c.slice(3, c.length - 4);
    const street = streetParts.join(', ').trim();

    return {
      date: parseTimestamp(timestamp),
      lat: Number(lat),
      lng: Number(lng),
      street,
      city,
      state,
      zip,
      count: Number(count) || 1
    };
  }).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lng) && d.date instanceof Date && !isNaN(d.date));

  // If user has chosen 'all' we might want earliest date; keep defaults otherwise
  applyRange();
  render();
}

// ---- Auth ----
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
    loginError.textContent = j && j.error ? j.error : 'Incorrect password';
    loginError.style.display = 'block';
    return false;
  } catch (err) {
    loginError.textContent = 'Network error';
    loginError.style.display = 'block';
    return false;
  }
}

loginSubmit.onclick = () => {
  const pw = sitePassword.value || '';
  attemptLogin(pw);
};

loginCancel.onclick = () => {
  // simple behavior: keep modal open but clear; user can close tab
  sitePassword.value = '';
};

function checkAuth() {
  return sessionStorage.getItem('mymaps_auth') === '1';
}

function startAppAfterAuth() {
  // start auto-refresh and initial load only after auth
  loadData();
  // refresh every 60s
  if (!window._mymaps_interval) window._mymaps_interval = setInterval(loadData, 60000);
}

// ---- Color logic ----
function pinColor(count) {
  if (count >= 5) return "red";
  if (count >= 3) return "orange";
  return "green";
}

// ---- Render ----
function render() {
  markers.clearLayers();
  if (heatLayer) map.removeLayer(heatLayer);
  if (pathLine) { map.removeLayer(pathLine); pathLine = null; }
  if (playPolyline) { map.removeLayer(playPolyline); playPolyline = null; }
  const start = parseDateInput(startInput.value);
  const end = parseDateInput(endInput.value);
  end.setHours(23, 59, 59, 999);
  const filtered = data.filter(d => d.date >= start && d.date <= end);
  // If in path mode, order the filtered results by timestamp for drawing and listing
  if (modeSelect && modeSelect.value === 'path') {
    lastFiltered = filtered.slice().sort((a, b) => a.date - b.date);
  } else if (modeSelect && modeSelect.value === 'play') {
    lastFiltered = filtered.slice().sort((a, b) => a.date - b.date);
  } else {
    lastFiltered = filtered;
  }
  const heatPoints = [];

  // Play mode renders incrementally; draw only up to playIndex
  if (modeSelect && modeSelect.value === 'play') {
    // ensure playIndex is within bounds
    if (!playIndex || playIndex < 0) playIndex = 0;
    if (playIndex > lastFiltered.length) playIndex = lastFiltered.length;
    const shown = lastFiltered.slice(0, playIndex);

    shown.forEach(d => {
      const popup = `
      <strong>${d.street}</strong><br>
      ${d.city}, ${d.state} ${d.zip}<br>
      Count: ${d.count}<br>
      ${d.date.toLocaleString()}
    `;

      L.circleMarker([d.lat, d.lng], {
        radius: 8,
        color: pinColor(d.count),
        fillOpacity: 0.8
      })
        .bindPopup(popup)
        .addTo(markers);

      d._popup = popup;
      heatPoints.push([d.lat, d.lng, d.count]);
    });

    if (shown.length > 1) {
      const latlngs = shown.map(d => [d.lat, d.lng]);
      playPolyline = L.polyline(latlngs, {
        color: '#007aff',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round'
      }).addTo(map);
    }

    if (playPolyline) map.fitBounds(playPolyline.getBounds(), { padding: [30, 30] });
    else if (markers.getLayers().length) map.fitBounds(markers.getBounds(), { padding: [30, 30] });

    if (heatOn) {
      heatLayer = L.heatLayer(heatPoints, {
        radius: 25,
        blur: 18
      }).addTo(map);
    }

    return;
  }

  // iterate over lastFiltered so markers and popups match ordering when in path mode
  lastFiltered.forEach(d => {
    const popup = `
      <strong>${d.street}</strong><br>
      ${d.city}, ${d.state} ${d.zip}<br>
      Count: ${d.count}<br>
      ${d.date.toLocaleString()}
    `;

    L.circleMarker([d.lat, d.lng], {
      radius: 8,
      color: pinColor(d.count),
      fillOpacity: 0.8
    })
      .bindPopup(popup)
      .addTo(markers);

    // store popup content on data for modal interaction
    d._popup = popup;

    heatPoints.push([d.lat, d.lng, d.count]);
  });

  // If path mode is enabled, draw a polyline through points in chronological order
  if (modeSelect && modeSelect.value === 'path' && lastFiltered.length > 1) {
    const latlngs = lastFiltered.map(d => [d.lat, d.lng]);
    pathLine = L.polyline(latlngs, {
      color: '#007aff',
      weight: 4,
      opacity: 0.9,
      lineJoin: 'round'
    }).addTo(map);
    // Add directional arrows along the line if polyline-decorator is available
    if (window.L && window.L.polylineDecorator) {
      pathDeco = L.polylineDecorator(pathLine, {
        patterns: [
          {
            offset: '5%',
            repeat: '12%',
            symbol: L.Symbol.arrowHead({
              pixelSize: 8,
              polygon: false,
              pathOptions: { stroke: true, color: '#007aff', weight: 2 }
            })
          }
        ]
      }).addTo(map);
    }
    // add small arrowheads or styling could be added later
  }

  // Ensure map fits to the drawn elements: prefer path bounds when present
  if (pathLine) {
    map.fitBounds(pathLine.getBounds(), { padding: [30, 30] });
  } else if (markers.getLayers().length) {
    map.fitBounds(markers.getBounds(), { padding: [30, 30] });
  }

  if (heatOn) {
    heatLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 18
    }).addTo(map);
  }

  if (filtered.length) {
    map.fitBounds(markers.getBounds(), { padding: [30, 30] });
  }
}

// ---- Buttons ----
function applyRange() {
  const now = new Date();
  if (rangeSelect.value === "last24") {
    // Daily mode: show nav and set start and end to the same calendar date
    nav24.style.display = "flex";
    const target = new Date(now.getTime() - daysOffset * 24 * 60 * 60 * 1000);
    // Use the calendar date of `target` for both start and end so the UI shows a single day
    startInput.value = formatDate(target);
    endInput.value = formatDate(target);
  } else {
    nav24.style.display = "none";
    daysOffset = 0;
    if (rangeSelect.value === "last7") {
      const start = new Date();
      start.setDate(now.getDate() - 7);
      startInput.value = formatDate(start);
      endInput.value = formatDate(now);
    } else if (rangeSelect.value === "last30") {
      const start = new Date();
      start.setDate(now.getDate() - 30);
      startInput.value = formatDate(start);
      endInput.value = formatDate(now);
    } else if (rangeSelect.value === "last365") {
      const start = new Date();
      start.setFullYear(now.getFullYear() - 1);
      startInput.value = formatDate(start);
      endInput.value = formatDate(now);
    } else if (rangeSelect.value === "all") {
      // set start to far past so it includes everything
      startInput.value = "1970-01-01";
      endInput.value = formatDate(now);
    } else if (rangeSelect.value === "custom") {
      // keep whatever user sets
    }
  }
}

document.getElementById("applyBtn").onclick = () => {
  // if custom selected, don't overwrite inputs
  if (rangeSelect.value !== "custom") applyRange();
  // stop any running play session when applying new range
  stopPlay();
  playIndex = 0;
  render();
};

rangeSelect.onchange = () => {
  daysOffset = 0;
  applyRange();
  // reset play state when range changes
  stopPlay();
  playIndex = 0;
  render();
};

prevDay.onclick = () => {
  daysOffset += 1;
  applyRange();
  render();
};

nextDay.onclick = () => {
  if (daysOffset > 0) daysOffset -= 1;
  applyRange();
  stopPlay();
  playIndex = 0;
  render();
};

todayBtn.onclick = () => {
  daysOffset = 0;
  applyRange();
  stopPlay();
  playIndex = 0;
  render();
};

// Mode change: toggle play controls visibility
modeSelect.onchange = () => {
  if (modeSelect.value === 'play') {
    playControls.style.display = 'flex';
    nav24.style.display = 'none';
    // reset play state ready for new playback
    stopPlay();
    playIndex = 0;
  } else {
    playControls.style.display = 'none';
  }
};

function stopPlay() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  isPlaying = false;
  if (playToggle) playToggle.textContent = 'Play';
}

function startPlay() {
  if (!lastFiltered || !lastFiltered.length) return;
  isPlaying = true;
  if (playToggle) playToggle.textContent = 'Pause';
  // ensure playIndex starts at 0 to show progression
  if (!playIndex) playIndex = 0;
  const interval = Number(playSpeed.value) || 800;
  // step immediately to show first point then continue
  stepPlay();
  playTimer = setInterval(() => {
    stepPlay();
  }, interval);
}

function stepPlay() {
  if (!lastFiltered) return;
  if (playIndex >= lastFiltered.length) {
    stopPlay();
    return;
  }
  playIndex += 1;
  render();
}

playToggle.onclick = () => {
  if (isPlaying) stopPlay();
  else startPlay();
};

stepPlayBtn.onclick = () => {
  // single step forward
  stopPlay();
  stepPlay();
};

// update interval when speed changes while playing
playSpeed.oninput = () => {
  if (isPlaying) {
    stopPlay();
    startPlay();
  }
};

detailsBtn.onclick = () => {
  // populate modal with lastFiltered
  detailsList.innerHTML = "";
  if (!lastFiltered || !lastFiltered.length) {
    detailsList.innerHTML = "<div style='text-align:center;color:var(--text-secondary);padding:20px 0'>No addresses in range.</div>";
  } else {
    lastFiltered.forEach((d, i) => {
      const el = document.createElement("div");
      el.className = "detail-item";
      el.innerHTML = `
        <strong>${d.street}</strong><br>
        <span style="color:var(--text-secondary)">${d.city}, ${d.state} ${d.zip}</span><br>
        <span style="font-size:14px;color:var(--text-secondary)">Count: <strong style="color:var(--primary)">${d.count}</strong></span><br>
        <button data-i="${i}" class="focusBtn">📍 Show on Map</button>
      `;
      detailsList.appendChild(el);
    });

    detailsList.querySelectorAll(".focusBtn").forEach(btn => {
      btn.onclick = (e) => {
        // Use currentTarget (the button) or find closest .focusBtn from the event target
        const btnEl = e.currentTarget || (e.target && e.target.closest && e.target.closest('.focusBtn'));
        if (!btnEl) return;
        const idx = Number(btnEl.dataset && btnEl.dataset.i);
        if (Number.isNaN(idx) || !lastFiltered || !lastFiltered[idx]) return;
        const d = lastFiltered[idx];
        map.setView([d.lat, d.lng], 17);
        // find marker and open popup
        markers.eachLayer(l => {
          const latlng = l.getLatLng();
          if (Math.abs(latlng.lat - d.lat) < 0.00001 && Math.abs(latlng.lng - d.lng) < 0.00001) {
            l.openPopup();
          }
        });
        detailsModal.style.display = "none";
      };
    });
  }
  detailsModal.style.display = "flex";
};

closeModal.onclick = () => {
  detailsModal.style.display = "none";
};

// Close modals when clicking backdrop
detailsModal.onclick = (e) => {
  if (e.target === detailsModal || e.target.classList.contains('modal-backdrop')) {
    detailsModal.style.display = 'none';
  }
};

loginModal.onclick = (e) => {
  if (e.target === loginModal || e.target.classList.contains('modal-backdrop')) {
    // Don't allow closing login modal by clicking outside for security
    // loginModal.style.display = 'none';
  }
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    detailsModal.style.display = 'none';
    // Don't allow ESC to close login modal for security
  }
});

document.getElementById("heatBtn").onclick = () => {
  heatOn = !heatOn;
  render();
};

// ---- Auth + initial boot ----
if (checkAuth()) {
  startAppAfterAuth();
} else {
  showLogin();
}
