import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import {
    newVehicleState, stepVehicle, wrapCoordinate, WORLD_HALF_LENGTH, MPS_TO_MPH,
    isOffroad, WHEEL_RADIUS, frontWheelYaw, wheelRotationDelta, relativeTargetBearing
} from "./drive-model.mjs";

const canvas = document.querySelector("#scene");
const speedEl = document.querySelector("#speed");
const driveModeEl = document.querySelector("#driveMode");
const terrainModeEl = document.querySelector("#terrainMode");
const cameraBtn = document.querySelector("#cameraBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const restartBtn = document.querySelector("#restartBtn");
const playAgainBtn = document.querySelector("#playAgainBtn");
const ringsEl = document.querySelector("#ringsCount");
const runTimeEl = document.querySelector("#runTime");
const bestTimeEl = document.querySelector("#bestTime");
const distanceEl = document.querySelector("#distance");
const progressEl = document.querySelector("#progressFill");
const ringGuideEl = document.querySelector("#ringGuide");
const messageEl = document.querySelector("#gameMessage");
const finishOverlay = document.querySelector("#finishOverlay");
const finishSummary = document.querySelector("#finishSummary");
const RING_GOAL = 10;
const RING_STARTS = [[0,38], [12,77], [-18,116], [23,172], [-36,212], [-7,-42], [22,-97], [-45,-151], [60,26], [-65,87], [90,-20], [-100,205]];
const pickups = [];
const keyboard = new Set();
const touch = {forward:false,backward:false,left:false,right:false};
const run = { rings:0, elapsed:0, best:0, started:false, paused:false, finished:false, messageUntil:0 };
try { run.best = Number(localStorage.getItem("4runner-trail-best")) || 0; } catch {}

const demoMode = new URLSearchParams(window.location.search).has("demo");

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaed1ee);
scene.fog = new THREE.Fog(0xaed1ee, 85, 260);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);

let lastFrameTime = performance.now();
let simTime = 0;
const world = new THREE.Group();
scene.add(world);

const input = {
    forward: false,
    backward: false,
    left: false,
    right: false
};

const car = {
    root: new THREE.Group(),
    speed: 0,
    heading: 0,
    steer: 0,
    wheelSpin: 0,
    suspension: 0,
    cameraMode: 0,
    model: newVehicleState()
};

const road = {
    width: 16,
    segmentLength: 28,
    count: 18,
    stripeOffset: 0
};

const reusable = {
    bodyBox: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(1, 18, 12),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 28),
    torus: new THREE.TorusGeometry(1, 0.18, 14, 32),
    tire: new THREE.TorusGeometry(1, 0.36, 14, 32),
    rim: new THREE.CylinderGeometry(1, 1, 0.28, 6),
    rock: new THREE.DodecahedronGeometry(1, 0),
    cone: new THREE.ConeGeometry(1, 1, 8)
};

const mat = {
    paint: new THREE.MeshPhysicalMaterial({
        color: 0xf6f8f4,
        roughness: 0.36,
        metalness: 0.06,
        clearcoat: 0.65,
        clearcoatRoughness: 0.22
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x101316, roughness: 0.72, metalness: 0.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x080909, roughness: 0.88 }),
    glass: new THREE.MeshPhysicalMaterial({
        color: 0x102030,
        roughness: 0.08,
        metalness: 0.02,
        transmission: 0.18,
        transparent: true,
        opacity: 0.54
    }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde0, roughness: 0.23, metalness: 0.82 }),
    darkChrome: new THREE.MeshStandardMaterial({ color: 0x41474c, roughness: 0.28, metalness: 0.65 }),
    light: new THREE.MeshStandardMaterial({ color: 0xdfefff, roughness: 0.14, metalness: 0.25, emissive: 0x8ebeff, emissiveIntensity: 0.28 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa247, roughness: 0.28, emissive: 0xff7c15, emissiveIntensity: 0.18 }),
    red: new THREE.MeshStandardMaterial({ color: 0xa80d12, roughness: 0.28, emissive: 0x620506, emissiveIntensity: 0.2 }),
    road: new THREE.MeshStandardMaterial({ color: 0x222526, roughness: 0.94 }),
    roadSide: new THREE.MeshStandardMaterial({ color: 0xc98c5a, roughness: 0.97 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xf3d982, roughness: 0.72 }),
    whiteStripe: new THREE.MeshStandardMaterial({ color: 0xe9e5dc, roughness: 0.72 }),
    scrub: new THREE.MeshStandardMaterial({ color: 0x5f7651, roughness: 1 }),
    scrubDark: new THREE.MeshStandardMaterial({ color: 0x3d5539, roughness: 1 }),
    sand: new THREE.MeshStandardMaterial({ color: 0xcfa071, roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xaa7652, roughness: 0.95 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc65a, roughness: 0.27, metalness: 0.68, emissive: 0xe58e0a, emissiveIntensity: 0.35 })
};

