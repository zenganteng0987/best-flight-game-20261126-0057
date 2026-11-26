// The valley the game flies in: its terrain height, the runway, and the clouds.
// Everything here is a pure function of position, so the world is the same every
// run and the screenshot scenes are repeatable. Coordinates are metres: x east,
// z north, y up. Heading 0 points north (+z).

import { createRandom } from './random.js';

/** The runway: a flat strip along the valley floor, heading north. */
export const RUNWAY = {
  x: 0,
  zMin: -400,
  zMax: 400,
  halfWidth: 13,
  heading: 0,
  number: '36',
};

function smoothstep(a, b, t) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/**
 * Terrain height at (x, z). Rolling hills everywhere, a mountain wall to the north
 * and a ridge to the east, and a flat bowl around the runway so takeoffs and
 * landings happen on level ground.
 */
export function terrainHeight(x, z) {
  const hills =
    55 * Math.sin(x * 0.0035 + 1.7) * Math.cos(z * 0.0028 - 0.6) +
    30 * Math.sin(x * 0.009 + 0.4) * Math.sin(z * 0.007 + 2.1) +
    18 * Math.sin(x * 0.021 + 2.9) * Math.cos(z * 0.017 + 0.3);
  const mountains =
    260 * smoothstep(1200, 2200, z) * (0.6 + 0.4 * Math.sin(x * 0.002 + 0.8)) +
    150 * smoothstep(1400, 2400, x) +
    120 * smoothstep(1600, 2600, -x);
  const valley = smoothstep(400, 1400, Math.hypot(x - RUNWAY.x, z));
  return (30 + hills + mountains) * valley;
}

/** True when (x, z) is on the runway strip. */
export function onRunway(x, z) {
  return Math.abs(x - RUNWAY.x) <= RUNWAY.halfWidth && z >= RUNWAY.zMin && z <= RUNWAY.zMax;
}

/** Distance in metres from (x, z) to the runway centreline, along the strip. */
export function runwayDistance(x, z) {
  return Math.hypot(x - RUNWAY.x, Math.min(Math.max(z, RUNWAY.zMin), RUNWAY.zMax) - z);
}

/** Clouds: fixed puffs the renderer projects, seeded so they never move between runs. */
export function createClouds() {
  const random = createRandom(20261126);
  const clouds = [];
  for (let i = 0; i < 16; i += 1) {
    clouds.push({
      x: (random() - 0.5) * 9000,
      y: 480 + random() * 260,
      z: (random() - 0.5) * 9000,
      size: 120 + random() * 180,
    });
  }
  return clouds;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Heading from a position toward a target, in the same convention as the plane. */
export function headingTo(x, z, tx, tz) {
  return Math.atan2(tx - x, tz - z);
}

/** Metres per second to knots, and metres to feet, for the HUD. */
export const toKnots = (ms) => ms * 1.94384;
export const toFeet = (m) => m * 3.28084;
