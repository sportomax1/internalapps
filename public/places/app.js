// Places Map — Leaflet + a password-protected Vercel/Supabase API.

const DEFAULT_CENTER = [39.5186, -104.7614];
const DEFAULT_ZOOM = 5;
const PASSWORD_KEY = 'places-app-password';
const CACHE_KEY = 'places-last-known-good-v1';

const els = {
  authCard: document.getElementById('authCard'),
  passwordInput: document.getElementById('passwordInput'),
  unlockBtn: document.getElementById('unlockBtn'),
  lockBtn: document.getElementById('lockBtn'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  useMapBtn: document.getElementById('useMapBtn'),
  loadBtn: document.getElementById('loadBtn'),
  fitBtn: document.getElementById('fitBtn'),
  retryMapBtn: document.getElementById('retryMapBtn'),
  mapStatusChip: document.getElementById('mapStatusChip'),
  results: document.getElementById('results'),
  labelInput: document.getElementById('labelInput'),
  displayInput: document.getElementById('displayInput'),
  latInput: document.getElementById('latInput'),
  lngInput: document.getElementById('lngInput'),
  tagsInput: document.getElementById('tagsInput'),
  saveBtn: document.getElementById('saveBtn'),
  clearBtn: document.getElementById('clearBtn'),
  batchInput: document.getElementById('batchInput'),
  batchFileInput: document.getElementById('batchFileInput'),
  batchPreview: document.getElementById('batchPreview'),
  importBtn: document.getElementById('importBtn'),
  clearBatchBtn: document.getElementById('clearBatchBtn'),
  filterInput: document.getElementById('filterInput'),
  tagFilterSection: document.getElementById('tagFilterSection'),
  tagFilters: document.getElementById('tagFilters'),
  clearTagsBtn: document.getElementById('clearTagsBtn'),
  countBox: document.getElementById('countBox'),
  places: document.getElementById('places'),
  toast: document.getElementById('toast'),
  statusChip: document.getElementById('statusChip'),
};

let appPassword = sessionStorage.getItem(PASSWORD_KEY) || '';
let stagedMarker = null;
let savedLayer = null;
let savedPlaces = [];
let mapClickMode = false;
let editingPlaceId = null;
let parsedBatchPlaces = [];
let selectedTags = new Set();
let hasFramedInitialPlaces = false;
let tileLayer = null;
let tileErrors = 0;
let tileSourceIndex = 0;

const TILE_SOURCES = [
  {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    name: 'CARTO fallback',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
];

const map = L.map('map', {
  zoomControl: true,
  fadeAnimation: false,
  zoomAnimation: false,
  markerZoomAnimation: false,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
savedLayer = L.layerGroup().addTo(map);

function setMapStatus(text, state = 'neutral') {
  els.mapStatusChip.textContent = text;
  els.mapStatusChip.dataset.state = state;
}

function mountTileLayer(index = 0) {
  tileSourceIndex = index;
  tileErrors = 0;
  if (tileLayer) tileLayer.remove();
  const source = TILE_SOURCES[tileSourceIndex];
  tileLayer = L.tileLayer(source.url, {
    maxZoom: 19,
    attribution: source.attribution,
    crossOrigin: true,
    updateWhenIdle: false,
    updateWhenZooming: false,
    keepBuffer: 4,
  });
  tileLayer.on('loading', () => setMapStatus(`Loading ${source.name}…`));
  tileLayer.on('load', () => setMapStatus('Map ready', 'good'));
  tileLayer.on('tileerror', () => {
    tileErrors += 1;
    if (tileErrors >= 3 && tileSourceIndex === 0) {
      setMapStatus('Switching map source…');
      mountTileLayer(1);
      toast('OpenStreetMap was slow, so the fallback map is loading.');
    } else if (tileErrors >= 3) {
      setMapStatus('Map needs retry', 'bad');
    }
  });
  tileLayer.addTo(map);
}

function retryBaseMap() {
  setMapStatus('Retrying map…');
  map.invalidateSize({ animate: false, pan: false });
  mountTileLayer(tileSourceIndex);
}

mountTileLayer();

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

function setStatus(text, state = 'neutral') {
  els.statusChip.textContent = text;
  els.statusChip.dataset.state = state;
}

function setLocked(locked) {
  els.authCard.hidden = !locked;
  els.lockBtn.hidden = locked;
  els.saveBtn.disabled = locked;
  els.loadBtn.disabled = locked;
  els.importBtn.disabled = locked || !parsedBatchPlaces.length;
  if (locked) {
    setStatus('Locked', 'bad');
    els.tagFilterSection.hidden = true;
    els.tagFilters.innerHTML = '';
    els.places.innerHTML = '<div class="empty">Unlock to load your saved places.</div>';
    setTimeout(() => els.passwordInput.focus(), 50);
  }
}

function parseTags(raw) {
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 20);
}

function parseBatchTags(raw) {
  if (Array.isArray(raw)) return parseTags(raw.join(','));
  return [...new Set(
    String(raw || '')
      .split(/[;,]/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 20);
}

function parseDelimitedRow(line, delimiter) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function normalizeBatchPlace(value, rowNumber) {
  const label = String(value.label || value.name || value.title || '').trim();
  const display_name = String(
    value.display_name || value.display || value.address || value.location || ''
  ).trim();
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.lon ?? value.longitude);
  const tags = parseBatchTags(value.tags);
  if (!label) throw new Error(`Row ${rowNumber}: label is required.`);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`Row ${rowNumber}: latitude must be between -90 and 90.`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`Row ${rowNumber}: longitude must be between -180 and 180.`);
  }
  return { label, display_name, lat, lng, tags };
}

function parseBatchText(raw) {
  const text = String(raw || '').trim();
  if (!text) return { places: [], errors: [] };

  try {
    if (text.startsWith('[')) {
      const values = JSON.parse(text);
      if (!Array.isArray(values)) throw new Error('JSON must be an array of places.');
      return {
        places: values.map((value, index) => normalizeBatchPlace(value, index + 1)),
        errors: [],
      };
    }

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const delimiter = lines[0].includes('\t')
      ? '\t'
      : lines[0].includes('|')
        ? '|'
        : ',';
    const rows = lines.map((line) => parseDelimitedRow(line, delimiter));
    const normalizedHeader = rows[0].map((cell) =>
      cell.toLowerCase().trim().replace(/\s+/g, '_')
    );
    const hasHeader =
      normalizedHeader.some((cell) => ['lat', 'latitude'].includes(cell)) &&
      normalizedHeader.some((cell) => ['lng', 'lon', 'longitude'].includes(cell));
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const places = dataRows.map((row, index) => {
      if (hasHeader) {
        const value = Object.fromEntries(normalizedHeader.map((key, cellIndex) => [
          key,
          row[cellIndex] ?? '',
        ]));
        return normalizeBatchPlace(value, index + 2);
      }
      return normalizeBatchPlace({
        label: row[0],
        display_name: row[1],
        lat: row[2],
        lng: row[3],
        tags: row.slice(4).join(delimiter === ',' ? ',' : ';'),
      }, index + 1);
    });
    return { places, errors: [] };
  } catch (error) {
    return { places: [], errors: [error.message] };
  }
}

function previewBatch() {
  const { places, errors } = parseBatchText(els.batchInput.value);
  parsedBatchPlaces = places;
  if (errors.length) {
    els.batchPreview.textContent = errors[0];
    els.batchPreview.style.color = '#fecaca';
  } else if (places.length) {
    els.batchPreview.textContent = `${places.length} valid ${places.length === 1 ? 'place' : 'places'} ready to import.`;
    els.batchPreview.style.color = '#bbf7d0';
  } else {
    els.batchPreview.textContent = 'Paste rows or choose a file to preview the import.';
    els.batchPreview.style.color = '';
  }
  els.importBtn.disabled = !appPassword || !places.length;
}

function clearBatch() {
  els.batchInput.value = '';
  els.batchFileInput.value = '';
  parsedBatchPlaces = [];
  previewBatch();
}

async function importBatch() {
  if (!appPassword) return setLocked(true);
  previewBatch();
  if (!parsedBatchPlaces.length) return toast('Add at least one valid place to import.');
  els.importBtn.disabled = true;
  els.importBtn.textContent = `Importing ${parsedBatchPlaces.length}…`;
  try {
    const { places } = await api('', {
      method: 'POST',
      body: JSON.stringify({ places: parsedBatchPlaces }),
    });
    const importedCount = places?.length || parsedBatchPlaces.length;
    clearBatch();
    await loadPlaces();
    toast(`Imported ${importedCount} ${importedCount === 1 ? 'place' : 'places'}.`);
  } catch (error) {
    console.error(error);
    toast(error.message);
  } finally {
    els.importBtn.textContent = 'Import places';
    els.importBtn.disabled = !appPassword || !parsedBatchPlaces.length;
  }
}

function getLabelFromDisplay(displayName) {
  return String(displayName || '').split(',')[0]?.trim() || 'Untitled place';
}

async function api(path = '', options = {}) {
  const headers = {
    Accept: 'application/json',
    'X-App-Password': appPassword,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };
  const response = await fetch(`/api/places/${path}`, { ...options, headers });
  const payload = response.status === 204
    ? {}
    : await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      appPassword = '';
      sessionStorage.removeItem(PASSWORD_KEY);
      setLocked(true);
    }
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function readPlacesCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return Array.isArray(parsed?.places) ? parsed.places : [];
  } catch {
    return [];
  }
}