function mesh(geometry, material, position, scale, parent = world, cast = true, receive = true) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(position.x, position.y, position.z);
    part.scale.set(scale.x, scale.y, scale.z);
    part.castShadow = cast;
    part.receiveShadow = receive;
    parent.add(part);
    return part;
}

function roundedBox(position, scale, material, parent = car.root) {
    const group = new THREE.Group();
    const core = mesh(reusable.bodyBox, material, { x: 0, y: 0, z: 0 }, { x: scale.x, y: scale.y, z: scale.z }, group);
    const capRadius = Math.min(scale.x, scale.y, scale.z) * 0.08;
    const capGeo = new THREE.SphereGeometry(capRadius, 14, 10);
    const corners = [
        [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
    ];
    for (const [x, y, z] of corners) {
        const cap = new THREE.Mesh(capGeo, material);
        cap.position.set(x * scale.x * 0.5, y * scale.y * 0.5, z * scale.z * 0.5);
        cap.castShadow = true;
        cap.receiveShadow = true;
        group.add(cap);
    }
    core.castShadow = true;
    group.position.set(position.x, position.y, position.z);
    parent.add(group);
    return group;
}

function createLights() {
    scene.add(new THREE.HemisphereLight(0xb9d7ff, 0x8d6b4c, 2.1));

    const sun = new THREE.DirectionalLight(0xfff2df, 3.6);
    sun.position.set(-35, 60, 32);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    scene.add(sun);
}

function terrainHeight(x, z) {
    return Math.sin(x * 0.035) * Math.cos(z * 0.025) * 1.6 +
        Math.sin((x + z) * 0.018) * 1.1 - 0.7;
}
function createTerrain() {
    const groundGeo = new THREE.PlaneGeometry(520, 520, 48, 48);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const ridge = Math.sin(x * 0.035) * Math.cos(z * 0.025) * 1.6;
        const wash = Math.sin((x + z) * 0.018) * 1.1;
        pos.setY(i, ridge + wash - 0.35);
    }
    groundGeo.computeVertexNormals();
    mesh(groundGeo, mat.sand, { x: 0, y: -0.35, z: 0 }, { x: 1, y: 1, z: 1 }, world, false, true);

    for (let i = 0; i < 48; i++) {
        const side = Math.random() > 0.5 ? 1 : -1;
        const z = -230 + Math.random() * 460;
        const x = side * (18 + Math.random() * 185);
        const size = 0.8 + Math.random() * 3.7;
        const rock = mesh(reusable.rock, mat.stone, { x, y: 0.25, z }, { x: size * 1.35, y: size * 0.62, z: size }, world, true, true);
        rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.3);
    }

    for (let i = 0; i < 64; i++) {
        const side = Math.random() > 0.5 ? 1 : -1;
        const z = -240 + Math.random() * 480;
        const x = side * (13 + Math.random() * 215);
        createScrub(x, z, 0.6 + Math.random() * 1.4);
    }
}

function createScrub(x, z, scale) {
    const group = new THREE.Group();
    const clumps = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < clumps; i++) {
        const shrub = mesh(
            reusable.sphere,
            i % 2 ? mat.scrub : mat.scrubDark,
            { x: (Math.random() - 0.5) * scale * 1.6, y: scale * 0.32, z: (Math.random() - 0.5) * scale * 1.4 },
            { x: scale * (0.75 + Math.random() * 0.5), y: scale * 0.38, z: scale * (0.65 + Math.random() * 0.6) },
            group,
            true,
            true
        );
        shrub.rotation.y = Math.random() * Math.PI;
    }
    group.position.set(x, -0.1, z);
    world.add(group);
}

