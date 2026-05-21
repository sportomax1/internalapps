import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const canvas = document.querySelector("#scene");
const speedEl = document.querySelector("#speed");
const driveModeEl = document.querySelector("#driveMode");
const terrainModeEl = document.querySelector("#terrainMode");
const cameraBtn = document.querySelector("#cameraBtn");
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
    cameraMode: 0
};

const road = {
    width: 16,
    segmentLength: 28,
    count: 34,
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
    stone: new THREE.MeshStandardMaterial({ color: 0xaa7652, roughness: 0.95 })
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
        const z = i * road.segmentLength - (road.count * road.segmentLength) / 2;
        mesh(reusable.bodyBox, mat.road, { x: 0, y: 0.015, z }, { x: road.width, y: 0.04, z: road.segmentLength + 0.04 }, world, false, true);
        mesh(reusable.bodyBox, mat.roadSide, { x: -road.width * 0.62, y: 0.02, z }, { x: 1.8, y: 0.035, z: road.segmentLength + 0.04 }, world, false, true);
        mesh(reusable.bodyBox, mat.roadSide, { x: road.width * 0.62, y: 0.02, z }, { x: 1.8, y: 0.035, z: road.segmentLength + 0.04 }, world, false, true);
    }

    for (let i = 0; i < 48; i++) {
        const z = i * 18 - 430;
        mesh(reusable.bodyBox, mat.stripe, { x: 0, y: 0.06, z }, { x: 0.34, y: 0.04, z: 8.5 }, world, false, true);
        mesh(reusable.bodyBox, mat.whiteStripe, { x: -road.width * 0.46, y: 0.065, z }, { x: 0.22, y: 0.04, z: 11 }, world, false, true);
        mesh(reusable.bodyBox, mat.whiteStripe, { x: road.width * 0.46, y: 0.065, z }, { x: 0.22, y: 0.04, z: 11 }, world, false, true);
    }
}

function createWheel(x, z, front = false) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.82, z);
    car.root.add(pivot);

    const wheel = new THREE.Group();
    wheel.rotation.z = Math.PI / 2;
    pivot.add(wheel);

    const tire = new THREE.Mesh(reusable.tire, mat.rubber);
    tire.castShadow = true;
    tire.receiveShadow = true;
    wheel.add(tire);

    const rim = new THREE.Mesh(reusable.rim, mat.chrome);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(0.58, 0.58, 0.5);
    rim.castShadow = true;
    wheel.add(rim);

    for (let i = 0; i < 6; i++) {
        const spoke = mesh(
            reusable.bodyBox,
            mat.chrome,
            { x: 0, y: 0.02, z: 0 },
            { x: 0.12, y: 0.09, z: 0.96 },
            wheel,
            true,
            false
        );
        spoke.rotation.y = (i / 6) * Math.PI * 2;
    }

    return { pivot, wheel, front };
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
        button.classList.toggle("is-active", input[button.dataset.control]);
    });
}

function bindControls() {
    const keyMap = {
        ArrowUp: "forward",
        KeyW: "forward",
        ArrowDown: "backward",
        KeyS: "backward",
        ArrowLeft: "left",
        KeyA: "left",
        ArrowRight: "right",
        KeyD: "right"
    };

    window.addEventListener("keydown", (event) => {
        const control = keyMap[event.code];
        if (!control) return;
        if (!input[control]) {
            if (control === "forward") car.speed = Math.min(car.speed + 5, 48);
            if (control === "backward") car.speed = Math.max(car.speed - 5, -16);
            if (control === "left") car.steer = Math.min(car.steer + 0.25, 1);
            if (control === "right") car.steer = Math.max(car.steer - 0.25, -1);
        }
        input[control] = true;
        updateInputVisuals();
        event.preventDefault();
    });

    window.addEventListener("keyup", (event) => {
        const control = keyMap[event.code];
        if (!control) return;
        input[control] = false;
        updateInputVisuals();
        event.preventDefault();
    });

    document.querySelectorAll("[data-control]").forEach((button) => {
        const control = button.dataset.control;
        let pulseTimer = 0;
        const activate = (event) => {
            input[control] = true;
            updateInputVisuals();
            button.setPointerCapture?.(event.pointerId);
        };
        const release = () => {
            input[control] = false;
            updateInputVisuals();
        };
        button.addEventListener("pointerdown", activate);
        button.addEventListener("pointerup", release);
        button.addEventListener("pointercancel", release);
        button.addEventListener("pointerleave", release);
        button.addEventListener("click", () => {
            window.clearTimeout(pulseTimer);
            if (control === "forward") car.speed = Math.min(car.speed + 8, 48);
            if (control === "backward") car.speed = Math.max(car.speed - 7, -16);
            if (control === "left") car.steer = Math.min(car.steer + 0.35, 1);
            if (control === "right") car.steer = Math.max(car.steer - 0.35, -1);
            input[control] = true;
            updateInputVisuals();
            pulseTimer = window.setTimeout(() => {
                input[control] = false;
                updateInputVisuals();
            }, 220);
        });
    });

    cameraBtn.addEventListener("click", () => {
        car.cameraMode = (car.cameraMode + 1) % 3;
    });
}

