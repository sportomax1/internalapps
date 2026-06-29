/**
 * OpenSCAD Studio — app.js
 *
 * Handles:
 *  - CodeMirror 5 editor (syntax highlighting, keyboard shortcuts)
 *  - Three.js 3D STL viewer (orbit, grid, axes, bounding box, wireframe)
 *  - Compile workflow: POST /compile → binary STL → viewer
 *  - File I/O (open/save .scad, download .stl, drag-and-drop)
 *  - Board game template library
 *  - Dark / light theme
 *  - Panel drag-to-resize
 *  - Autosave to localStorage
 *  - window.openscadStudio — public AI / LLM integration API
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader }     from 'three/addons/loaders/STLLoader.js';

/* ════════════════════════════════════════════════════════════════
   CONSTANTS & DEFAULT CODE
   ════════════════════════════════════════════════════════════════ */

const LS_API_URL  = 'openscad_api_url';
const LS_AUTOSAVE = 'openscad_autosave_code';
const LS_FILENAME = 'openscad_filename';
const LS_THEME    = 'openscad_theme';
const COMPILE_TIMEOUT_MS = 60_000;

/**
 * Default example: parametric dice tray.
 * Demonstrates common OpenSCAD patterns users can build on.
 */
const DEFAULT_CODE = `// ════════════════════════════════════════════════════════
// OpenSCAD Studio — Parametric Dice Tray
// Press F5 (or Ctrl+Enter) to compile and preview.
// ════════════════════════════════════════════════════════

/* [Tray Dimensions] */
tray_width  = 120;   // total width, mm
tray_depth  = 80;    // total depth, mm
tray_height = 25;    // total height, mm
wall        = 2.5;   // wall thickness, mm

/* [Style] */
corner_radius  = 6;    // rounded corner radius, mm
floor_pattern  = true; // ventilation holes on floor
floor_hole_r   = 2;    // hole radius, mm
floor_spacing  = 8;    // hole grid spacing, mm

/* [Quality] */
$fn = 40;

// ─── Assembly ───────────────────────────────────────────
difference() {
    // Outer rounded shell
    rounded_box([tray_width, tray_depth, tray_height], corner_radius);

    // Inner cavity (open top)
    translate([wall, wall, wall])
        rounded_box(
            [tray_width - wall*2, tray_depth - wall*2, tray_height],
            max(0, corner_radius - wall)
        );

    // Floor ventilation pattern
    if (floor_pattern) {
        for (x = [wall + floor_spacing : floor_spacing : tray_width - wall])
            for (y = [wall + floor_spacing : floor_spacing : tray_depth - wall])
                translate([x, y, -0.01])
                    cylinder(h = wall + 0.02, r = floor_hole_r);
    }
}

// ─── Module: rounded box via hull ───────────────────────
module rounded_box(size, r) {
    r2 = min(r, size[0]/2 - 0.1, size[1]/2 - 0.1);
    hull()
        for (x = [r2, size[0]-r2], y = [r2, size[1]-r2])
            translate([x, y, 0])
                cylinder(h = size[2], r = r2);
}
`;

/* ════════════════════════════════════════════════════════════════
   TEMPLATE LIBRARY  (board game components)
   ════════════════════════════════════════════════════════════════ */