function createRoad() {
    for (let i = 0; i < road.count; i++) {
        const z = (i + 0.5) * road.segmentLength - (road.count * road.segmentLength) / 2;
        mesh(reusable.bodyBox, mat.road, { x: 0, y: 0.015, z }, { x: road.width, y: 0.04, z: road.segmentLength + 0.04 }, world, false, true);
        mesh(reusable.bodyBox, mat.roadSide, { x: -road.width * 0.62, y: 0.02, z }, { x: 1.8, y: 0.035, z: road.segmentLength + 0.04 }, world, false, true);
        mesh(reusable.bodyBox, mat.roadSide, { x: road.width * 0.62, y: 0.02, z }, { x: 1.8, y: 0.035, z: road.segmentLength + 0.04 }, world, false, true);
    }

    for (let i = 0; i < 28; i++) {
        const z = i * 18 - 243;
        mesh(reusable.bodyBox, mat.stripe, { x: 0, y: 0.06, z }, { x: 0.34, y: 0.04, z: 8.5 }, world, false, true);
        mesh(reusable.bodyBox, mat.whiteStripe, { x: -road.width * 0.46, y: 0.065, z }, { x: 0.22, y: 0.04, z: 11 }, world, false, true);
        mesh(reusable.bodyBox, mat.whiteStripe, { x: road.width * 0.46, y: 0.065, z }, { x: 0.22, y: 0.04, z: 11 }, world, false, true);
    }
}

// Explicit hierarchy: steering Y pivot -> rolling X axle -> fixed tire geometry.
// Vehicle forward is +Z, wheel axle is X, and the rim is visible on the OUTSIDE.
function createWheel(x, z, front = false) {
    const side = Math.sign(x);
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS - 0.06, z);
    car.root.add(pivot);

    const rolling = new THREE.Group();
    pivot.add(rolling);

    // Rubber sidewalls. Cylinders have Y axes by default; rotate into the X axle.
    const rubberCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 0.65, 22),
        mat.rubber
    );
    rubberCore.rotation.z = Math.PI / 2;
    rubberCore.castShadow = true;
    rubberCore.receiveShadow = true;
    rolling.add(rubberCore);

    // Rotate each torus from its original XY plane into the wheel's YZ plane.
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.27, 14, 30), mat.rubber);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;
    tire.receiveShadow = true;
    rolling.add(tire);

    // Put alloy rims on both sides instead of inside the body.
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.51, 0.12, 20), mat.chrome);
    rim.rotation.z = Math.PI / 2;
    rim.position.x = side * 0.38;
    rim.castShadow = true;
    rolling.add(rim);

    // Spokes are radial in the YZ plane and rotate with their wheel.
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 16), mat.darkChrome);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = side * 0.46;
    rolling.add(hub);
    const spokeGeo = new THREE.BoxGeometry(0.12, 0.47, 0.12);
    for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        const spoke = new THREE.Mesh(spokeGeo, mat.darkChrome);
        spoke.position.set(side * 0.46, Math.cos(angle) * 0.28, Math.sin(angle) * 0.28);
        spoke.rotation.x = angle;
        spoke.castShadow = true;
        rolling.add(spoke);
    }

    // Pronounced tread lugs make rolling direction visually apparent at low speed.
    const lugGeometry = new THREE.BoxGeometry(0.56, 0.09, 0.22);
    for (let i = 0; i < 14; i++) {
        const angle = i * Math.PI * 2 / 14;
        const lug = new THREE.Mesh(lugGeometry, mat.black);
        lug.position.set(0, Math.cos(angle) * 1.01, Math.sin(angle) * 1.01);
        lug.rotation.x = angle;
        lug.castShadow = true;
        rolling.add(lug);
    }

    return { pivot, rolling, front };
}

