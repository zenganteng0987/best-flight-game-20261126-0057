// The flight model and the sortie's rules, with no drawing and no browser in it:
// the plane's position, speed, pitch and bank, throttle and fuel, ring passes,
// touchdowns and crashes. step() advances one fixed step and returns what happened
// as bit flags, so the caller can react without the world knowing about screens
// or sound.
//
// Controls each step: { pitch: -1..1 (down..up), roll: -1..1 (left..right),
// throttle: 0..1, gear: boolean (true = down) }.

import { PLANE, RING_RADIUS } from './config.js';
import { onRunway, terrainHeight, wrapAngle } from './terrain.js';

export const EVENT_RING = 1;
export const EVENT_RING_MISSED = 2;
export const EVENT_TOUCHDOWN = 4;
export const EVENT_LANDED = 8;
export const EVENT_CRASH = 16;
export const EVENT_FUEL_EMPTY = 32;
export const EVENT_COMPLETE = 64;

const G = 9.81;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The unit normal of a ring: the direction the course runs through it. */
function ringNormal(rings, index) {
  const ring = rings[index];
  const prev = index === 0 ? { x: 0, y: 120, z: -400 } : rings[index - 1];
  const dx = ring.x - prev.x;
  const dy = ring.y - prev.y;
  const dz = ring.z - prev.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

export function createFlight(mission) {
  const rings = mission.rings.map((r) => ({ ...r, r: RING_RADIUS, normal: null }));
  for (let i = 0; i < rings.length; i += 1) rings[i].normal = ringNormal(mission.rings, i);

  const state = {
    x: 0,
    y: 0,
    z: -350,
    heading: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    verticalSpeed: 0,
    throttle: 0,
    fuel: mission.fuel,
    damage: 0,
    gearDown: true,
    airborne: false,
    stalled: false,
    ringIndex: 0,
    ringsPassed: 0,
    ringsMissed: 0,
    lastRingAccuracy: 0,
    lastRingBonus: 0,
    time: 0,
    status: 'flying',
    crashReason: '',
    touchdownSink: 0,
    touchdownSpeed: 0,
    approachIndex: 0,
    rings,
  };

  function reset() {
    state.x = 0;
    state.y = terrainHeight(0, -350);
    state.z = -350;
    state.heading = 0;
    state.pitch = 0;
    state.roll = 0;
    state.speed = 0;
    state.verticalSpeed = 0;
    state.throttle = 0;
    state.fuel = mission.fuel;
    state.damage = 0;
    state.gearDown = true;
    state.airborne = false;
    state.stalled = false;
    state.ringIndex = 0;
    state.ringsPassed = 0;
    state.ringsMissed = 0;
    state.lastRingAccuracy = 0;
    state.lastRingBonus = 0;
    state.time = 0;
    state.status = 'flying';
    state.crashReason = '';
    state.touchdownSink = 0;
    state.touchdownSpeed = 0;
    state.approachIndex = 0;
  }

  function crash(reason) {
    state.status = 'crashed';
    state.crashReason = reason;
    state.damage = 100;
    return EVENT_CRASH;
  }

  /** Distance from the plane to the current ring's centre, in metres. */
  function ringDistance() {
    const ring = rings[state.ringIndex];
    if (!ring) return Infinity;
    return Math.hypot(state.x - ring.x, state.y - ring.y, state.z - ring.z);
  }

  function checkRing() {
    const ring = rings[state.ringIndex];
    if (!ring) return 0;
    const dist = ringDistance();
    if (dist < ring.r) {
      const accuracy = clamp(1 - dist / ring.r, 0, 1);
      state.lastRingAccuracy = accuracy;
      state.lastRingBonus = Math.round(accuracy * 50);
      state.ringsPassed += 1;
      state.ringIndex += 1;
      let events = EVENT_RING;
      if (state.ringIndex >= rings.length && !mission.requiresLanding) {
        state.status = 'complete';
        events |= EVENT_COMPLETE;
      }
      return events;
    }
    // Flew past the ring's plane without going through it: it counts as missed.
    const n = ring.normal;
    const along = (state.x - ring.x) * n.x + (state.y - ring.y) * n.y + (state.z - ring.z) * n.z;
    if (along > ring.r * 1.5 && dist > ring.r * 2) {
      state.ringsMissed += 1;
      state.ringIndex += 1;
      let events = EVENT_RING_MISSED;
      if (state.ringIndex >= rings.length && !mission.requiresLanding) {
        state.status = 'complete';
        events |= EVENT_COMPLETE;
      }
      return events;
    }
    return 0;
  }

  /**
   * One fixed step. `controls` is { pitch, roll, throttle, gear } as described
   * above. Returns EVENT_* flags for what happened this step.
   */
  function step(dt, controls) {
    if (state.status !== 'flying') return 0;
    let events = 0;
    state.time += dt;

    // Throttle and fuel: an empty tank means gliding, not thrust.
    const hadFuel = state.fuel > 0;
    state.throttle = clamp(controls.throttle, 0, 1);
    if (!hadFuel) state.throttle = 0;
    state.fuel = Math.max(0, state.fuel - (PLANE.fuelIdle + state.throttle * PLANE.fuelFull) * dt);
    if (hadFuel && state.fuel === 0) events |= EVENT_FUEL_EMPTY;
    state.gearDown = controls.gear;

    // Stick: the stick is a position, not a rate — full stick holds full bank or
    // pitch, and letting go eases the wings and the nose back to level. The
    // stick chases its target at the pitch/roll rate, so a held stick banks
    // smoothly and a released one levels the plane.
    const pitchTarget = controls.pitch * PLANE.maxPitch;
    state.pitch += clamp(pitchTarget - state.pitch, -PLANE.pitchRate * dt, PLANE.pitchRate * dt);
    const rollTarget = controls.roll * PLANE.maxRoll;
    state.roll += clamp(rollTarget - state.roll, -PLANE.rollRate * dt, PLANE.rollRate * dt);

    // Speed: throttle sets the target, climbing bleeds it, diving gains it.
    const targetSpeed = PLANE.idleSpeed + state.throttle * (PLANE.fullSpeed - PLANE.idleSpeed);
    state.speed += (targetSpeed - state.speed) * PLANE.speedResponse * dt;
    state.speed -= Math.sin(state.pitch) * PLANE.climbPenalty * dt;
    state.speed = clamp(state.speed, PLANE.minSpeed, PLANE.maxSpeed);

    // Stall: below the stall speed the nose drops and the plane sinks.
    state.stalled = state.speed < PLANE.stallSpeed && state.airborne;
    if (state.stalled) state.pitch = Math.max(state.pitch - 0.3 * dt, -0.3);

    // Turn: banked lift turns the nose, faster when slow.
    const turnRate = (G * Math.tan(state.roll)) / Math.max(state.speed, 18);
    state.heading += turnRate * dt;

    // Move.
    const vs = state.speed * Math.sin(state.pitch) + (state.stalled ? -6 : 0);
    const hs = state.speed * Math.cos(state.pitch);
    state.verticalSpeed = vs;
    state.x += Math.sin(state.heading) * hs * dt;
    state.z += Math.cos(state.heading) * hs * dt;
    state.y += vs * dt;

    const ground = terrainHeight(state.x, state.z);

    if (!state.airborne) {
      // Rolling on the runway: stay on the ground, lift off at rotate speed.
      state.y = ground;
      state.verticalSpeed = 0;
      // Rolling drag: a gentle drag at power, hard braking with the throttle cut.
      state.speed = Math.max(0, state.speed - (state.throttle > 0.1 ? 1.5 : PLANE.brake) * dt);
      if (state.speed >= PLANE.rotateSpeed && state.pitch > 0.04) {
        state.airborne = true;
      } else if (state.speed < 4 && state.time > 2 && state.status === 'flying' && mission.requiresLanding && state.ringIndex >= rings.length) {
        state.status = 'complete';
        events |= EVENT_LANDED | EVENT_COMPLETE;
      }
      return events;
    }

    // Airborne: the ground is a hard limit. Contact only counts while sinking
    // (or already below the ground): a plane climbing away from the runway at
    // liftoff is not touching down again.
    if (state.y <= ground + 1.2 && (state.verticalSpeed <= 0 || state.y <= ground)) {
      const aligned = Math.abs(wrapAngle(state.heading - 0)) < PLANE.landingMaxHeadingError;
      const gentle = vs > -PLANE.landingMaxSink;
      const slow = state.speed < PLANE.landingMaxSpeed;
      if (onRunway(state.x, state.z) && state.gearDown && gentle && slow && Math.abs(state.roll) < PLANE.landingMaxRoll && aligned) {
        state.airborne = false;
        state.y = ground;
        state.verticalSpeed = 0;
        state.touchdownSink = vs;
        state.touchdownSpeed = state.speed;
        state.speed = Math.min(state.speed, 55);
        events |= EVENT_TOUCHDOWN;
        if (mission.requiresLanding && state.ringIndex >= rings.length) {
          // Keep rolling; the rollout above finishes the sortie.
        }
        return events;
      }
      if (onRunway(state.x, state.z) && state.gearDown && vs > -10 && state.speed < 75) {
        // A heavy touchdown on the runway: the airframe takes it, barely.
        state.damage += 35;
        state.airborne = false;
        state.y = ground;
        state.verticalSpeed = 0;
        state.touchdownSink = vs;
        state.touchdownSpeed = state.speed;
        state.speed = Math.min(state.speed, 45);
        events |= EVENT_TOUCHDOWN;
        if (state.damage >= 100) return events | crash('airframe gave out on a hard landing');
        return events;
      }
      if (onRunway(state.x, state.z) && !state.gearDown) return events | crash('belly landing — gear was up');
      return events | crash(vs <= -PLANE.landingMaxSink ? 'hit the ground too hard' : 'flew into the terrain');
    }

    return events | checkRing();
  }

  reset();
  return { state, reset, step, ringDistance, mission };
}
