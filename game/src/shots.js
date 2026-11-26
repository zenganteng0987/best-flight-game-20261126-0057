// The screenshot scenes behind ?shot=cover|cockpit|rings|landing. Each one plays
// the real rules forward from a fresh sortie, steered by a simple autopilot
// (bank toward the next ring, pitch toward its altitude, throttle for the phase),
// so the frame is what a short game really looks like. The autopilot also flies
// the title screen's live backdrop. No DOM here: main.js wires the result to the
// renderer, and a Node harness can run the same scenes to check they stage.

import { MISSIONS, STEP } from './config.js';
import { createFlight } from './flight.js';
import { createSortie } from './missions.js';
import { headingTo, terrainHeight, wrapAngle } from './terrain.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The approach for a landing: one fix south of the threshold, then a glide
 * slope down the centreline to the runway. */
const APPROACH = [{ x: 0, y: 90, z: -1400 }];
/** A waypoint counts as reached inside this distance, so the plane never has to
 * orbit a point it cannot turn tightly enough to hit. */
const WAYPOINT_CAPTURE = 250;

/**
 * The autopilot's controls for one step. Pitch and bank are PD controllers
 * (a wanted climb rate and a wanted bank, chased with the stick), so the plane
 * settles on the target instead of seesawing past it: bank toward the target's
 * heading, pitch toward its altitude, throttle for the phase, gear down on the
 * ground and on final approach, up once climbing away.
 */
export function autopilotControls(flight) {
  const f = flight.state;
  const mission = flight.mission;
  let target;
  let landing = false;
  let onFinal = false;
  if (mission.requiresLanding && f.ringIndex >= f.rings.length) {
    landing = true;
    // Fly to the fix, then turn onto final: a far point down the centreline,
    // at an altitude on the glide slope (5.5% down to the threshold).
    if (f.approachIndex === 0) {
      target = APPROACH[0];
      if (Math.hypot(f.x - target.x, f.y - target.y, f.z - target.z) <= WAYPOINT_CAPTURE) {
        f.approachIndex = 1;
      }
    }
    if (f.approachIndex >= 1) {
      onFinal = true;
      // Aim at the centreline 250 m ahead of the plane, not at a fixed far
      // point: a far point gives a shallow intercept and the plane flies
      // parallel to the runway instead of onto it. Altitude rides the glide
      // slope down to the threshold — measured along the approach, so once the
      // plane is past the threshold the target stays down and it lands instead
      // of climbing away.
      const along = -(f.z + 400);
      const glideAlt = clamp(along * 0.05 - 2, -10, 70);
      target = { x: 0, y: glideAlt, z: f.z + 250 };
    }
  } else {
    // Aim straight at the ring's centre: pure pursuit onto a fixed point
    // converges, while aiming past it leaves a standing sideways offset.
    target = f.rings[f.ringIndex] ?? { x: 0, y: 120, z: 0 };
  }

  if (!f.airborne) {
    // On the ground: full throttle to take off — unless the sortie is done,
    // in which case cut the throttle and roll out to a stop.
    const done = mission.requiresLanding && f.ringIndex >= f.rings.length;
    return { pitch: done ? 0 : f.speed > 28 ? 1 : 0, roll: 0, throttle: done ? 0 : 1, gear: true };
  }

  // Bank: the wanted bank follows the heading error; the stick holds that bank.
  // A stronger gain on final, where the centreline is the whole job.
  const desiredHeading = headingTo(f.x, f.z, target.x, target.z);
  const headingError = wrapAngle(desiredHeading - f.heading);
  const bankGain = onFinal ? 2.2 : 1.8;
  const roll = clamp((clamp(headingError * bankGain, -1.1, 1.1) / 1.15), -1, 1);
  // Pitch: the wanted climb rate follows the altitude error; the stick holds
  // the pitch that gives that climb rate. Never dive toward the ground: keep a
  // floor above the terrain — high on the turn onto final, down to the runway
  // once the threshold is close and the valley is flat.
  const altError = target.y - f.y;
  let desiredVs = clamp(altError * 0.5, -12, 20);
  let floor = terrainHeight(f.x, f.z) + 45;
  if (onFinal) {
    // Near or past the threshold the valley is flat: let the plane come down
    // to the runway. Farther out, keep a floor above the rising ground.
    const along = -(f.z + 400);
    floor = terrainHeight(f.x, f.z) + (along <= 200 ? 0 : 8);
    // Flare: close to the threshold, sink gently so the touchdown is soft.
    if (along < 120) desiredVs = clamp(desiredVs, -4, 20);
  }
  if (f.y < floor) desiredVs = Math.max(desiredVs, 10);
  const desiredPitch = clamp(Math.asin(clamp(desiredVs / Math.max(f.speed, 30), -0.5, 0.5)), -0.5, 0.5);
  const pitch = clamp(desiredPitch / 0.55, -1, 1);
  // Throttle: cruise, slower near a ring so the turn tightens, gentle on final.
  // A big heading error means a tight turn ahead: slow down first, so the turn
  // radius shrinks and the plane can actually make the ring.
  const dist = Math.hypot(f.x - target.x, f.y - target.y, f.z - target.z);
  let throttle = 0.72;
  if (landing) throttle = f.speed > 48 ? 0.3 : 0.5;
  else if (Math.abs(headingError) > 0.35) throttle = 0.28;
  else if (dist < 500) throttle = 0.42;
  else if (f.speed > 85) throttle = 0.6;
  const gear = landing || f.y < 60;
  return { pitch, roll, throttle, gear };
}