function create4Runner() {
    car.root.position.set(0, 0.1, 0);
    world.add(car.root);

    roundedBox({ x: 0, y: 1.74, z: -0.08 }, { x: 3.2, y: 1.22, z: 6.9 }, mat.paint);
    roundedBox({ x: 0, y: 2.56, z: -0.52 }, { x: 2.86, y: 1.16, z: 4.65 }, mat.paint);
    roundedBox({ x: 0, y: 2.12, z: 2.72 }, { x: 2.94, y: 0.66, z: 1.62 }, mat.paint);
    roundedBox({ x: 0, y: 2.82, z: 1.68 }, { x: 2.3, y: 0.32, z: 1.34 }, mat.paint);

    const hoodScoop = roundedBox({ x: 0, y: 2.52, z: 2.35 }, { x: 0.92, y: 0.18, z: 0.82 }, mat.paint);
    hoodScoop.rotation.x = -0.05;
    mesh(reusable.bodyBox, mat.black, { x: 0, y: 2.59, z: 2.72 }, { x: 0.72, y: 0.08, z: 0.12 }, car.root, true, false);

    mesh(reusable.bodyBox, mat.black, { x: 0, y: 1.86, z: 3.58 }, { x: 2.35, y: 0.88, z: 0.16 }, car.root);
    mesh(reusable.bodyBox, mat.chrome, { x: 0, y: 2.19, z: 3.68 }, { x: 2.58, y: 0.16, z: 0.12 }, car.root);
    mesh(reusable.torus, mat.chrome, { x: 0, y: 2.03, z: 3.78 }, { x: 0.26, y: 0.15, z: 0.05 }, car.root);

    for (const x of [-0.88, 0.88]) {
        const lamp = mesh(reusable.bodyBox, mat.light, { x, y: 2.14, z: 3.7 }, { x: 0.82, y: 0.34, z: 0.12 }, car.root);
        lamp.rotation.z = x > 0 ? -0.12 : 0.12;
        mesh(reusable.bodyBox, mat.amber, { x: x * 1.49, y: 2.12, z: 3.71 }, { x: 0.18, y: 0.32, z: 0.13 }, car.root);
        mesh(reusable.cylinder, mat.light, { x: x * 1.17, y: 1.42, z: 3.76 }, { x: 0.22, y: 0.08, z: 0.22 }, car.root);
    }

    for (const x of [-1.66, 1.66]) {
        mesh(reusable.bodyBox, mat.black, { x, y: 1.18, z: 1.83 }, { x: 0.22, y: 0.66, z: 1.52 }, car.root);
        mesh(reusable.bodyBox, mat.black, { x, y: 1.18, z: -2.34 }, { x: 0.22, y: 0.68, z: 1.62 }, car.root);
        mesh(reusable.bodyBox, mat.black, { x, y: 0.82, z: -0.3 }, { x: 0.24, y: 0.22, z: 5.0 }, car.root);
        mesh(reusable.bodyBox, mat.chrome, { x, y: 2.72, z: -0.52 }, { x: 0.16, y: 0.12, z: 4.62 }, car.root);
        mesh(reusable.bodyBox, mat.darkChrome, { x: x * 0.96, y: 3.32, z: -0.52 }, { x: 0.1, y: 0.16, z: 4.55 }, car.root);
    }

    const windshield = mesh(reusable.bodyBox, mat.glass, { x: 0, y: 2.78, z: 1.85 }, { x: 2.24, y: 0.62, z: 0.12 }, car.root);
    windshield.rotation.x = -0.48;
    mesh(reusable.bodyBox, mat.glass, { x: 0, y: 2.66, z: -2.98 }, { x: 2.18, y: 0.74, z: 0.12 }, car.root);

    for (const x of [-1.62, 1.62]) {
        const sideSign = Math.sign(x);
        for (const z of [0.94, -0.28, -1.55]) {
            const win = mesh(reusable.bodyBox, mat.glass, { x, y: 2.68, z }, { x: 0.12, y: 0.72, z: 0.86 }, car.root);
            win.rotation.z = sideSign * 0.02;
        }
        for (const z of [1.03, -0.32, -1.62]) {
            mesh(reusable.bodyBox, mat.chrome, { x: sideSign * 1.68, y: 2.14, z }, { x: 0.1, y: 0.12, z: 0.38 }, car.root);
        }
        const mirror = roundedBox({ x: sideSign * 1.92, y: 2.42, z: 1.94 }, { x: 0.44, y: 0.22, z: 0.52 }, mat.paint);
        mirror.rotation.y = sideSign * 0.18;
    }

    mesh(reusable.bodyBox, mat.paint, { x: 0, y: 1.36, z: 3.58 }, { x: 2.8, y: 0.5, z: 0.38 }, car.root);
    mesh(reusable.bodyBox, mat.chrome, { x: 0, y: 1.05, z: 3.76 }, { x: 2.5, y: 0.2, z: 0.22 }, car.root);
    mesh(reusable.bodyBox, mat.paint, { x: 0, y: 1.42, z: -3.53 }, { x: 2.72, y: 0.54, z: 0.32 }, car.root);

    for (const x of [-1.03, 1.03]) {
        mesh(reusable.bodyBox, mat.red, { x, y: 2.04, z: -3.7 }, { x: 0.58, y: 0.52, z: 0.11 }, car.root);
    }

    car.wheels = [
        createWheel(-1.58, 2.15, true),
        createWheel(1.58, 2.15, true),
        createWheel(-1.58, -2.28),
        createWheel(1.58, -2.28)
    ];
}