const TEMPLATES = {

  'dice-tray': DEFAULT_CODE,

  'dice-tower': `// Parametric Dice Tower
/* [Dimensions] */
base_w = 70;    // mm
base_d = 70;    // mm
height = 130;   // mm
wall   = 2.5;   // mm
/* [Baffles] */
baffle_count = 3;
baffle_angle = 35; // degrees tilt
/* [Quality] */
$fn = 32;

difference() {
    cube([base_w, base_d, height]);
    // Hollow interior
    translate([wall, wall, wall])
        cube([base_w - wall*2, base_d - wall*2, height]);
    // Front exit opening (lower 40 %)
    translate([-0.1, wall*2, 0])
        cube([wall + 0.2, base_d - wall*4, height * 0.4]);
    // Top entry opening
    translate([wall*2, wall*2, height - wall - 0.1])
        cube([base_w - wall*4, base_d - wall*4, wall + 0.2]);
}

// Baffles
for (i = [0 : baffle_count - 1]) {
    z    = height * 0.38 + i * (height * 0.18);
    side = (i % 2 == 0) ? 0 : 1;
    translate([side == 0 ? wall : base_w - wall*4, wall, z])
        rotate([0, baffle_angle * (side == 0 ? 1 : -1), 0])
            cube([base_w * 0.6, base_d - wall*2, wall]);
}
`,

  'deck-box': `// Parametric Deck Box
/* [Card Size] */
card_w    = 64;    // standard card width, mm
card_h    = 89;    // standard card height, mm
/* [Capacity] */
capacity  = 60;    // number of sleeved cards
sleeve_t  = 0.4;   // sleeve thickness per card, mm
/* [Box] */
wall      = 2;
floor_t   = 1.5;
tol       = 0.3;
/* [Quality] */
$fn = 32;

inner_w = card_w + tol;
inner_d = capacity * sleeve_t + tol;
inner_h = card_h + tol;
outer_w = inner_w + wall*2;
outer_d = inner_d + wall*2;
outer_h = inner_h + floor_t + wall;

difference() {
    cube([outer_w, outer_d, outer_h]);
    // Inner cavity
    translate([wall, wall, floor_t])
        cube([inner_w, inner_d, inner_h + wall + 0.1]);
    // Thumb notch
    translate([outer_w/2 - 14, -0.1, inner_h/2])
        rotate([-90, 0, 0])
            cylinder(h = wall + 0.2, r = 14, $fn = 32);
}
`,

  'card-tray': `// Parametric Card Tray (multi-slot)
/* [Card Size] */
card_w = 64;
card_h = 89;
/* [Layout] */
cols   = 3;   // number of column stacks
rows   = 1;   // number of row stacks
/* [Tray] */
tray_h = 35;
wall   = 2;
gap    = 5;
tol    = 0.6;
$fn    = 32;

slot_w  = card_w + tol;
slot_d  = card_h + tol;
total_w = cols * slot_w + (cols + 1) * wall + (cols - 1) * gap;
total_d = rows * slot_d + (rows + 1) * wall + (rows - 1) * gap;

difference() {
    cube([total_w, total_d, tray_h]);
    for (c = [0:cols-1], r = [0:rows-1]) {
        x = wall + c * (slot_w + wall + gap);
        y = wall + r * (slot_d + wall + gap);
        // Slot cavity
        translate([x, y, wall])
            cube([slot_w, slot_d, tray_h]);
        // Front finger notch
        translate([x + slot_w/2 - 12, -0.1, tray_h - 18])
            cube([24, wall + 0.2, 18.1]);
    }
}
`,

  'token-tray': `// Parametric Token / Coin Tray
/* [Token Size] */
token_d = 22;    // token diameter, mm
token_h = 4;     // token height, mm
stack_n = 12;    // tokens per stack
/* [Layout] */
cols    = 4;
rows    = 2;
/* [Tray] */
wall    = 2;
gap     = 4;
tol     = 0.6;
$fn     = 48;

slot_r  = token_d/2 + tol;
slot_h  = stack_n * token_h + wall;
pitch_x = token_d + tol*2 + gap + wall;
pitch_y = token_d + tol*2 + gap + wall;
total_w = cols * pitch_x + wall;
total_d = rows * pitch_y + wall;

difference() {
    cube([total_w, total_d, slot_h]);
    for (c = [0:cols-1], r = [0:rows-1]) {
        cx = wall + c * pitch_x + slot_r;
        cy = wall + r * pitch_y + slot_r;
        translate([cx, cy, wall])
            cylinder(h = slot_h, r = slot_r);
    }
}
`,

  'insert-box': `// Parametric Game Box Insert
/* [Outer Box] */
box_w = 200;
box_d = 150;
box_h = 45;
wall  = 2.5;
/* [Dividers] */
v_divs = 2;   // vertical dividers (left-right splits)
h_divs = 1;   // horizontal dividers (front-back splits)
$fn    = 32;

// Outer shell
difference() {
    cube([box_w, box_d, box_h]);
    translate([wall, wall, wall])
        cube([box_w - wall*2, box_d - wall*2, box_h]);
}

// Vertical dividers
if (v_divs > 0) {
    step = (box_w - wall*2) / (v_divs + 1);
    for (i = [1:v_divs])
        translate([wall + step*i - wall/2, wall, wall])
            cube([wall, box_d - wall*2, box_h - wall]);
}

// Horizontal dividers
if (h_divs > 0) {
    step = (box_d - wall*2) / (h_divs + 1);
    for (i = [1:h_divs])
        translate([wall, wall + step*i - wall/2, wall])
            cube([box_w - wall*2, wall, box_h - wall]);
}
`,

  'card-divider': `// Card Divider / Tab Spacer
/* [Size] */
width    = 67;   // slightly wider than card, mm
body_h   = 30;   // body height, mm
tab_h    = 16;   // label tab height, mm
tab_w    = 22;   // label tab width, mm
tab_pos  = 0;    // 0 = left, 1 = center, 2 = right
thickness = 1.2; // mm
$fn = 20;

tab_x = (tab_pos == 0) ? 3 :
        (tab_pos == 2) ? width - tab_w - 3 :
        (width - tab_w) / 2;

cube([width, thickness, body_h]);
translate([tab_x, 0, body_h])
    cube([tab_w, thickness, tab_h]);
`,

  'tile-holder': `// Parametric Tile Stack Holder
/* [Tile] */
tile_w  = 36;    // mm
tile_d  = 36;    // mm
tile_h  = 4.5;   // mm per tile
stack_n = 20;    // tiles per stack
tol     = 0.6;
/* [Holder] */
wall    = 2;
$fn     = 32;

inner_w = tile_w + tol;
inner_d = tile_d + tol;
outer_w = inner_w + wall*2;
outer_d = inner_d + wall*2;
total_h = tile_h * stack_n + wall;

difference() {
    cube([outer_w, outer_d, total_h]);
    // Interior stack channel
    translate([wall, wall, wall])
        cube([inner_w, inner_d, total_h]);
    // Side access slot (retrieve tiles easily)
    translate([-0.1, outer_d/2 - 16, total_h * 0.3])
        cube([wall + 0.2, 32, total_h * 0.7 + 0.1]);
}
`,

  'parametric-box': `// Simple Parametric Box
/* [Dimensions] */
width  = 100;
depth  = 80;
height = 40;
wall   = 2.5;
/* [Options] */
rounded = true;
radius  = 5;
$fn     = 48;

difference() {
    if (rounded) rounded_box([width, depth, height], radius);
    else         cube([width, depth, height]);

    translate([wall, wall, wall])
        if (rounded)
            rounded_box([width-wall*2, depth-wall*2, height], max(0, radius-wall));
        else
            cube([width-wall*2, depth-wall*2, height]);
}

module rounded_box(s, r) {
    hull()
        for (x=[r, s[0]-r], y=[r, s[1]-r])
            translate([x, y, 0])
                cylinder(h=s[2], r=r);
}
`,

  'snap-lid': `// Snap-Fit Box + Lid
/* [Box] */
box_w = 80;
box_d = 60;
box_h = 30;
wall  = 2;
/* [Lid] */
lid_h = 10;
tol   = 0.25;   // fit tolerance
snap  = 1.2;    // snap nub protrusion
$fn   = 32;

// ── Box body ─────────────────────────────
difference() {
    cube([box_w, box_d, box_h]);
    translate([wall, wall, wall])
        cube([box_w-wall*2, box_d-wall*2, box_h]);
    // Snap groove (front and back)
    translate([-0.1, -0.1, box_h - snap*2 - 1])
        cube([box_w+0.2, wall+0.1, snap*2]);
    translate([-0.1, box_d-wall-0.1, box_h - snap*2 - 1])
        cube([box_w+0.2, wall+0.1, snap*2]);
}

// ── Lid (offset to the side for printing) ─
translate([box_w + 12, 0, 0]) {
    difference() {
        cube([box_w, box_d, lid_h]);
        translate([wall+tol, wall+tol, wall])
            cube([box_w-wall*2-tol*2, box_d-wall*2-tol*2, lid_h]);
    }
    // Snap nubs
    translate([wall+tol, 0, lid_h - snap - 0.5])
        cube([box_w-wall*2-tol*2, wall+tol, snap]);
}
`,
};

