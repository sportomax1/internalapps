// Places Map — Leaflet + Supabase
// Fill these in after creating/configuring your Supabase project.
// This uses the public anon key, so keep RLS policies intentional.
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

const DEFAULT_CENTER = [39.5186, -104.7614]; // Parker, CO-ish
const DEFAULT_ZOOM = 5;

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const els = {
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  useMapBtn: document.getElementById('useMapBtn'),
  loadBtn: document.getElementById('loadBtn'),
  results: document.getElementById('results'),
  labelInput: document.getElementById('labelInput'),
  displayInput: document.getElementById('displayInput'),
  latInput: document.getElementById('latInput'),
  lngInput: document.getElementById('lngInput'),
  tagsInput: document.getElementById('tagsInput'),
  saveBtn: document.getElementById('saveBtn'),
  clearBtn: document.getElementById('clearBtn'),
  filterInput: document.getElementById('filterInput'),
  countBox: document.getElementById('countBox'),
  places: document.getElementById('places'),
  toast: document.getElementById('toast'),
  statusChip: document.getElementById('statusChip'),
};

let stagedMarker = null;
let savedLayer = null;
let savedPlaces = [];
let mapClickMode = false;

const map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

savedLayer = L.layerGroup().addTo(map);

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
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function setStatus(text, ok = false) {
  els.statusChip.textContent = text;
  els.statusChip.style.borderColor = ok ? 'rgba(34,197,94,.55)' : 'rgba(148,163,184,.25)';
}

function parseTags(raw) {
  return [...new Set(String(raw || '')
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean))];
}

function getLabelFromDisplay(displayName) {
  return String(displayName || '').split(',')[0]?.trim() || 'Untitled place';
}

function isConfigured() {
  return SUPABASE_URL.includes('.supabase.co') &&
    !SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
    SUPABASE_ANON_KEY &&
    SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
}

function stagePlace({ label, display_name, lat, lng, tags = [] }) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    toast('Bad coordinates. Map goblin says no.');
    return;
  }

  els.labelInput.value = label || getLabelFromDisplay(display_name);
  els.displayInput.value = display_name || label || '';
  els.latInput.value = latNum.toFixed(6);
  els.lngInput.value = lngNum.toFixed(6);
  els.tagsInput.value = Array.isArray(tags) ? tags.join(', ') : String(tags || '');

  if (stagedMarker) stagedMarker.remove();
  stagedMarker = L.marker([latNum, lngNum], { draggable: true })
    .addTo(map)
    .bindPopup(`<strong>Staged:</strong><br>${esc(els.labelInput.value)}`)
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
  els.searchBtn.textContent = 'Searching...';
  els.results.innerHTML = '<div class="hint">Searching OpenStreetMap...</div>';

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '8');

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const rows = await res.json();

    if (!rows.length) {
      els.results.innerHTML = '<div class="hint">No results found. Try a more complete search.</div>';
      return;
    }

    els.results.innerHTML = rows.map((r, idx) => {
      const typeBits = [r.type, r.class].filter(Boolean).join(' · ');
      return `
        <div class="result" data-result="${idx}">
          <div class="title">${esc(getLabelFromDisplay(r.display_name))}</div>
          <div class="meta">${esc(r.display_name)}</div>
          <div class="meta">${esc(typeBits)} · ${Number(r.lat).toFixed(5)}, ${Number(r.lon).toFixed(5)}</div>
        </div>`;
    }).join('');

    [...els.results.querySelectorAll('[data-result]')].forEach(el => {
      el.addEventListener('click', () => {
        const r = rows[Number(el.dataset.result)];
        stagePlace({
          label: getLabelFromDisplay(r.display_name),
          display_name: r.display_name,
          lat: r.lat,
          lng: r.lon,
          tags: guessTags(r),
        });
      });
    });
  } catch (err) {
    console.error(err);
    els.results.innerHTML = '<div class="hint">Search failed. Try again in a bit.</div>';
  } finally {
    els.searchBtn.disabled = false;
    els.searchBtn.textContent = 'Search';
  }
}

function guessTags(result) {
  const tags = [];
  const kind = `${result.class || ''} ${result.type || ''}`.toLowerCase();
  if (kind.includes('city') || kind.includes('town') || kind.includes('village')) tags.push('city');
  if (kind.includes('park') || kind.includes('nature')) tags.push('park');
  if (kind.includes('airport')) tags.push('airport');
  if (kind.includes('stadium')) tags.push('stadium');
  if (result.address?.postcode) tags.push('zip');
  tags.push('map');
  return tags;
}