function createSkyDetails() {
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.72 });
    for (let i = 0; i < 9; i++) {
        const cloud = new THREE.Group();
        const x = -120 + Math.random() * 240;
        const y = 38 + Math.random() * 28;
        const z = -130 + Math.random() * 260;
        for (let j = 0; j < 4; j++) {
            mesh(
                reusable.sphere,
                cloudMat,
                { x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 5 },
                { x: 4 + Math.random() * 5, y: 1.1 + Math.random(), z: 1.8 + Math.random() * 2.4 },
                cloud,
                false,
                false
            );
        }
        cloud.position.set(x, y, z);
        world.add(cloud);
    }
}

function updateInputVisuals() {
    document.querySelectorAll("[data-control]").forEach((button) => {
        button.classList.toggle("is-active", !!input[button.dataset.control]);
        button.setAttribute("aria-pressed", String(!!input[button.dataset.control]));
    });
}

const keyMap = {
    ArrowUp: "forward", KeyW: "forward",
    ArrowDown: "backward", KeyS: "backward", Space: "backward",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right"
};
function syncInputs() {
    for (const control of Object.keys(input)) {
        input[control] = touch[control] || [...keyboard].some((code) => keyMap[code] === control);
    }
    updateInputVisuals();
}
function formatTime(seconds) {
    if (!seconds) return "0:00";
    const rounded = Math.floor(seconds);
    return Math.floor(rounded / 60) + ":" + String(rounded % 60).padStart(2, "0");
}
function renderStats() {
    ringsEl.textContent = run.rings + " / " + RING_GOAL;
    runTimeEl.textContent = formatTime(run.elapsed);
    bestTimeEl.textContent = run.best ? formatTime(run.best) : "--:--";
    distanceEl.textContent = (car.model.meters / 1609.344).toFixed(1) + " MI";
    progressEl.style.width = Math.min(100, run.rings * 100 / RING_GOAL) + "%";
    if (!run.finished && pickups.length) {
        let closest = null;
        for (const pickup of pickups) {
            const dx = pickup.position.x - car.model.x;
            const dz = pickup.position.z - car.model.z;
            const dist = Math.hypot(dx, dz);
            if (!closest || dist < closest.dist) closest = {dx, dz, dist};
        }
        const angle = relativeTargetBearing(car.heading, closest.dx, closest.dz);
        const direction = Math.abs(angle) > 2.55 ? "↓" :
            angle > 0.6 ? "→" : angle < -0.6 ? "←" : "↑";
        ringGuideEl.textContent = direction + " Nearest ring: " + Math.round(closest.dist) + " m";
    } else {
        ringGuideEl.textContent = "Trail complete!";
    }
    pauseBtn.textContent = run.paused && !run.finished ? "▶" : "Ⅱ";
    pauseBtn.setAttribute("aria-label", run.paused ? "Resume game (P)" : "Pause game (P)");
    document.body.dataset.rings = String(run.rings);
    document.body.dataset.paused = String(run.paused);
    document.body.dataset.camera = String(car.cameraMode);
    document.body.dataset.elapsed = run.elapsed.toFixed(1);
}
function showMessage(text, duration = 1.5) {
    messageEl.textContent = text;
    messageEl.hidden = false;
    run.messageUntil = simTime + duration;
}
function togglePause() {
    if (run.finished) return;
    run.paused = !run.paused;
    if (run.paused) showMessage("PAUSED · Press P or ▶ to resume", Number.POSITIVE_INFINITY);
    else messageEl.hidden = true;
    renderStats();
}
function cycleCamera() {
    car.cameraMode = (car.cameraMode + 1) % 3;
    const labels = ["Chase", "High chase", "Hood"];
    cameraBtn.setAttribute("aria-label", "Change camera (C), current: " + labels[car.cameraMode]);
    cameraBtn.title = "Camera: " + labels[car.cameraMode] + " (C)";
    renderStats();
}
function resetRun() {
    Object.assign(car.model, newVehicleState());
    car.speed = 0;
    car.heading = 0;
    car.steer = 0;
    car.wheelSpin = 0;
    car.cameraMode = 0;
    car.root.position.set(0, 0.1, 0);
    car.root.rotation.set(0, 0, 0);
    camera.position.set(0, 5.6, -10.2);
    run.rings = 0;
    run.elapsed = 0;
    run.started = false;
    run.paused = false;
    run.finished = false;
    messageEl.hidden = true;
    finishOverlay.hidden = true;
    RING_STARTS.forEach(([x, z], index) => pickups[index].position.set(x, 3.2, z));
    keyboard.clear();
    for (const control of Object.keys(touch)) touch[control] = false;
    syncInputs();
    cycleCamera();
    car.cameraMode = 0;
    cameraBtn.setAttribute("aria-label", "Change camera (C), current: Chase");
    renderStats();
    updateVehicle(0);
}
function bindControls() {
    const buttonReleases = new Set();
    const clearHeldControls = () => {
        keyboard.clear();
        for (const control of Object.keys(touch)) touch[control] = false;
        for (const release of buttonReleases) release();
        syncInputs();
    };
    window.addEventListener("keydown", (event) => {
        // Let Space activate focused UI buttons rather than also applying the brake.
        if (event.code === "Space" && event.target?.closest?.("button")) return;
        if (event.code === "KeyC" || event.code === "KeyP" || event.code === "KeyR") {
            event.preventDefault();
            if (event.repeat) return;
            if (event.code === "KeyC") cycleCamera();
            if (event.code === "KeyP") togglePause();
            if (event.code === "KeyR") resetRun();
            return;
        }
        if (!Object.hasOwn(keyMap, event.code)) return;
        keyboard.add(event.code);
        syncInputs();
        event.preventDefault();
    });
    window.addEventListener("keyup", (event) => {
        if (!Object.hasOwn(keyMap, event.code)) return;
        keyboard.delete(event.code);
        syncInputs();
        if (!(event.code === "Space" && event.target?.closest?.("button"))) event.preventDefault();
    });
    window.addEventListener("blur", clearHeldControls);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            clearHeldControls();
            if (!run.paused && !run.finished) togglePause();
        }
        lastFrameTime = performance.now();
    });
    document.querySelectorAll("[data-control]").forEach((button) => {
        const control = button.dataset.control;
        const pointers = new Set();
        let downAt = 0;
        let releaseTimer = 0;
        const MIN_TAP_MS = 170;
        function release() {
            clearTimeout(releaseTimer);
            releaseTimer = 0;
            pointers.clear();
            touch[control] = false;
            syncInputs();
        }
        buttonReleases.add(release);
        button.addEventListener("contextmenu", (event) => event.preventDefault());
        button.addEventListener("pointerdown", (event) => {
            if (run.finished || run.paused || (event.pointerType === "mouse" && event.button !== 0)) return;
            clearTimeout(releaseTimer);
            releaseTimer = 0;
            downAt = performance.now();
            pointers.add(event.pointerId);
            touch[control] = true;
            try { button.setPointerCapture(event.pointerId); } catch {}
            syncInputs();
            event.preventDefault();
        });
        button.addEventListener("pointerup", (event) => {
            if (!pointers.has(event.pointerId)) return;
            pointers.delete(event.pointerId);
            if (pointers.size) return;
            // A short mouse click or screen tap should produce a useful nudge.
            const remaining = Math.max(0, MIN_TAP_MS - (performance.now() - downAt));
            releaseTimer = window.setTimeout(release, remaining);
        });
        button.addEventListener("pointercancel", release);
        button.addEventListener("lostpointercapture", (event) => {
            // pointerup triggers lostcapture too; don't cancel the brief tap nudge.
            if (!pointers.has(event.pointerId)) return;
            pointers.delete(event.pointerId);
            if (!pointers.size) release();
        });
        button.addEventListener("click", (event) => {
            // Native keyboard button activation has detail 0.
            if (event.detail !== 0 || run.finished || run.paused) return;
            clearTimeout(releaseTimer);
            touch[control] = true;
            syncInputs();
            releaseTimer = window.setTimeout(release, MIN_TAP_MS);
        });
    });
    cameraBtn.addEventListener("click", cycleCamera);
    pauseBtn.addEventListener("click", () => { clearHeldControls(); togglePause(); });
    restartBtn.addEventListener("click", () => { clearHeldControls(); resetRun(); });
    playAgainBtn.addEventListener("click", resetRun);
}

