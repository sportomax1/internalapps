import test from "node:test";
import assert from "node:assert/strict";
import {
    newVehicleState, stepVehicle, isOffroad, wrapCoordinate, WORLD_HALF_LENGTH,
    WORLD_HALF_WIDTH, ROAD_HALF_WIDTH, MAX_FORWARD_SPEED, MAX_REVERSE_SPEED, MPS_TO_MPH,
    WHEEL_RADIUS, MAX_WHEEL_STEER_ANGLE, frontWheelYaw, wheelRotationDelta, relativeTargetBearing
} from "./drive-model.mjs";

const noInput = { forward: false, backward: false, left: false, right: false };
const drive = (state, input, time, dt = 1 / 60) => {
    for (let n = 0; n < Math.round(time / dt); n++) stepVehicle(state, input, dt);
    return state;
};

test("accelerates from rest, reports physical MPH, and obeys top speed", () => {
    const v = drive(newVehicleState(), { forward: true }, 15);
    assert.ok(v.speed > 35 && v.speed <= MAX_FORWARD_SPEED);
    assert.ok(v.z > 0 && v.meters > 0);
    assert.ok(Math.abs(MPS_TO_MPH - 2.2369362921) < 1e-8);
});
test("releasing throttle rolls to a halt without reversing", () => {
    const v = drive(newVehicleState(), { forward: true }, 2);
    drive(v, noInput, 15);
    assert.equal(v.speed, 0);
});
test("braking slows forward movement before going into reverse", () => {
    const v = drive(newVehicleState(), { forward: true }, 2);
    const start = v.speed;
    drive(v, { backward: true }, 0.2);
    assert.ok(v.speed < start && v.speed > 0);
    drive(v, { backward: true }, 5);
    assert.ok(v.speed < 0 && v.speed >= -MAX_REVERSE_SPEED);
});
test("accelerating in reverse brakes before going forward", () => {
    const v = drive(newVehicleState(), { backward: true }, 1);
    assert.ok(v.speed < 0);
    drive(v, { forward: true }, 0.1);
    assert.ok(v.speed < 0);
    drive(v, { forward: true }, 5);
    assert.ok(v.speed > 0);
});
test("screen-left points +X, screen-right points -X for the chase camera", () => {
    const l = drive(newVehicleState(), { forward: true, left: true }, 1.5);
    const r = drive(newVehicleState(), { forward: true, right: true }, 1.5);
    assert.ok(l.x > 0.2, `left x=${l.x}`);
    assert.ok(r.x < -0.2, `right x=${r.x}`);
});
test("opposing steering inputs cancel and travel remains straight", () => {
    const v = drive(newVehicleState(), { forward: true, left: true, right: true }, 2);
    assert.ok(Math.abs(v.x) < 1e-8);
});
test("holding both pedals does not accelerate", () => {
    const v = drive(newVehicleState(), { forward: true, backward: true }, 3);
    assert.equal(v.speed, 0);
});
test("turning while stationary does not spin the car", () => {
    const v = drive(newVehicleState(), { left: true }, 2);
    assert.equal(v.heading, 0);
});
test("dirt slows vehicle and stays drivable", () => {
    const v = newVehicleState();
    v.x = ROAD_HALF_WIDTH + 1;
    drive(v, { forward: true }, 10);
    assert.ok(v.speed <= 25 && v.speed > 5);
    assert.equal(isOffroad(v.x), true);
    assert.equal(isOffroad(0), false);
});
test("terrain allows driving away from road while respecting distant world boundary", () => {
    const v = newVehicleState();
    v.x = WORLD_HALF_WIDTH - 0.1;
    v.heading = Math.PI / 2;
    drive(v, { forward: true }, 3);
    assert.ok(v.x <= WORLD_HALF_WIDTH);
    assert.ok(v.x > ROAD_HALF_WIDTH);
});
test("wrapCoordinate is stable across both directions and huge values", () => {
    assert.equal(wrapCoordinate(WORLD_HALF_LENGTH + 4), -WORLD_HALF_LENGTH + 4);
    assert.equal(wrapCoordinate(-WORLD_HALF_LENGTH - 4), WORLD_HALF_LENGTH - 4);
    assert.equal(wrapCoordinate(0), 0);
    assert.equal(wrapCoordinate(Infinity), 0);
    assert.ok(Math.abs(wrapCoordinate(999999999)) <= WORLD_HALF_LENGTH);
});
test("frame timing is clamped to prevent tab-throttling speed bursts", () => {
    const v = stepVehicle(newVehicleState(), { forward: true }, 90);
    assert.ok(v.speed < 2);
    assert.ok(v.z < 1);
});
test("no input and invalid deltas do not produce NaN", () => {
    const v = newVehicleState();
    stepVehicle(v, noInput, -3);
    stepVehicle(v, noInput, NaN);
    assert.equal(v.meters, 0);
    for (const n of Object.values(v)) assert.ok(Number.isFinite(n));
});

test("front wheel yaw points in the same screen direction as steering", () => {
    assert.equal(frontWheelYaw(0), 0);
    assert.equal(frontWheelYaw(1), -MAX_WHEEL_STEER_ANGLE);
    assert.equal(frontWheelYaw(-1), MAX_WHEEL_STEER_ANGLE);
    assert.equal(frontWheelYaw(99), -MAX_WHEEL_STEER_ANGLE);
});
test("wheel rotation sign matches forward and reverse motion", () => {
    assert.equal(wheelRotationDelta(0, 1), 0);
    assert.ok(wheelRotationDelta(12, 1 / 60) > 0);
    assert.ok(wheelRotationDelta(-12, 1 / 60) < 0);
    assert.ok(Math.abs(wheelRotationDelta(WHEEL_RADIUS, 1) - 1) < 1e-10);
});
test("target bearing matches actual screen-left and screen-right", () => {
    assert.ok(relativeTargetBearing(0, -10, 10) > 0.1);
    assert.ok(relativeTargetBearing(0, 10, 10) < -0.1);
    assert.ok(Math.abs(relativeTargetBearing(0, 0, 10)) < 1e-10);
    assert.ok(Math.abs(relativeTargetBearing(Math.PI / 2, 10, 0)) < 1e-10);
});
test("reverse with right steering swings nose left rather than right", () => {
    const v = newVehicleState();
    v.speed = -5;
    drive(v, { right: true }, 0.6);
    assert.ok(v.heading > 0, `reverse heading=${v.heading}`);
});
test("repeatable straight drive and neutral steering recenter smoothly", () => {
    const v = drive(newVehicleState(), {forward: true, right:true}, 0.6);
    assert.ok(v.steer > 0.9);
    drive(v, {forward: true}, 1);
    assert.ok(Math.abs(v.steer) < 0.01);
});