async function savePlace() {
  if (!isConfigured()) {
    toast('Add your Supabase URL + anon key in public/places/app.js first.');
    return;
  }

  const label = els.labelInput.value.trim();
  const display_name = els.displayInput.value.trim();
  const lat = Number(els.latInput.value);
  const lng = Number(els.lngInput.value);
  const tags = parseTags(els.tagsInput.value);

  if (!label) return toast('Label is required.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return toast('Latitude and longitude are required.');

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = 'Saving...';

  const payload = { label, display_name, lat, lng, tags };
  const { error } = await sb.from('places').insert(payload);

  els.saveBtn.disabled = false;
  els.saveBtn.textContent = 'Save place';

  if (error) {
    console.error(error);
    toast(`Save failed: ${error.message}`);
    return;
  }

  toast('Saved! Pin officially exists. 📌');
  clearForm(false);
  await loadPlaces();
}

async function loadPlaces() {
  if (!isConfigured()) {
    setStatus('Supabase config needed');
    renderPlaces([]);
    return;
  }

  setStatus('Loading...');
  const { data, error } = await sb
    .from('places')
    .select('id,label,display_name,lat,lng,tags,created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    setStatus('Load failed');
    toast(`Load failed: ${error.message}`);
    return;
  }

  savedPlaces = data || [];
  setStatus('Connected', true);
  renderPlaces(savedPlaces);
  renderSavedMarkers(savedPlaces);
}

function renderPlaces(rows) {
  const filter = els.filterInput.value.trim().toLowerCase();
  const filtered = rows.filter(p => {
    if (!filter) return true;
    const haystack = `${p.label || ''} ${p.display_name || ''} ${(p.tags || []).join(' ')}`.toLowerCase();
    return haystack.includes(filter);
  });

  els.countBox.value = String(filtered.length);

  if (!filtered.length) {
    els.places.innerHTML = '<div class="hint">No saved places match.</div>';
    renderSavedMarkers(filtered);
    return;
  }

  els.places.innerHTML = filtered.map(p => `
    <div class="place" data-id="${esc(p.id)}">
      <div class="title">${esc(p.label)}</div>
      <div class="meta">${esc(p.display_name || '')}</div>
      <div class="meta">${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}</div>
      <div class="tags">${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="place-actions">
        <button class="secondary" data-action="zoom" data-id="${esc(p.id)}">Zoom</button>
        <button class="secondary" data-action="edit" data-id="${esc(p.id)}">Edit</button>
        <button class="bad" data-action="delete" data-id="${esc(p.id)}">Delete</button>
      </div>
    </div>
  `).join('');

  els.places.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const place = savedPlaces.find(p => p.id === btn.dataset.id);
      if (!place) return;
      if (btn.dataset.action === 'zoom') zoomToPlace(place);
      if (btn.dataset.action === 'edit') stagePlace(place);
      if (btn.dataset.action === 'delete') await deletePlace(place.id);
    });
  });

  renderSavedMarkers(filtered);
}

function renderSavedMarkers(rows) {
  savedLayer.clearLayers();
  rows.forEach(p => {
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return;
    const marker = L.marker([Number(p.lat), Number(p.lng)])
      .bindPopup(`<strong>${esc(p.label)}</strong><br>${esc(p.display_name || '')}<br><small>${esc((p.tags || []).join(', '))}</small>`);
    marker.addTo(savedLayer);
  });
}

function zoomToPlace(place) {
  map.setView([Number(place.lat), Number(place.lng)], 12);
  toast(`Zoomed to ${place.label}`);
}

async function deletePlace(id) {
  if (!confirm('Delete this saved place?')) return;
  const { error } = await sb.from('places').delete().eq('id', id);
  if (error) {
    console.error(error);
    toast(`Delete failed: ${error.message}`);
    return;
  }
  toast('Deleted. Tiny map funeral held.');
  await loadPlaces();
}

function clearForm(clearMarker = true) {
  els.labelInput.value = '';
  els.displayInput.value = '';
  els.latInput.value = '';
  els.lngInput.value = '';
  els.tagsInput.value = '';
  if (clearMarker && stagedMarker) {
    stagedMarker.remove();
    stagedMarker = null;
  }
}

map.on('click', (e) => {
  if (!mapClickMode) return;
  stagePlace({
    label: 'Manual pin',
    display_name: `Manual pin at ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`,
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    tags: ['manual', 'map'],
  });
  mapClickMode = false;
  els.useMapBtn.textContent = 'Use map click';
});

els.searchBtn.addEventListener('click', searchPlaces);
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchPlaces();
});
els.useMapBtn.addEventListener('click', () => {
  mapClickMode = !mapClickMode;
  els.useMapBtn.textContent = mapClickMode ? 'Click map now...' : 'Use map click';
  toast(mapClickMode ? 'Click anywhere on the map to stage a pin.' : 'Map click mode off.');
});
els.loadBtn.addEventListener('click', loadPlaces);
els.saveBtn.addEventListener('click', savePlace);
els.clearBtn.addEventListener('click', () => clearForm(true));
els.filterInput.addEventListener('input', () => renderPlaces(savedPlaces));

if (!isConfigured()) {
  setStatus('Supabase config needed');
  els.places.innerHTML = '<div class="hint">Update SUPABASE_URL and SUPABASE_ANON_KEY in <strong>public/places/app.js</strong>, then saved pins will load here.</div>';
} else {
  loadPlaces();
}