function createPickups() {
    for (const [index, coords] of RING_STARTS.entries()) {
        const ring = mesh(reusable.torus, mat.gold,
            { x: coords[0], y: 3.2, z: coords[1] },
            { x: 1.85, y: 1.85, z: 1.85 }, world, false, false);
        ring.userData.phase = index * 0.67;
        pickups.push(ring);
    }
}
function finishRun() {
    run.finished = true;
    run.paused = true;
    if (!run.best || run.elapsed < run.best) {
        run.best = run.elapsed;
        try { localStorage.setItem("4runner-trail-best", String(run.best)); } catch {}
    }
    finishSummary.textContent = "Your time: " + formatTime(run.elapsed) + " · Distance: " +
        (car.model.meters / 1609.344).toFixed(2) + " miles. Best: " + formatTime(run.best) + ".";
    finishOverlay.hidden = false;
    renderStats();
    playAgainBtn.focus();
}
function updatePickups(dt) {
    for (const pickup of pickups) {
        pickup.rotation.y += dt * 1.2;
        pickup.position.y = 3.2 + Math.sin(simTime * 2.1 + pickup.userData.phase) * 0.32;
        if (!run.started || run.finished) continue;
        const dx = pickup.position.x - car.model.x;
        const dz = pickup.position.z - car.model.z;
        if (dx * dx + dz * dz > 19) continue;
        run.rings += 1;
        renderStats();
        if (run.rings >= RING_GOAL) {
            finishRun();
            break;
        }
        showMessage("RING COLLECTED · " + run.rings + " / " + RING_GOAL);
        // Respawn far from the car, but inside the explorable desert.
        let x, z, attempts = 0;
        do {
            x = (Math.random() - 0.5) * 175;
            z = (Math.random() - 0.5) * 425;
            attempts++;
        } while (attempts < 15 && Math.hypot(x - car.model.x, z - car.model.z) < 30);
        pickup.position.set(x, 3.2, z);
    }
}