function wrapWorld() {
    const limit = road.count * road.segmentLength * 0.48;
    if (car.root.position.z > limit) {
        car.root.position.z -= limit * 2;
    }
    if (car.root.position.z < -limit) {
        car.root.position.z += limit * 2;
    }
}

function updateVehicle(dt) {
    if (demoMode) {
        input.forward = true;
        input.backward = false;
        input.left = Math.sin(simTime * 0.55) > 0.35;
        input.right = Math.sin(simTime * 0.55) < -0.35;
        updateInputVisuals();
    }

    const accel = input.forward ? 19 : 0;
    const brake = input.backward ? 24 : 0;
    const drag = 3.1 + Math.abs(car.speed) * 0.045;
    const direction = Math.sign(car.speed || 1);

    car.speed += accel * dt;
    if (input.backward) car.speed -= brake * dt;
    if (!input.forward && !input.backward) {
        const drop = drag * dt;
        if (Math.abs(car.speed) <= drop) car.speed = 0;
        else car.speed -= direction * drop;
    }

    car.speed = THREE.MathUtils.clamp(car.speed, -16, 48);

    const steerTarget = (input.left ? 1 : 0) + (input.right ? -1 : 0);
    car.steer = THREE.MathUtils.lerp(car.steer, steerTarget, 1 - Math.pow(0.001, dt));
    const steerStrength = THREE.MathUtils.clamp(Math.abs(car.speed) / 17, 0.18, 1.25);
    car.heading += car.steer * steerStrength * dt * (car.speed >= 0 ? 1 : -1);

    const forward = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
    car.root.position.addScaledVector(forward, car.speed * dt);
    car.root.position.x = THREE.MathUtils.clamp(car.root.position.x, -6.35, 6.35);

    const shoulder = Math.abs(car.root.position.x) > 5.4;
    const roughness = shoulder ? 1.65 : 0.42;
    car.suspension += dt * (4.5 + Math.abs(car.speed) * 0.13);
    const bounce = Math.sin(car.suspension * 5.4) * roughness * Math.min(Math.abs(car.speed) / 32, 1) * 0.035;
    car.root.position.y = 0.1 + bounce;
    car.root.rotation.y = car.heading;
    car.root.rotation.z = THREE.MathUtils.lerp(car.root.rotation.z, car.steer * Math.min(Math.abs(car.speed) / 32, 1) * 0.08, 0.11);
    car.root.rotation.x = THREE.MathUtils.lerp(car.root.rotation.x, -Math.sign(car.speed) * Math.min(Math.abs(car.speed) / 45, 1) * 0.035, 0.06);

    car.wheelSpin += car.speed * dt * 1.55;
    for (const wheel of car.wheels) {
        wheel.wheel.rotation.x = car.wheelSpin;
        wheel.pivot.rotation.y = wheel.front ? -car.steer * 0.48 : 0;
    }

    terrainModeEl.textContent = shoulder ? "DIRT" : "ROAD";
    speedEl.textContent = Math.round(Math.abs(car.speed) * 1.68);
    driveModeEl.textContent = car.speed < -1 ? "R" : "D";
    document.body.dataset.speed = speedEl.textContent;
    document.body.dataset.mode = terrainModeEl.textContent;
    document.body.dataset.x = car.root.position.x.toFixed(2);
    document.body.dataset.z = car.root.position.z.toFixed(2);
    document.body.dataset.heading = car.heading.toFixed(3);
    wrapWorld();
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
    const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));

    let desired;
    let target;
    if (car.cameraMode === 1) {
        desired = carPos.clone()
            .addScaledVector(forward, 8.5)
            .addScaledVector(right, 5.7)
            .add(new THREE.Vector3(0, 4.1, 0));
        target = carPos.clone().add(new THREE.Vector3(0, 1.6, 0));
    } else if (car.cameraMode === 2) {
        desired = carPos.clone()
            .addScaledVector(forward, -2.3)
            .add(new THREE.Vector3(0, 3.15, 0));
        target = carPos.clone().addScaledVector(forward, 22).add(new THREE.Vector3(0, 1.7, 0));
    } else {
        desired = carPos.clone()
            .addScaledVector(forward, -10.2)
            .add(new THREE.Vector3(0, 5.6, 0));
        target = carPos.clone().addScaledVector(forward, 8).add(new THREE.Vector3(0, 1.5, 0));
    }

    camera.position.lerp(desired, 1 - Math.pow(0.0006, dt));
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
    const dt = Math.min((now - lastFrameTime) / 1000, 0.033);
    lastFrameTime = now;
    tick(dt);
    requestAnimationFrame(animate);
}

function tick(dt) {
    simTime += dt;
    updateVehicle(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
}

createLights();
createTerrain();
createRoad();
create4Runner();
createSkyDetails();
bindControls();
updateInputVisuals();
updateCamera(1);
renderer.render(scene, camera);
markRenderProbe();

window.addEventListener("resize", resize);
animate();
window.setInterval(() => {
    const now = performance.now();
    if (now - lastFrameTime > 90) {
        lastFrameTime = now;
        tick(1 / 30);
    }
}, 80);
