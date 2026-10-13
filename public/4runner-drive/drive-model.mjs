// Framework-independent vehicle physics. Distances are meters, speeds are m/s.
export const ROAD_HALF_WIDTH = 8;
export const WORLD_HALF_WIDTH = 190;
export const WORLD_HALF_LENGTH = 242;
export const MPS_TO_MPH = 2.2369362921;
// Four-wheel mesh radius in world units; one positive rotation rolls the car toward +Z.
export const WHEEL_RADIUS = 1.02;
export const MAX_WHEEL_STEER_ANGLE = 0.48;

// The 4Runner mesh points toward +Z. With an upright chase camera behind it,
// the driver's right is world -X (not +X). Positive input steer means right.
export function frontWheelYaw(steer) {
    const amount = Math.max(-1, Math.min(1, steer));
    return amount === 0 ? 0 : -amount * MAX_WHEEL_STEER_ANGLE;
}
export function wheelRotationDelta(speed, dt) {
    return speed * dt / WHEEL_RADIUS;
}
// Positive values point toward the driver's right in a chase-camera view.
export function relativeTargetBearing(heading, deltaX, deltaZ) {
    return Math.atan2(Math.sin(heading - Math.atan2(deltaX, deltaZ)),
                      Math.cos(heading - Math.atan2(deltaX, deltaZ)));
}
export const MAX_FORWARD_SPEED = 43;
export const MAX_REVERSE_SPEED = 10;

export function newVehicleState() {
    return { x: 0, z: 0, heading: 0, speed: 0, steer: 0, meters: 0 };
}

export function isOffroad(x) {
    return Math.abs(x) > ROAD_HALF_WIDTH;
}

export function wrapCoordinate(value, limit = WORLD_HALF_LENGTH) {
    if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return 0;
    const width = limit * 2;
    return ((((value + limit) % width) + width) % width) - limit;
}

// The two pedals oppose each other. Braking must finish before direction reverses.
// Steering is signed right-positive from the driver's/chase-camera perspective.
export function stepVehicle(state, controls, seconds) {
    const dt = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, 0), 0.05);
    if (dt === 0) return state;
    const gas = !!controls.forward && !controls.backward;
    const brake = !!controls.backward && !controls.forward;
    const offroad = isOffroad(state.x);

    if (gas) {
        state.speed += (state.speed < -0.3 ? 32 : offroad ? 13 : 19) * dt;
    } else if (brake) {
        state.speed -= (state.speed > 0.3 ? 34 : 12) * dt;
    } else {
        const resistance = (offroad ? 7 : 3.5) + Math.abs(state.speed) * (offroad ? 0.085 : 0.045);
        const reduction = resistance * dt;
        state.speed = Math.abs(state.speed) <= reduction ? 0 : state.speed - Math.sign(state.speed) * reduction;
    }

    // No magic jump across zero: a pedal changes direction only after stopping.
    if (Math.abs(state.speed) < 0.2 && !gas && !brake) state.speed = 0;
    const maxForward = offroad ? 25 : MAX_FORWARD_SPEED;
    if (state.speed > maxForward) state.speed = Math.max(maxForward, state.speed - 24 * dt);
    state.speed = Math.max(-MAX_REVERSE_SPEED, Math.min(MAX_FORWARD_SPEED, state.speed));

    const requestedSteer = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
    state.steer += (requestedSteer - state.steer) * (1 - Math.exp(-9 * dt));
    const turnRate = Math.min(Math.abs(state.speed) / 17, 1.1);
    if (Math.abs(state.speed) > 0.05) {
        state.heading -= state.steer * turnRate * dt * Math.sign(state.speed) * 0.88;
        state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));
    }

    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += Math.cos(state.heading) * state.speed * dt;
    state.x = Math.max(-WORLD_HALF_WIDTH, Math.min(WORLD_HALF_WIDTH, state.x));
    state.meters += Math.abs(state.speed) * dt;
    return state;
}