function updateVehicle(dt) {
    if (demoMode) {
        input.forward = true;
        input.backward = false;
        input.left = Math.sin(simTime * 0.55) > 0.35;
        input.right = Math.sin(simTime * 0.55) < -0.35;
    }
    stepVehicle(car.model, input, dt);
    const beforeWrap = car.model.z;
    car.model.z = wrapCoordinate(car.model.z, WORLD_HALF_LENGTH);
    if (car.model.z !== beforeWrap) camera.position.z += car.model.z - beforeWrap;

    car.speed = car.model.speed;
    car.heading = car.model.heading;
    car.steer = car.model.steer;
    const shoulder = isOffroad(car.model.x);
    if (Math.abs(car.speed) > 0.2) run.started = true;
    if (run.started) run.elapsed += dt;

    const roughness = shoulder ? 2.2 : 0.42;
    car.suspension += dt * (4.5 + Math.abs(car.speed) * 0.13);
    const bounce = Math.sin(car.suspension * 5.4) * roughness * Math.min(Math.abs(car.speed) / 32, 1) * 0.035;
    const terrainY = terrainHeight(car.model.x, car.model.z) + 0.8;
    const desiredY = shoulder ? terrainY : 0.1;
    const nextY = THREE.MathUtils.lerp(car.root.position.y, desiredY, Math.min(1, dt * 7));
    car.root.position.set(car.model.x, nextY + bounce, car.model.z);
    car.root.rotation.y = car.heading;
    car.root.rotation.z = THREE.MathUtils.lerp(car.root.rotation.z,
        -car.steer * Math.min(Math.abs(car.speed) / 32, 1) * 0.08, Math.min(1, dt * 9));
    car.root.rotation.x = THREE.MathUtils.lerp(car.root.rotation.x,
        -Math.sign(car.speed) * Math.min(Math.abs(car.speed) / 45, 1) * 0.035, Math.min(1, dt * 7));
    car.wheelSpin += wheelRotationDelta(car.speed, dt);
    for (const wheel of car.wheels) {
        wheel.rolling.rotation.x = car.wheelSpin;
        wheel.pivot.rotation.y = wheel.front ? frontWheelYaw(car.steer) : 0;
    }
    terrainModeEl.textContent = shoulder ? "DIRT" : "ROAD";
    speedEl.textContent = Math.round(Math.abs(car.speed) * MPS_TO_MPH);
    driveModeEl.textContent = car.speed < -0.2 ? "R" : (input.backward && car.speed > 0.2 ? "B" : "D");
    document.body.dataset.speed = speedEl.textContent;
    document.body.dataset.mode = terrainModeEl.textContent;
    document.body.dataset.x = car.model.x.toFixed(2);
    document.body.dataset.z = car.model.z.toFixed(2);
    document.body.dataset.heading = car.heading.toFixed(3);
    renderStats();
}