/**
 * Fly a sortie with the autopilot until `stop` says the scene is staged, or the
 * step cap is hit. Returns the flight, the sortie and where it stopped.
 */
function flyUntil(mission, stop, maxSeconds = 300) {
  const flight = createFlight(mission);
  flight.mission = mission;
  const { sortie, applyEvents } = createSortie(mission, flight);
  let stoppedAt = null;
  for (let i = 0; i < maxSeconds / STEP; i += 1) {
    const events = flight.step(STEP, autopilotControls(flight));
    applyEvents(events, STEP);
    if (flight.state.status !== 'flying') {
      stoppedAt = `sortie ${flight.state.status} after ${flight.state.time.toFixed(1)}s`;
      break;
    }
    const why = stop(flight, sortie);
    if (why) {
      stoppedAt = why;
      break;
    }
  }
  if (!stoppedAt) stoppedAt = `step cap after ${flight.state.time.toFixed(1)}s`;
  return { flight, sortie, stoppedAt };
}

/**
 * Stage a named scene (cover, cockpit, rings or landing; any other name is
 * cover) and return the flight, the sortie, the screen and the camera to draw.
 */
export function stageShot(name) {
  if (name === 'landing') {
    const mission = MISSIONS[2];
    const staged = flyUntil(mission, (flight) => {
      const f = flight.state;
      const distThreshold = Math.hypot(f.x, f.z + 400);
      // Close and low, so the runway fills the frame ahead of the plane.
      if (f.ringIndex >= f.rings.length && distThreshold < 160 && f.y < 30 && f.airborne) {
        return `on final, ${Math.round(distThreshold)} m out, ${Math.round(f.y)} m up`;
      }
      return null;
    });
    return { ...staged, screen: 'play', camera: 'chase', best: { 1: 1250, 2: 0, 3: 1480 } };
  }
  if (name === 'cockpit') {
    const mission = MISSIONS[0];
    const staged = flyUntil(mission, (flight) => {
      const f = flight.state;
      if (f.ringIndex === 3 && flight.ringDistance() < 260) return `closing on ring 4, ${Math.round(flight.ringDistance())} m`;
      return null;
    });
    return { ...staged, screen: 'play', camera: 'cockpit', best: { 1: 1250, 2: 0, 3: 1480 } };
  }
  if (name === 'rings') {
    const mission = MISSIONS[0];
    const staged = flyUntil(mission, (flight) => {
      const f = flight.state;
      if (f.ringIndex === 1 && flight.ringDistance() < 75) return `about to fly ring 2, ${Math.round(flight.ringDistance())} m`;
      return null;
    });
    return { ...staged, screen: 'play', camera: 'chase', best: { 1: 1250, 2: 0, 3: 1480 } };
  }
  const mission = MISSIONS[0];
  const staged = flyUntil(mission, (flight) => {
    const f = flight.state;
    if (f.ringIndex === 2 && flight.ringDistance() < 330) return `closing on ring 3, ${Math.round(flight.ringDistance())} m`;
    return null;
  });
  return { ...staged, screen: 'play', camera: 'chase', best: { 1: 1250, 2: 0, 3: 1480 } };
}