function writePlacesCache(places) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      places,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Storage may be disabled; Supabase remains the source of truth.
  }
}

async function unlock() {
  const candidate = els.passwordInput.value.trim();
  if (!candidate) return toast('Enter the app password first.');
  appPassword = candidate;
  els.unlockBtn.disabled = true;
  els.unlockBtn.textContent = 'Unlocking…';
  try {
    await loadPlaces();
    sessionStorage.setItem(PASSWORD_KEY, appPassword);
    els.passwordInput.value = '';
    setLocked(false);
    toast(`Unlocked. Loaded ${savedPlaces.length} saved ${savedPlaces.length === 1 ? 'place' : 'places'}.`);
  } catch (error) {
    toast(error.message);
  } finally {
    els.unlockBtn.disabled = false;
    els.unlockBtn.textContent = 'Unlock places';
  }
}

function lock() {
  appPassword = '';
  sessionStorage.removeItem(PASSWORD_KEY);
  savedPlaces = [];
  selectedTags.clear();
  savedLayer.clearLayers();
  renderPlaces([]);
  setLocked(true);
}

function stagePlace({ id = null, label, display_name, lat, lng, tags = [] }) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return toast('Those coordinates do not look valid.');
  }

  editingPlaceId = id ? String(id) : null;
  els.labelInput.value = label || getLabelFromDisplay(display_name);
  els.displayInput.value = display_name || label || '';
  els.latInput.value = latNum.toFixed(6);
  els.lngInput.value = lngNum.toFixed(6);
  els.tagsInput.value = Array.isArray(tags) ? tags.join(', ') : String(tags || '');
  els.saveBtn.textContent = editingPlaceId ? 'Update place' : 'Save place';

  if (stagedMarker) stagedMarker.remove();
  stagedMarker = L.marker([latNum, lngNum], { draggable: true })
    .addTo(map)
    .bindPopup(`<strong>${editingPlaceId ? 'Editing' : 'Staged'}:</strong><br>${esc(els.labelInput.value)}`)
    .openPopup();

  stagedMarker.on('dragend', () => {
    const pos = stagedMarker.getLatLng();
    els.latInput.value = pos.lat.toFixed(6);
    els.lngInput.value = pos.lng.toFixed(6);
  });
  map.setView([latNum, lngNum], Math.max(map.getZoom(), 11));
}