function markRenderProbe() {
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    const x = Math.max(0, Math.floor(renderer.domElement.width * 0.5));
    const y = Math.max(0, Math.floor(renderer.domElement.height * 0.5));
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const brightness = pixel[0] + pixel[1] + pixel[2];
    document.body.dataset.render = brightness > 12 ? "painted" : "dark";
    document.body.dataset.pixel = Array.from(pixel).join(",");
}

function updateCamera(dt) {
    const carPos = car.root.position;
    const heading = car.heading;
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    let desired;
    let target;
    if (car.cameraMode === 1) {
        // Always remain behind the car so left/right never invert between views.
        desired = carPos.clone().addScaledVector(forward, -16).add(new THREE.Vector3(0, 12, 0));
        target = carPos.clone().addScaledVector(forward, 15).add(new THREE.Vector3(0, 1.3, 0));
    } else if (car.cameraMode === 2) {
        desired = carPos.clone().addScaledVector(forward, 1.15).add(new THREE.Vector3(0, 3.5, 0));
        target = carPos.clone().addScaledVector(forward, 27).add(new THREE.Vector3(0, 2.25, 0));
    } else {
        desired = carPos.clone().addScaledVector(forward, -11).add(new THREE.Vector3(0, 6.4, 0));
        target = carPos.clone().addScaledVector(forward, 9).add(new THREE.Vector3(0, 1.4, 0));
    }
    camera.position.lerp(desired, 1 - Math.exp(-6 * Math.max(0, dt)));
    camera.lookAt(target);
}

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function animate(now = performance.now()) {
    const dt = Math.min(Math.max((now - lastFrameTime) / 1000, 0), 0.05);
    lastFrameTime = now;
    tick(dt);
    requestAnimationFrame(animate);
}

function tick(dt) {
    simTime += dt;
    if (!run.paused && !run.finished) {
        updateVehicle(dt);
        updatePickups(dt);
    }
    if (!run.paused && !messageEl.hidden && simTime >= run.messageUntil) {
        messageEl.hidden = true;
    }
    updateCamera(dt);
    renderer.render(scene, camera);
}

createLights();
createTerrain();
createRoad();
create4Runner();
createSkyDetails();
createPickups();
bindControls();
updateInputVisuals();
updateVehicle(0);
updateCamera(1);
renderer.render(scene, camera);
markRenderProbe();

window.addEventListener("resize", resize);
requestAnimationFrame(animate);