/* ════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════ */

let apiUrl         = localStorage.getItem(LS_API_URL) ?? '';
let currentSTLBlob = null;  // last compiled STL as Blob
let compileTimeMs  = null;  // ms
let isDirty        = false; // unsaved changes flag

/* ════════════════════════════════════════════════════════════════
   DOM HELPERS
   ════════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

/* ════════════════════════════════════════════════════════════════
   CODEMIRROR EDITOR
   ════════════════════════════════════════════════════════════════ */

const editor = CodeMirror($('editor-container'), {
  value:           localStorage.getItem(LS_AUTOSAVE) ?? DEFAULT_CODE,
  mode:            'text/x-c++src',   // C++ mode handles OpenSCAD syntax well
  theme:           'material-darker',
  lineNumbers:     true,
  matchBrackets:   true,
  autoCloseBrackets: true,
  foldGutter:      true,
  autoRefresh:     true,
  gutters:         ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
  tabSize:         2,
  indentWithTabs:  false,
  lineWrapping:    false,
  extraKeys: {
    'Ctrl-/':       cm => cm.execCommand('toggleComment'),
    'Cmd-/':        cm => cm.execCommand('toggleComment'),
    'F5':           ()  => handleCompile(),
    'Ctrl-Enter':   ()  => handleCompile(),
    'Cmd-Enter':    ()  => handleCompile(),
    'Ctrl-S':       ()  => handleSave(),
    'Cmd-S':        ()  => handleSave(),
    'Ctrl-N':       ()  => handleNew(),
    'Cmd-N':        ()  => handleNew(),
    'Ctrl-O':       ()  => $('file-open-input').click(),
    'Cmd-O':        ()  => $('file-open-input').click(),
    'Ctrl-D':       ()  => handleDownload(),
    'Cmd-D':        ()  => handleDownload(),
  },
});