async function searchPlaces() {
  const q = els.searchInput.value.trim();
  if (!q) return toast('Type a city, ZIP, address, or place first.');

  els.searchBtn.disabled = true;
  els.searchBtn.textContent = 'Searching…';
  els.results.innerHTML = '<div class="hint">Searching OpenStreetMap…</div>';

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '8');

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Search failed (${response.status})`);
    const rows = await response.json();

    if (!rows.length) {
      els.results.innerHTML = '<div class="empty">No matches. Try adding a city or state.</div>';
      return;
    }

    els.results.innerHTML = rows.map((row, index) => {
      const typeBits = [row.type, row.class].filter(Boolean).join(' · ');
      return `
        <button class="result" type="button" data-result="${index}">
          <span class="title">${esc(getLabelFromDisplay(row.display_name))}</span>
          <span class="meta">${esc(row.display_name)}</span>
          <span class="meta">${esc(typeBits)} · ${Number(row.lat).toFixed(5)}, ${Number(row.lon).toFixed(5)}</span>
        </button>`;
    }).join('');

    els.results.querySelectorAll('[data-result]').forEach((element) => {
      element.addEventListener('click', () => {
        const row = rows[Number(element.dataset.result)];
        stagePlace({
          label: getLabelFromDisplay(row.display_name),
          display_name: row.display_name,
          lat: row.lat,
          lng: row.lon,
          tags: guessTags(row),
        });
      });
    });
  } catch (error) {
    console.error(error);
    els.results.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  } finally {
    els.searchBtn.disabled = false;
    els.searchBtn.textContent = 'Search';
  }
}

function guessTags(result) {
  const tags = [];
  const kind = `${result.class || ''} ${result.type || ''}`.toLowerCase();
  if (/city|town|village/.test(kind)) tags.push('city');
  if (/park|nature/.test(kind)) tags.push('park');
  if (kind.includes('airport')) tags.push('airport');
  if (kind.includes('stadium')) tags.push('stadium');
  if (result.address?.postcode) tags.push('zip');
  tags.push('map');
  return tags;
}

async function savePlace() {
  if (!appPassword) return setLocked(true);
  const payload = {
    id: editingPlaceId,
    label: els.labelInput.value.trim(),
    display_name: els.displayInput.value.trim(),
    lat: Number(els.latInput.value),
    lng: Number(els.lngInput.value),
    tags: parseTags(els.tagsInput.value),
  };
  if (!payload.label) return toast('Label is required.');
  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return toast('Latitude and longitude are required.');
  }

  els.saveBtn.disabled = true;
  const wasEditing = Boolean(editingPlaceId);
  els.saveBtn.textContent = wasEditing ? 'Updating…' : 'Saving…';
  try {
    await api('', {
      method: wasEditing ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    toast(wasEditing ? 'Place updated.' : 'Place saved. Pin officially exists. 📌');
    clearForm();
    await loadPlaces();
  } catch (error) {
    console.error(error);
    toast(error.message);
  } finally {
    els.saveBtn.disabled = !appPassword;
    els.saveBtn.textContent = editingPlaceId ? 'Update place' : 'Save place';
  }
}

async function loadPlaces() {
  if (!appPassword) return setLocked(true);
  setStatus('Syncing…');
  try {
    const { places } = await api();
    savedPlaces = places || [];
    writePlacesCache(savedPlaces);
    setStatus('Connected', 'good');
    renderTagFilters();
    renderPlaces(savedPlaces);
    renderSavedMarkers(savedPlaces);
    if (savedPlaces.length && !hasFramedInitialPlaces) {
      hasFramedInitialPlaces = true;
      fitSavedPlaces();
    }
  } catch (error) {
    setStatus(error.message.includes('password') ? 'Locked' : 'Sync failed', 'bad');
    const cachedPlaces = readPlacesCache();
    if (appPassword && cachedPlaces.length) {
      savedPlaces = cachedPlaces;
      renderTagFilters();
      renderPlaces(savedPlaces);
      renderSavedMarkers(savedPlaces);
      setStatus(`Cached · ${cachedPlaces.length}`, 'neutral');
      toast('Supabase was unavailable, so the last saved copy was loaded.');
      return;
    }
    throw error;
  }
}

function renderTagFilters() {
  const tagsByKey = new Map();
  savedPlaces.forEach((place) => {
    (place.tags || []).forEach((tag) => {
      const display = String(tag).trim();
      const key = display.toLowerCase();
      if (key && !tagsByKey.has(key)) tagsByKey.set(key, display);
    });
  });
  const tags = [...tagsByKey.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  selectedTags = new Set([...selectedTags].filter((tag) => tagsByKey.has(tag)));
  els.tagFilterSection.hidden = !tags.length;
  els.clearTagsBtn.hidden = !selectedTags.size;
  els.tagFilters.innerHTML = tags.map(([key, display]) => `
    <button
      type="button"
      class="tag-toggle"
      data-filter-tag="${esc(key)}"
      aria-pressed="${selectedTags.has(key)}"
    >${esc(display)}</button>
  `).join('');
  els.tagFilters.querySelectorAll('[data-filter-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.filterTag;
      if (selectedTags.has(tag)) selectedTags.delete(tag);
      else selectedTags.add(tag);
      renderTagFilters();
      renderPlaces(savedPlaces);
    });
  });
}

function renderPlaces(rows) {
  const filter = els.filterInput.value.trim().toLowerCase();
  const filtered = rows.filter((place) => {
    const haystack = `${place.label || ''} ${place.display_name || ''} ${(place.tags || []).join(' ')}`.toLowerCase();
    const textMatches = !filter || haystack.includes(filter);
    const placeTags = new Set((place.tags || []).map((tag) => String(tag).toLowerCase()));
    const tagsMatch = !selectedTags.size || [...selectedTags].some((tag) => placeTags.has(tag));
    return textMatches && tagsMatch;
  });
  els.countBox.value = String(filtered.length);

  if (!filtered.length) {
    els.places.innerHTML = `<div class="empty">${rows.length ? 'No saved places match that filter.' : 'No pins yet. Search above and save your first place.'}</div>`;
    renderSavedMarkers(filtered);
    return;
  }

  els.places.innerHTML = filtered.map((place) => `
    <article class="place" data-id="${esc(place.id)}">
      <div class="title">${esc(place.label)}</div>
      <div class="meta">${esc(place.display_name || '')}</div>
      <div class="meta">${Number(place.lat).toFixed(5)}, ${Number(place.lng).toFixed(5)}</div>
      <div class="tags">${(place.tags || []).map((tag) => `
        <button class="tag" type="button" data-place-tag="${esc(String(tag).toLowerCase())}">${esc(tag)}</button>
      `).join('')}</div>
      <div class="place-actions">
        <button class="secondary" data-action="zoom" data-id="${esc(place.id)}">Zoom</button>
        <button class="secondary" data-action="edit" data-id="${esc(place.id)}">Edit</button>
        <button class="bad" data-action="delete" data-id="${esc(place.id)}">Delete</button>
      </div>
    </article>
  `).join('');

  els.places.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const place = savedPlaces.find((item) => String(item.id) === button.dataset.id);
      if (!place) return;
      if (button.dataset.action === 'zoom') zoomToPlace(place);
      if (button.dataset.action === 'edit') stagePlace(place);
      if (button.dataset.action === 'delete') await deletePlace(place.id);
    });
  });
  els.places.querySelectorAll('[data-place-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedTags.add(button.dataset.placeTag);
      renderTagFilters();
      renderPlaces(savedPlaces);
    });
  });
  renderSavedMarkers(filtered);
}

function renderSavedMarkers(rows) {
  savedLayer.clearLayers();
  rows.forEach((place) => {
    const lat = Number(place.lat);
    const lng = Number(place.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    L.marker([lat, lng])
      .bindPopup(`<strong>${esc(place.label)}</strong><br>${esc(place.display_name || '')}<br><small>${esc((place.tags || []).join(', '))}</small>`)
      .addTo(savedLayer);
  });
}

function zoomToPlace(place) {
  map.setView([Number(place.lat), Number(place.lng)], 13);
  toast(`Zoomed to ${place.label}`);
}

function fitSavedPlaces() {
  const points = savedPlaces
    .map((place) => [Number(place.lat), Number(place.lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!points.length) return toast('Save a place first, then I can frame the map.');
  if (points.length === 1) return map.setView(points[0], 13);
  map.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
}

async function deletePlace(id) {
  if (!confirm('Delete this saved place?')) return;
  try {
    await api(`?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (String(id) === editingPlaceId) clearForm();
    toast('Place deleted.');
    await loadPlaces();
  } catch (error) {
    console.error(error);
    toast(error.message);
  }
}