// Debounced autosave
const debouncedAutosave = debounce(() => {
  localStorage.setItem(LS_AUTOSAVE, editor.getValue());
}, 1200);

editor.on('change', () => {
  setDirty(true);
  debouncedAutosave();
});

/* ════════════════════════════════════════════════════════════════
   THREE.JS SCENE SETUP
   ════════════════════════════════════════════════════════════════ */

const canvas    = $('viewer-canvas');
const viewerCtr = $('viewer-container');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.outputColorSpace  = THREE.SRGBColorSpace;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50000);
camera.position.set(150, 120, 200);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.07;
controls.screenSpacePanning = true;
controls.minDistance    = 1;
controls.maxDistance    = 20000;

// ── Lighting ────────────────────────────────────────────────────
const ambientLight  = new THREE.AmbientLight(0xffffff, 0.55);
const sunLight      = new THREE.DirectionalLight(0xffffff, 0.95);
const fillLight     = new THREE.DirectionalLight(0x8ec5fc, 0.30);
sunLight.position.set(200, 350, 200);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
fillLight.position.set(-200, -100, -200);
scene.add(ambientLight, sunLight, fillLight);

// ── Grid & Axes ──────────────────────────────────────────────────
const gridHelper = new THREE.GridHelper(400, 40, 0x333355, 0x222244);
const axesHelper = new THREE.AxesHelper(70);
scene.add(gridHelper, axesHelper);

// ── Scene objects (model, bbox, wireframe) ──────────────────────
let modelMesh     = null;
let bboxHelper    = null;
let wireframeMesh = null;

// ── Viewer state flags ───────────────────────────────────────────
let showWireframe = false;
let showBBox      = false;

// ── Render loop ──────────────────────────────────────────────────
(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

// ── Resize observer ──────────────────────────────────────────────
new ResizeObserver(() => {
  const w = viewerCtr.clientWidth;
  const h = viewerCtr.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(viewerCtr);

/* ════════════════════════════════════════════════════════════════
   STL LOADING
   ════════════════════════════════════════════════════════════════ */

const stlLoader = new STLLoader();

/**
 * Parse an STL ArrayBuffer and add the mesh to the scene.
 * @param {ArrayBuffer} buffer
 */
function loadSTL(buffer) {
  // Remove previous model from scene
  if (modelMesh)     { scene.remove(modelMesh);     modelMesh.geometry.dispose();     }
  if (wireframeMesh) { scene.remove(wireframeMesh); wireframeMesh.geometry.dispose(); }
  if (bboxHelper)    { scene.remove(bboxHelper);                                      }

  const geometry = stlLoader.parse(buffer);
  geometry.computeVertexNormals();
  geometry.center(); // center at origin for better orbit experience

  // Solid material
  const solidMat = new THREE.MeshPhongMaterial({
    color:     0x89b4fa,
    specular:  0x333355,
    shininess: 28,
    side:      THREE.DoubleSide,
  });
  modelMesh = new THREE.Mesh(geometry, solidMat);
  modelMesh.castShadow    = true;
  modelMesh.receiveShadow = true;

  // Wireframe overlay
  const wireMat = new THREE.MeshBasicMaterial({
    color:       0xffffff,
    wireframe:   true,
    transparent: true,
    opacity:     0.09,
    visible:     showWireframe,
  });
  wireframeMesh = new THREE.Mesh(geometry, wireMat);

  scene.add(modelMesh, wireframeMesh);

  // Bounding box helper
  const bbox = new THREE.Box3().setFromObject(modelMesh);
  bboxHelper = new THREE.Box3Helper(bbox, new THREE.Color(0xf9e2af));
  bboxHelper.visible = showBBox;
  scene.add(bboxHelper);

  // Fit camera
  fitCamera(bbox);

  // Status bar
  const size = bbox.getSize(new THREE.Vector3());
  const pos  = geometry.attributes.position;
  const tris = geometry.index ? geometry.index.count / 3 : pos.count / 3;
  updateStatusBar(size, Math.round(tris), buffer.byteLength);

  // Reveal canvas, hide empty state
  $('viewer-empty').classList.add('hidden');
}

/**
 * Adjust camera to frame the given bounding box nicely.
 * @param {THREE.Box3} bbox
 */
function fitCamera(bbox) {
  const center = bbox.getCenter(new THREE.Vector3());
  const size   = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov    = camera.fov * (Math.PI / 180);
  const dist   = (maxDim / 2) / Math.tan(fov / 2) * 2.0;

  camera.position.set(
    center.x + dist * 0.6,
    center.y + dist * 0.55,
    center.z + dist * 0.8,
  );
  controls.target.copy(center);
  camera.near = Math.max(0.1, dist * 0.005);
  camera.far  = dist * 200;
  camera.updateProjectionMatrix();
  controls.update();
}

/* ════════════════════════════════════════════════════════════════
   COMPILE
   ════════════════════════════════════════════════════════════════ */

async function handleCompile() {
  if (!apiUrl) {
    openSettings();
    setStatusMsg('⚠ Set your backend API URL in Settings first.');
    return;
  }

  clearErrors();
  showOverlay(true, 'Compiling…');
  $('btn-download').disabled = true;
  currentSTLBlob = null;

  const code = editor.getValue();
  const t0   = performance.now();

  try {
    const res = await fetchWithTimeout(
      `${apiUrl}/compile`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
      },
      COMPILE_TIMEOUT_MS,
    );

    if (!res.ok) {
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const errBody = await res.json();
        const errors  = errBody.errors ?? [{ message: errBody.error ?? `HTTP ${res.status}`, line: null }];
        displayErrors(errors);
        setStatusMsg(`Compile failed — ${errors.length} error(s)`);
      } else {
        const text = await res.text();
        displayErrors([{ message: text || `HTTP ${res.status}`, line: null }]);
        setStatusMsg(`Compile failed (HTTP ${res.status})`);
      }
      return;
    }

    compileTimeMs = Math.round(performance.now() - t0);
    const buffer  = await res.arrayBuffer();
    currentSTLBlob = new Blob([buffer], { type: 'application/octet-stream' });
    loadSTL(buffer);
    $('btn-download').disabled = false;
    setStatusMsg(`Compiled successfully in ${compileTimeMs} ms`);

  } catch (err) {
    if (err.name === 'AbortError') {
      displayErrors([{ message: 'Compilation timed out (60 s). Try simplifying your model.', line: null }]);
      setStatusMsg('Compile timed out');
    } else {
      displayErrors([{ message: `Network error: ${err.message}`, line: null }]);
      setStatusMsg('Compile failed — check the console for details');
    }
  } finally {
    showOverlay(false);
  }
}

/* ════════════════════════════════════════════════════════════════
   FILE I/O
   ════════════════════════════════════════════════════════════════ */

function handleNew() {
  if (isDirty && !confirm('Discard unsaved changes and start a new file?')) return;
  editor.setValue(DEFAULT_CODE);
  setFileName('untitled.scad');
  setDirty(false);
  currentSTLBlob = null;
  $('btn-download').disabled = true;
  setStatusMsg('New file');
}

function handleSave() {
  const code = editor.getValue();
  const name = $('file-name').textContent;
  downloadBlob(new Blob([code], { type: 'text/plain' }), name);
  setDirty(false);
  setStatusMsg(`Saved ${name}`);
}

function handleDownload() {
  if (!currentSTLBlob) return;
  const name = $('file-name').textContent.replace(/\.scad$/, '') + '.stl';
  downloadBlob(currentSTLBlob, name);
  setStatusMsg(`Downloaded ${name}`);
}

/**
 * Handle a File object dropped or opened by the user.
 * .stl  → load directly into viewer
 * .scad → load into editor
 * @param {File} file
 */
function handleOpenFile(file) {
  if (!file) return;
  const reader = new FileReader();
  if (file.name.toLowerCase().endsWith('.stl')) {
    reader.onload = e => {
      currentSTLBlob = new Blob([e.target.result]);
      loadSTL(e.target.result);
      $('btn-download').disabled = false;
      setFileName(file.name);
      setStatusMsg(`Loaded ${file.name}`);
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = e => {
      if (isDirty && !confirm('Discard unsaved changes?')) return;
      editor.setValue(e.target.result);
      setFileName(file.name);
      setDirty(false);
      setStatusMsg(`Opened ${file.name}`);
    };
    reader.readAsText(file);
  }
}

/* ════════════════════════════════════════════════════════════════
   VIEWER CONTROLS
   ════════════════════════════════════════════════════════════════ */

function handleResetCamera() {
  if (modelMesh) {
    fitCamera(new THREE.Box3().setFromObject(modelMesh));
  } else {
    camera.position.set(150, 120, 200);
    controls.target.set(0, 0, 0);
    camera.near = 0.1;
    camera.far  = 50000;
    camera.updateProjectionMatrix();
    controls.update();
  }
}

function toggleWireframe() {
  showWireframe = !showWireframe;
  if (wireframeMesh) wireframeMesh.material.visible = showWireframe;
  $('btn-wireframe').classList.toggle('active', showWireframe);
}

/**
 * Show or hide the bounding box helper.
 * @param {boolean} [value] — if omitted, toggles current state
 */
function setBBox(value) {
  showBBox = (value !== undefined) ? value : !showBBox;
  if (bboxHelper) bboxHelper.visible = showBBox;
  $('btn-bbox').classList.toggle('active', showBBox);
  $('chk-bbox-chk').checked = showBBox;
}

/* ════════════════════════════════════════════════════════════════
   THEME
   ════════════════════════════════════════════════════════════════ */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(LS_THEME, theme);
  editor.setOption('theme', theme === 'dark' ? 'material-darker' : 'default');
  renderer.setClearColor(theme === 'dark' ? 0x11111b : 0xdce0e8, 1);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ════════════════════════════════════════════════════════════════
   ERROR DISPLAY
   ════════════════════════════════════════════════════════════════ */

/**
 * Render a list of compiler errors below the editor.
 * @param {Array<{line:number|null, message:string, type?:string}>} errors
 */
function displayErrors(errors) {
  // Clear previous highlights
  for (let i = 0; i < editor.lineCount(); i++)
    editor.removeLineClass(i, 'background', 'cm-error-line');

  const list = $('error-list');
  list.innerHTML = '';

  errors.forEach(({ line, message, type }) => {
    const item   = document.createElement('div');
    item.className = 'error-item' + (type === 'WARNING' ? ' warning' : '');

    const lineEl = document.createElement('span');
    lineEl.className   = 'error-line-num';
    lineEl.textContent = line != null ? `L${line}` : '—';

    const msgEl  = document.createElement('span');
    msgEl.className   = 'error-msg';
    msgEl.textContent = message;

    item.appendChild(lineEl);
    item.appendChild(msgEl);

    // Click to jump to error line
    if (line != null) {
      item.addEventListener('click', () => {
        editor.setCursor({ line: line - 1, ch: 0 });
        editor.focus();
      });
      editor.addLineClass(line - 1, 'background', 'cm-error-line');
    }
    list.appendChild(item);
  });

  $('error-panel').classList.remove('hidden');
}

function clearErrors() {
  $('error-panel').classList.add('hidden');
  $('error-list').innerHTML = '';
  for (let i = 0; i < editor.lineCount(); i++)
    editor.removeLineClass(i, 'background', 'cm-error-line');
}

/* ════════════════════════════════════════════════════════════════
   STATUS BAR
   ════════════════════════════════════════════════════════════════ */

function updateStatusBar(size, tris, bytes) {
  $('status-dims').textContent = `${fmm(size.x)} × ${fmm(size.y)} × ${fmm(size.z)} mm`;
  $('status-tris').textContent = `${tris.toLocaleString()} triangles`;
  $('status-time').textContent = compileTimeMs != null ? `${compileTimeMs} ms` : '—';
  $('status-size').textContent = formatBytes(bytes);
}

function setStatusMsg(msg) { $('status-msg').textContent = msg; }
function fmm(n)            { return n.toFixed(1); }
function formatBytes(b)    {
  if (b < 1024)        return `${b} B`;
  if (b < 1048576)     return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(2)} MB`;
}

/* ════════════════════════════════════════════════════════════════
   UI HELPERS
   ════════════════════════════════════════════════════════════════ */

function showOverlay(visible, text = '') {
  $('compile-overlay').classList.toggle('hidden', !visible);
  if (text) $('compile-status-text').textContent = text;
}

function setFileName(name) {
  $('file-name').textContent = name;
  localStorage.setItem(LS_FILENAME, name);
}

function setDirty(val) {
  isDirty = val;
  $('dirty-indicator').classList.toggle('hidden', !val);
}

/* ════════════════════════════════════════════════════════════════
   SETTINGS MODAL
   ════════════════════════════════════════════════════════════════ */

function openSettings() {
  $('api-url-input').value = apiUrl;
  $('modal-settings').classList.remove('hidden');
  setTimeout(() => $('api-url-input').focus(), 50);
}

function closeSettings() {
  $('modal-settings').classList.add('hidden');
}

function saveSettings() {
  const url = $('api-url-input').value.trim().replace(/\/+$/, '');
  apiUrl = url;
  localStorage.setItem(LS_API_URL, url);
  closeSettings();
  setStatusMsg(url ? `API URL saved: ${url}` : 'API URL cleared');
}

/* ════════════════════════════════════════════════════════════════
   TEMPLATES
   ════════════════════════════════════════════════════════════════ */

function loadTemplate(name) {
  const code = TEMPLATES[name];
  if (!code) return;
  if (isDirty && !confirm('Replace current code with template?')) return;
  editor.setValue(code);
  setFileName(`${name}.scad`);
  setDirty(false);
  setStatusMsg(`Template loaded: ${name}`);
}

/* ════════════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════════════ */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * fetch() with an AbortController timeout.
 */
function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(id));
}

/**
 * Returns a debounced version of fn.
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ════════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ════════════════════════════════════════════════════════════════ */

// Toolbar buttons
$('btn-new').addEventListener('click', handleNew);
$('btn-open').addEventListener('click', () => $('file-open-input').click());
$('btn-save').addEventListener('click', handleSave);
$('btn-compile').addEventListener('click', handleCompile);
$('btn-download').addEventListener('click', handleDownload);
$('btn-reset-cam').addEventListener('click', handleResetCamera);
$('btn-wireframe').addEventListener('click', toggleWireframe);
$('btn-bbox').addEventListener('click', () => setBBox());
$('btn-theme').addEventListener('click', toggleTheme);
$('btn-settings').addEventListener('click', openSettings);

// Settings modal
$('btn-settings-save').addEventListener('click', saveSettings);
$('btn-settings-cancel').addEventListener('click', closeSettings);
$('btn-settings-close').addEventListener('click', closeSettings);
$('modal-settings').querySelector('.modal-backdrop').addEventListener('click', closeSettings);
$('api-url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter')  saveSettings();
  if (e.key === 'Escape') closeSettings();
});

// File open input
$('file-open-input').addEventListener('change', e => {
  handleOpenFile(e.target.files[0]);
  e.target.value = ''; // allow re-opening same file
});

// Errors close button
$('btn-close-errors').addEventListener('click', clearErrors);

// Viewer toggle checkboxes
$('chk-grid').addEventListener('change', e => { gridHelper.visible = e.target.checked; });
$('chk-axes').addEventListener('change', e => { axesHelper.visible = e.target.checked; });
$('chk-bbox-chk').addEventListener('change', e => { setBBox(e.target.checked); });

// Templates dropdown
$('btn-templates').addEventListener('click', e => {
  $('templates-menu').classList.toggle('open');
  e.stopPropagation();
});
document.querySelectorAll('.dropdown-item[data-template]').forEach(btn => {
  btn.addEventListener('click', () => {
    loadTemplate(btn.dataset.template);
    $('templates-menu').classList.remove('open');
  });
});
document.addEventListener('click', () => $('templates-menu').classList.remove('open'));

// Global keyboard shortcuts (when focus is NOT in an input)
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.classList.contains('CodeMirror-code')) return;
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey) handleResetCamera();
  if (e.key === 'w' && !e.ctrlKey && !e.metaKey) toggleWireframe();
  if (e.key === 'b' && !e.ctrlKey && !e.metaKey) setBBox();
});

// Drag-and-drop anywhere on the page
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) handleOpenFile(file);
});

/* ════════════════════════════════════════════════════════════════
   PANEL DRAG-TO-RESIZE
   ════════════════════════════════════════════════════════════════ */

(function initResizer() {
  const resizer     = $('panel-resizer');
  const editorPanel = $('editor-panel');
  const workspace   = $('workspace');
  let dragging = false;
  let startX = 0, startY = 0, startW = 0, startH = 0;

  function isHorizontal() {
    // Side-by-side layout: desktop or landscape mobile
    return workspace.offsetWidth > workspace.offsetHeight
        || window.innerWidth > 768;
  }

  function startDrag(clientX, clientY) {
    dragging = true;
    resizer.classList.add('dragging');
    startX  = clientX;
    startY  = clientY;
    startW  = editorPanel.offsetWidth;
    startH  = editorPanel.offsetHeight;
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = isHorizontal() ? 'col-resize' : 'row-resize';
  }

  function onMove(clientX, clientY) {
    if (!dragging) return;
    if (isHorizontal()) {
      const total = workspace.offsetWidth;
      const newW  = Math.min(Math.max(startW + (clientX - startX), 180), total - 180);
      editorPanel.style.width  = newW + 'px';
      editorPanel.style.height = '';
    } else {
      const total = workspace.offsetHeight;
      const newH  = Math.min(Math.max(startH + (clientY - startY), 80), total - 80);
      editorPanel.style.height = newH + 'px';
      editorPanel.style.width  = '';
    }
  }

  function stopDrag() {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor     = '';
    editor.refresh(); // CodeMirror needs to recalculate its size
  }

  // Mouse
  resizer.addEventListener('mousedown', e => { startDrag(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  document.addEventListener('mouseup',   stopDrag);

  // Touch
  resizer.addEventListener('touchstart', e => {
    const t = e.touches[0];
    startDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    onMove(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', stopDrag);
})();

/* ════════════════════════════════════════════════════════════════
   INITIALISATION
   ════════════════════════════════════════════════════════════════ */

(function init() {
  // Restore theme
  applyTheme(localStorage.getItem(LS_THEME) ?? 'dark');

  // Restore filename
  const savedName = localStorage.getItem(LS_FILENAME);
  if (savedName) setFileName(savedName);

  // Initial renderer size
  const w = viewerCtr.clientWidth;
  const h = viewerCtr.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // Status bar hint if API not configured
  if (!apiUrl) {
    setStatusMsg('⚠ No backend URL — click Settings to configure your Render API URL');
  }
})();

/* ════════════════════════════════════════════════════════════════
   PUBLIC AI / LLM API
   window.openscadStudio — callable by LLM agents or browser console

   Example prompts an LLM can handle:
     "Increase wall thickness to 4 mm."
     → openscadStudio.replaceInCode(/wall\s*=\s*[\d.]+/, 'wall = 4');
     → openscadStudio.compile();

     "Show me a dice tower."
     → openscadStudio.loadTemplate('dice-tower');
   ════════════════════════════════════════════════════════════════ */

window.openscadStudio = Object.freeze({

  /** Return the full current editor code. */
  getCode: () => editor.getValue(),

  /** Replace all editor code with new source. */
  setCode: code => {
    editor.setValue(String(code));
    setDirty(true);
  },

  /** Append source at end of current code. */
  appendCode: code => {
    editor.setValue(editor.getValue() + '\n' + code);
    setDirty(true);
  },

  /**
   * Replace first occurrence of search (string or RegExp) with replacement.
   * Returns true if a replacement was made.
   */
  replaceInCode: (search, replacement) => {
    const before = editor.getValue();
    const after  = before.replace(search, replacement);
    if (after === before) return false;
    editor.setValue(after);
    setDirty(true);
    return true;
  },

  /** Get the current filename shown in the editor header. */
  getFileName: () => $('file-name').textContent,

  /** Set the filename. */
  setFileName,

  /** Trigger a compile. Returns a Promise. */
  compile: handleCompile,

  /** Download the last compiled STL (no-op if nothing compiled). */
  downloadSTL: handleDownload,

  /** Load a named template into the editor. */
  loadTemplate,

  /** List available template names. */
  getTemplates: () => Object.keys(TEMPLATES),

  /**
   * Return bounding box of the current model in mm, or null if none loaded.
   * @returns {{ width:number, depth:number, height:number }|null}
   */
  getBoundingBox: () => {
    if (!modelMesh) return null;
    const size = new THREE.Box3().setFromObject(modelMesh).getSize(new THREE.Vector3());
    return { width: size.x, depth: size.y, height: size.z };
  },

  /** Return the last compiled STL as a Blob, or null. */
  getSTLBlob: () => currentSTLBlob,

  /** Expose internal Three.js objects for advanced use. */
  viewer: { scene, camera, renderer, controls },
});