function clearForm(clearMarker = true) {
  editingPlaceId = null;
  els.labelInput.value = '';
  els.displayInput.value = '';
  els.latInput.value = '';
  els.lngInput.value = '';
  els.tagsInput.value = '';
  els.saveBtn.textContent = 'Save place';
  if (clearMarker && stagedMarker) {
    stagedMarker.remove();
    stagedMarker = null;
  }
}

map.on('click', (event) => {
  if (!mapClickMode) return;
  stagePlace({
    label: 'Manual pin',
    display_name: `Manual pin at ${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`,
    lat: event.latlng.lat,
    lng: event.latlng.lng,
    tags: ['manual', 'map'],
  });
  mapClickMode = false;
  els.useMapBtn.textContent = 'Use map click';
});

els.unlockBtn.addEventListener('click', unlock);
els.passwordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') unlock();
});
els.lockBtn.addEventListener('click', lock);
els.searchBtn.addEventListener('click', searchPlaces);
els.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') searchPlaces();
});
els.useMapBtn.addEventListener('click', () => {
  mapClickMode = !mapClickMode;
  els.useMapBtn.textContent = mapClickMode ? 'Click map now…' : 'Use map click';
  toast(mapClickMode ? 'Click anywhere on the map to stage a pin.' : 'Map click mode off.');
});
els.loadBtn.addEventListener('click', () => loadPlaces().catch((error) => toast(error.message)));
els.fitBtn.addEventListener('click', fitSavedPlaces);
els.retryMapBtn.addEventListener('click', retryBaseMap);
els.saveBtn.addEventListener('click', savePlace);
els.clearBtn.addEventListener('click', () => clearForm(true));
els.batchInput.addEventListener('input', previewBatch);
els.batchFileInput.addEventListener('change', async () => {
  const file = els.batchFileInput.files?.[0];
  if (!file) return;
  try {
    els.batchInput.value = await file.text();
    previewBatch();
  } catch (error) {
    console.error(error);
    toast('That file could not be read.');
  }
});
els.importBtn.addEventListener('click', importBatch);
els.clearBatchBtn.addEventListener('click', clearBatch);
els.filterInput.addEventListener('input', () => renderPlaces(savedPlaces));
els.clearTagsBtn.addEventListener('click', () => {
  selectedTags.clear();
  renderTagFilters();
  renderPlaces(savedPlaces);
});
window.addEventListener('resize', () => setTimeout(() => map.invalidateSize(), 150));

previewBatch();
setLocked(!appPassword);
requestAnimationFrame(() => map.invalidateSize({ animate: false, pan: false }));
setTimeout(() => map.invalidateSize({ animate: false, pan: false }), 250);
if (appPassword) {
  loadPlaces()
    .then(() => setLocked(false))
    .catch((error) => toast(error.message));
}
