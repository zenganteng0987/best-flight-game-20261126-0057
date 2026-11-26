// Drawing only: the flight state and the current screen in, pixels out. The
// 1280x960 playfield is scaled to fit the window and centred. The world is a
// pseudo-3D projection: sky, layered terrain silhouettes, a projected runway,
// projected rings, then the aircraft (chase view) or the cockpit, then the HUD
// and the screen's panel. Text that holds a number is rebuilt only when the
// number changes, so a frame allocates nothing.

import { FIELD, FONT, MISSIONS, MONO_FONT, PALETTE } from './config.js';
import { scoreLines } from './missions.js';
import { RUNWAY, createClouds, terrainHeight, toFeet, toKnots } from './terrain.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_COMPLETE = 'complete';

export const CAMERA_CHASE = 'chase';
export const CAMERA_COCKPIT = 'cockpit';

/** The title screen's mission cards, in 1280x960 field coordinates, for click hits. */
export const MISSION_CARDS = MISSIONS.map((m, i) => ({
  id: m.id,
  x: 140 + i * 340,
  y: 500,
  width: 300,
  height: 220,
}));

const FOCAL = 640;
const LAYERS = [
  { dist: 4200, color: PALETTE.terrainFar },
  { dist: 2200, color: PALETTE.terrainMid },
  { dist: 1100, color: PALETTE.terrainNear },
  { dist: 550, color: PALETTE.terrainLow },
];

function cachedLabel(prefix) {
  let value = null;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const clouds = createClouds();
  const altLabel = cachedLabel('ALT ');
  const speedLabel = cachedLabel('SPD ');
  const headingLabel = cachedLabel('HDG ');
  const ringLabel = cachedLabel('RING ');
  const scoreLabel = cachedLabel('SCORE ');
  const timeLabel = cachedLabel('TIME ');
  const fuelLabel = cachedLabel('FUEL ');
  const damageLabel = cachedLabel('DMG ');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, font = FONT) {
    const key = `${size}|${font}`;
    if (!fonts.has(key)) fonts.set(key, `${size}px ${font}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function mono(value, x, y, size, color, align) {
    text(value, x, y, size, color, align, MONO_FONT);
  }

  function roundRect(x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  /** Camera from the plane: position, look direction, roll, and the basis vectors. */
  function cameraFor(state, mode) {
    const fwd = { x: Math.sin(state.heading), y: 0, z: Math.cos(state.heading) };
    let pos;
    let look;
    if (mode === CAMERA_COCKPIT) {
      pos = {
        x: state.x + fwd.x * 1.5,
        y: state.y + 1.0,
        z: state.z + fwd.z * 1.5,
      };
      look = {
        x: pos.x + Math.sin(state.heading) * Math.cos(state.pitch) * 100,
        y: pos.y + Math.sin(state.pitch) * 100,
        z: pos.z + Math.cos(state.heading) * Math.cos(state.pitch) * 100,
      };
    } else {
      pos = {
        x: state.x - fwd.x * 17,
        y: state.y + 4.5,
        z: state.z - fwd.z * 17,
      };
      look = {
        x: state.x + fwd.x * 30,
        y: state.y + 1,
        z: state.z + fwd.z * 30,
      };
    }
    const forward = norm(sub(look, pos));
    const right = norm(cross({ x: 0, y: 1, z: 0 }, forward));
    const up = cross(forward, right);
    return { pos, forward, right, up, pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))), roll: state.roll, heading: state.heading };
  }

  /** Project a world point to field coordinates, or null when behind the camera. */
  function project(cam, p) {
    const d = sub(p, cam.pos);
    let cx = dot(d, cam.right);
    let cy = dot(d, cam.up);
    const cz = dot(d, cam.forward);
    if (cz < 1) return null;
    const cos = Math.cos(cam.roll);
    const sin = Math.sin(cam.roll);
    const rx = cx * cos - cy * sin;
    const ry = cx * sin + cy * cos;
    return { x: FIELD.width / 2 + (rx / cz) * FOCAL, y: FIELD.height / 2 - (ry / cz) * FOCAL, z: cz };
  }

  function drawSky(cam) {
    const gradient = context.createLinearGradient(0, 0, 0, FIELD.height);
    gradient.addColorStop(0, PALETTE.skyTop);
    gradient.addColorStop(0.55, PALETTE.skyMid);
    gradient.addColorStop(1, PALETTE.skyLow);
    context.fillStyle = gradient;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // The sun sits north-west, high: a warm disc with a soft glow.
    const sunDir = { x: Math.sin(-0.9) * Math.cos(0.5), y: Math.sin(0.5), z: Math.cos(-0.9) * Math.cos(0.5) };
    const sun = project(cam, { x: cam.pos.x + sunDir.x * 5000, y: cam.pos.y + sunDir.y * 5000, z: cam.pos.z + sunDir.z * 5000 });
    if (sun) {
      const glow = context.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 90);
      glow.addColorStop(0, 'rgba(255, 243, 196, 0.9)');
      glow.addColorStop(0.35, 'rgba(255, 243, 196, 0.35)');
      glow.addColorStop(1, 'rgba(255, 243, 196, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(sun.x, sun.y, 90, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = PALETTE.sun;
      context.beginPath();
      context.arc(sun.x, sun.y, 26, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawClouds(cam) {
    context.fillStyle = PALETTE.cloud;
    for (const cloud of clouds) {
      const p = project(cam, cloud);
      if (!p || p.x < -200 || p.x > FIELD.width + 200 || p.y < -100 || p.y > FIELD.height + 100) continue;
      const scale = Math.min(2.2, FOCAL / Math.max(200, p.z)) * (cloud.size / 140);
      context.globalAlpha = 0.85;
      context.beginPath();
      context.ellipse(p.x, p.y, 70 * scale, 20 * scale, 0, 0, Math.PI * 2);
      context.ellipse(p.x - 42 * scale, p.y + 8 * scale, 44 * scale, 15 * scale, 0, 0, Math.PI * 2);
      context.ellipse(p.x + 46 * scale, p.y + 7 * scale, 48 * scale, 16 * scale, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  /** One terrain silhouette layer: the horizon profile at a fixed distance, far to near. */
  function drawTerrainLayer(cam, dist, color) {
    const heading = Math.atan2(cam.forward.x, cam.forward.z);
    context.beginPath();
    let first = true;
    for (let sx = 0; sx <= FIELD.width; sx += 12) {
      const lat = Math.atan((sx - FIELD.width / 2) / FOCAL);
      const hd = heading + lat;
      const px = cam.pos.x + Math.sin(hd) * dist;
      const pz = cam.pos.z + Math.cos(hd) * dist;
      const terrY = terrainHeight(px, pz);
      const elev = Math.atan2(terrY - cam.pos.y, dist);
      const sy = FIELD.height / 2 - Math.tan(elev - cam.pitch) * FOCAL;
      if (first) {
        context.moveTo(sx, sy);
        first = false;
      } else context.lineTo(sx, sy);
    }
    context.lineTo(FIELD.width, FIELD.height + 60);
    context.lineTo(0, FIELD.height + 60);
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  function drawTerrain(cam) {
    context.save();
    context.translate(FIELD.width / 2, FIELD.height / 2);
    context.rotate(cam.roll);
    context.translate(-FIELD.width / 2, -FIELD.height / 2);
    for (const layer of LAYERS) drawTerrainLayer(cam, layer.dist, layer.color);
    context.restore();
  }

  /** A world point in camera space (right, up, forward), before the roll. */
  function cameraSpace(cam, p) {
    const d = sub(p, cam.pos);
    return { x: dot(d, cam.right), y: dot(d, cam.up), z: dot(d, cam.forward) };
  }

  /** Where an edge crosses the near plane, for clipping. */
  function nearIntersect(a, b, near) {
    const t = (near - a.z) / (b.z - a.z);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
  }

  /**
   * Project a polygon (world points) to field coordinates, clipping it against
   * the near plane first: a quad straddling the camera (the runway under the
   * plane at takeoff) is drawn cut off at the screen's edge instead of
   * vanishing whole when one corner is behind the camera.
   */
  function projectPoly(cam, points) {
    const near = 1;
    const poly = points.map((p) => cameraSpace(cam, p));
    const out = [];
    for (let i = 0; i < poly.length; i += 1) {
      const cur = poly[i];
      const prev = poly[(i + poly.length - 1) % poly.length];
      if (cur.z >= near) {
        if (prev.z < near) out.push(nearIntersect(prev, cur, near));
        out.push(cur);
      } else if (prev.z >= near) {
        out.push(nearIntersect(prev, cur, near));
      }
    }
    if (out.length < 3) return null;
    const cos = Math.cos(cam.roll);
    const sin = Math.sin(cam.roll);
    return out.map((pt) => {
      const rx = pt.x * cos - pt.y * sin;
      const ry = pt.x * sin + pt.y * cos;
      return { x: FIELD.width / 2 + (rx / pt.z) * FOCAL, y: FIELD.height / 2 - (ry / pt.z) * FOCAL };
    });
  }

  /** The runway: a dark strip with edge lines, centreline dashes, threshold
   * bars and its number, each drawn as a projected quad so it reads as a
   * runway from any angle instead of a stack of flat rectangles. */
  function drawRunway(cam) {
    function quad(a, b, c, d, fill) {
      const pts = projectPoly(cam, [a, b, c, d]);
      if (!pts) return;
      context.beginPath();
      context.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) context.lineTo(pts[i].x, pts[i].y);
      context.closePath();
      context.fillStyle = fill;
      context.fill();
    }
    const hw = RUNWAY.halfWidth;
    quad(
      { x: -hw, y: 0, z: RUNWAY.zMin },
      { x: hw, y: 0, z: RUNWAY.zMin },
      { x: hw, y: 0, z: RUNWAY.zMax },
      { x: -hw, y: 0, z: RUNWAY.zMax },
      PALETTE.runway,
    );
    // Edge lines: thin quads along both long sides.
    quad({ x: -hw, y: 0.1, z: RUNWAY.zMin }, { x: -hw + 1, y: 0.1, z: RUNWAY.zMin }, { x: -hw + 1, y: 0.1, z: RUNWAY.zMax }, { x: -hw, y: 0.1, z: RUNWAY.zMax }, PALETTE.runwayEdge);
    quad({ x: hw - 1, y: 0.1, z: RUNWAY.zMin }, { x: hw, y: 0.1, z: RUNWAY.zMin }, { x: hw, y: 0.1, z: RUNWAY.zMax }, { x: hw - 1, y: 0.1, z: RUNWAY.zMax }, PALETTE.runwayEdge);
    // Centreline dashes.
    for (let z = RUNWAY.zMin + 20; z < RUNWAY.zMax - 10; z += 40) {
      quad({ x: -1, y: 0.1, z }, { x: 1, y: 0.1, z }, { x: 1, y: 0.1, z: z + 20 }, { x: -1, y: 0.1, z: z + 20 }, PALETTE.runwayEdge);
    }
    // Threshold bars at the south end.
    for (let i = -2; i <= 2; i += 1) {
      if (i === 0) continue;
      quad(
        { x: i * 5 - 2, y: 0.1, z: RUNWAY.zMin + 8 },
        { x: i * 5 + 2, y: 0.1, z: RUNWAY.zMin + 8 },
        { x: i * 5 + 2, y: 0.1, z: RUNWAY.zMin + 28 },
        { x: i * 5 - 2, y: 0.1, z: RUNWAY.zMin + 28 },
        PALETTE.runwayEdge,
      );
    }
    // The number, sized to the runway's projected width and turned along it.
    const nearL = project(cam, { x: -hw, y: 0.1, z: RUNWAY.zMin + 40 });
    const nearR = project(cam, { x: hw, y: 0.1, z: RUNWAY.zMin + 40 });
    const far = project(cam, { x: 0, y: 0.1, z: RUNWAY.zMin + 140 });
    const label = project(cam, { x: 0, y: 0.1, z: RUNWAY.zMin + 70 });
    if (nearL && nearR && far && label && label.z < 1500) {
      const width = Math.hypot(nearR.x - nearL.x, nearR.y - nearL.y);
      // Turn the number's top toward the far end of the runway: rotate the
      // text's up vector (0,-1) onto the label-to-far direction.
      const dx = far.x - label.x;
      const dy = far.y - label.y;
      const angle = Math.atan2(dx, -dy);
      context.save();
      context.translate(label.x, label.y);
      context.rotate(angle);
      text(RUNWAY.number, 0, 0, Math.max(10, Math.min(34, width * 0.32)), PALETTE.runwayEdge, 'center');
      context.restore();
    }
  }

  function drawRings(cam, flight) {
    const f = flight.state;
    for (let i = f.ringIndex; i < f.rings.length; i += 1) {
      const ring = f.rings[i];
      const isNext = i === f.ringIndex;
      const centre = project(cam, ring);
      if (!centre) continue;
      const n = ring.normal;
      const right = norm(cross(n, { x: 0, y: 1, z: 0 }));
      const up2 = cross(right, n);
      const rp = project(cam, { x: ring.x + right.x * ring.r, y: ring.y + right.y * ring.r, z: ring.z + right.z * ring.r });
      const rm = project(cam, { x: ring.x - right.x * ring.r, y: ring.y - right.y * ring.r, z: ring.z - right.z * ring.r });
      const up = project(cam, { x: ring.x + up2.x * ring.r, y: ring.y + up2.y * ring.r, z: ring.z + up2.z * ring.r });
      const dn = project(cam, { x: ring.x - up2.x * ring.r, y: ring.y - up2.y * ring.r, z: ring.z - up2.z * ring.r });
      if (!rp || !rm || !up || !dn) continue;
      const rx = Math.hypot(rp.x - rm.x, rp.y - rm.y) / 2;
      const ry = Math.hypot(up.x - dn.x, up.y - dn.y) / 2;
      const rot = Math.atan2(rp.y - rm.y, rp.x - rm.x);
      if (rx < 2 || ry < 2) continue;
      context.save();
      context.beginPath();
      context.ellipse(centre.x, centre.y, Math.max(rx, 3), Math.max(ry, 3), rot, 0, Math.PI * 2);
      context.strokeStyle = isNext ? PALETTE.ringNext : PALETTE.ringOther;
      context.globalAlpha = isNext ? 1 : 0.7;
      context.lineWidth = isNext ? 9 : 5;
      if (isNext) {
        context.shadowColor = PALETTE.ringNext;
        context.shadowBlur = 18;
      }
      context.stroke();
      context.restore();
      if (centre.z < 2500) {
        const dist = Math.round(Math.hypot(f.x - ring.x, f.y - ring.y, f.z - ring.z));
        text(`RING ${i + 1}`, centre.x, centre.y - ry - 14, 20, isNext ? PALETTE.ringNext : PALETTE.hudDim, 'center');
        if (isNext) text(`${dist} m`, centre.x, centre.y - ry + 42, 18, PALETTE.hudDim, 'center');
      }
    }
  }

  /** The aircraft from behind and above, in chase view, banked with the roll. */
  function drawPlaneChase(state) {
    const cx = FIELD.width / 2;
    const cy = FIELD.height * 0.6;
    context.save();
    context.translate(cx, cy);
    context.rotate(state.roll * 0.4);
    // Main wings: swept trapezoids.
    context.fillStyle = PALETTE.planeCream;
    context.beginPath();
    context.moveTo(-118, 14);
    context.lineTo(-24, -10);
    context.lineTo(24, -10);
    context.lineTo(118, 14);
    context.lineTo(86, 26);
    context.lineTo(-86, 26);
    context.closePath();
    context.fill();
    context.strokeStyle = PALETTE.planeRed;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-118, 14);
    context.lineTo(-24, -10);
    context.moveTo(118, 14);
    context.lineTo(24, -10);
    context.stroke();
    // Horizontal stabiliser.
    context.fillStyle = PALETTE.planeCream;
    context.beginPath();
    context.moveTo(-46, -34);
    context.lineTo(-12, -44);
    context.lineTo(12, -44);
    context.lineTo(46, -34);
    context.lineTo(30, -26);
    context.lineTo(-30, -26);
    context.closePath();
    context.fill();
    // Fuselage: tapered, cream with a red cheatline.
    const body = context.createLinearGradient(0, -64, 0, 34);
    body.addColorStop(0, '#f7f1e2');
    body.addColorStop(1, '#e3d9c2');
    context.fillStyle = body;
    context.beginPath();
    context.moveTo(-13, 34);
    context.quadraticCurveTo(-17, -20, -9, -62);
    context.quadraticCurveTo(0, -70, 9, -62);
    context.quadraticCurveTo(17, -20, 13, 34);
    context.quadraticCurveTo(0, 42, -13, 34);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.planeRed;
    context.fillRect(-14, -6, 28, 7);
    // Vertical fin.
    context.fillStyle = PALETTE.planeRed;
    context.beginPath();
    context.moveTo(-8, -58);
    context.lineTo(-4, -92);
    context.lineTo(6, -92);
    context.lineTo(10, -58);
    context.closePath();
    context.fill();
    // Canopy.
    context.fillStyle = PALETTE.canopy;
    context.beginPath();
    context.ellipse(0, -30, 8, 16, 0, 0, Math.PI * 2);
    context.fill();
    // Wingtip navigation lights.
    context.fillStyle = '#ff4d4d';
    context.beginPath();
    context.arc(-116, 16, 5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#4dff88';
    context.beginPath();
    context.arc(116, 16, 5, 0, Math.PI * 2);
    context.fill();
    // Exhaust glow at full throttle.
    if (state.throttle > 0.7) {
      context.fillStyle = 'rgba(255, 176, 32, 0.75)';
      context.beginPath();
      context.arc(-6, 40, 5, 0, Math.PI * 2);
      context.arc(6, 40, 5, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawGauge(x, y, r, label, value, max, unit) {
    context.save();
    context.translate(x, y);
    context.fillStyle = PALETTE.gaugeFace;
    context.beginPath();
    context.arc(0, 0, r, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 3;
    context.stroke();
    context.strokeStyle = PALETTE.hudDim;
    context.lineWidth = 2;
    for (let i = 0; i <= 10; i += 1) {
      const a = (-Math.PI * 0.75) + (i / 10) * (Math.PI * 1.5);
      const inner = r - 8;
      const outer = r - (i % 5 === 0 ? 18 : 13);
      context.beginPath();
      context.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      context.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      context.stroke();
    }
    const frac = Math.max(0, Math.min(1, value / max));
    const angle = -Math.PI * 0.75 + frac * Math.PI * 1.5;
    context.strokeStyle = PALETTE.gaugeAmber;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Math.cos(angle) * (r - 12), Math.sin(angle) * (r - 12));
    context.stroke();
    context.fillStyle = PALETTE.gaugeAmber;
    context.beginPath();
    context.arc(0, 0, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
    text(label, x, y + r + 22, 15, PALETTE.hudDim, 'center');
    mono(String(Math.round(value)), x, y + r + 44, 20, PALETTE.hudText, 'center');
    if (unit) text(unit, x, y + r + 64, 13, PALETTE.muted, 'center');
  }

  /** The cockpit: canopy frame, nose, and a lit instrument panel. */
  function drawCockpit(state, sortie) {
    const f = state;
    // Canopy frame.
    context.fillStyle = 'rgba(20, 26, 36, 0.92)';
    context.fillRect(0, 0, FIELD.width, 26);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(150, 0);
    context.lineTo(60, FIELD.height * 0.42);
    context.lineTo(0, FIELD.height * 0.42);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(FIELD.width, 0);
    context.lineTo(FIELD.width - 150, 0);
    context.lineTo(FIELD.width - 60, FIELD.height * 0.42);
    context.lineTo(FIELD.width, FIELD.height * 0.42);
    context.closePath();
    context.fill();
    context.fillRect(FIELD.width / 2 - 8, 0, 16, FIELD.height * 0.3);
    // Nose cowling at the bottom centre.
    context.fillStyle = PALETTE.planeCream;
    context.beginPath();
    context.moveTo(FIELD.width / 2 - 130, FIELD.height);
    context.quadraticCurveTo(FIELD.width / 2 - 90, FIELD.height - 130, FIELD.width / 2, FIELD.height - 150);
    context.quadraticCurveTo(FIELD.width / 2 + 90, FIELD.height - 130, FIELD.width / 2 + 130, FIELD.height);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.planeRed;
    context.beginPath();
    context.ellipse(FIELD.width / 2, FIELD.height - 96, 34, 20, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = PALETTE.planeDark;
    context.beginPath();
    context.arc(FIELD.width / 2, FIELD.height - 96, 10, 0, Math.PI * 2);
    context.fill();
    // Instrument panel.
    const panelTop = FIELD.height - 300;
    const panelGrad = context.createLinearGradient(0, panelTop, 0, FIELD.height);
    panelGrad.addColorStop(0, '#232c3d');
    panelGrad.addColorStop(1, PALETTE.panel);
    context.fillStyle = panelGrad;
    context.fillRect(0, panelTop, FIELD.width, 300);
    context.fillStyle = PALETTE.panelEdge;
    context.fillRect(0, panelTop, FIELD.width, 4);
    // Compass tape across the top of the panel.
    const headingDeg = ((f.heading * 180) / Math.PI + 360) % 360;
    context.save();
    context.beginPath();
    context.rect(0, panelTop + 10, FIELD.width, 44);
    context.clip();
    for (let d = -180; d <= 180; d += 5) {
      const deg = Math.round((headingDeg + d + 360) % 360);
      const x = FIELD.width / 2 + d * 4;
      const major = deg % 30 === 0;
      context.strokeStyle = major ? PALETTE.hudText : PALETTE.hudDim;
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(x, panelTop + 14);
      context.lineTo(x, panelTop + (major ? 34 : 26));
      context.stroke();
      if (major) {
        const name = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg).padStart(3, '0');
        text(name, x, panelTop + 50, 14, PALETTE.hudText, 'center');
      }
    }
    context.restore();
    context.fillStyle = PALETTE.gaugeAmber;
    context.beginPath();
    context.moveTo(FIELD.width / 2 - 7, panelTop + 8);
    context.lineTo(FIELD.width / 2 + 7, panelTop + 8);
    context.lineTo(FIELD.width / 2, panelTop + 20);
    context.closePath();
    context.fill();
    // Artificial horizon, centre of the panel.
    const aiX = FIELD.width / 2;
    const aiY = panelTop + 168;
    const aiR = 66;
    context.save();
    context.beginPath();
    context.arc(aiX, aiY, aiR, 0, Math.PI * 2);
    context.clip();
    context.translate(aiX, aiY);
    context.rotate(-f.roll);
    context.translate(0, f.pitch * 120);
    context.fillStyle = '#6fb3e8';
    context.fillRect(-aiR - 4, -aiR * 2 - 4, aiR * 2 + 8, aiR * 2 + 4);
    context.fillStyle = '#7a5a38';
    context.fillRect(-aiR - 4, 0, aiR * 2 + 8, aiR * 2 + 4);
    context.fillStyle = '#ffffff';
    context.fillRect(-aiR - 4, -2, aiR * 2 + 8, 4);
    context.restore();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(aiX, aiY, aiR, 0, Math.PI * 2);
    context.stroke();
    // Fixed aircraft symbol over the horizon.
    context.fillStyle = PALETTE.gaugeAmber;
    context.fillRect(aiX - 26, aiY - 3, 18, 5);
    context.fillRect(aiX + 8, aiY - 3, 18, 5);
    context.beginPath();
    context.arc(aiX, aiY, 4, 0, Math.PI * 2);
    context.fill();
    text('ATTITUDE', aiX, aiY + aiR + 20, 14, PALETTE.hudDim, 'center');
    // Airspeed and altitude dials.
    drawGauge(aiX - 210, aiY, 54, 'AIRSPEED', toKnots(f.speed), 240, 'KT');
    drawGauge(aiX + 210, aiY, 54, 'ALTITUDE', toFeet(f.y), 3000, 'FT');
    // Fuel and damage bars, right side.
    const barX = FIELD.width - 250;
    text('FUEL', barX, panelTop + 92, 15, PALETTE.hudDim, 'left');
    context.fillStyle = '#0d1117';
    context.fillRect(barX, panelTop + 100, 200, 16);
    context.fillStyle = f.fuel < 20 ? PALETTE.gaugeRed : PALETTE.gaugeGreen;
    context.fillRect(barX, panelTop + 100, 200 * (f.fuel / 100), 16);
    text('DAMAGE', barX, panelTop + 132, 15, PALETTE.hudDim, 'left');
    context.fillStyle = '#0d1117';
    context.fillRect(barX, panelTop + 140, 200, 16);
    context.fillStyle = PALETTE.gaugeRed;
    context.fillRect(barX, panelTop + 140, 200 * (f.damage / 100), 16);
    // Gear lights.
    text('GEAR', barX, panelTop + 182, 15, PALETTE.hudDim, 'left');
    for (let i = 0; i < 3; i += 1) {
      context.fillStyle = f.gearDown ? PALETTE.gaugeGreen : PALETTE.gaugeRed;
      context.beginPath();
      context.arc(barX + 70 + i * 26, panelTop + 176, 8, 0, Math.PI * 2);
      context.fill();
    }
    // Throttle lever, left side.
    text('THROTTLE', 90, panelTop + 92, 15, PALETTE.hudDim, 'left');
    context.fillStyle = '#0d1117';
    context.fillRect(110, panelTop + 104, 14, 120);
    context.fillStyle = PALETTE.gaugeAmber;
    context.fillRect(96, panelTop + 104 + (1 - f.throttle) * 104, 42, 16);
    mono(`${Math.round(f.throttle * 100)}%`, 117, panelTop + 248, 18, PALETTE.hudText, 'center');
  }

  function drawHud(state, sortie, camera) {
    const f = state;
    // Top-left instrument block: altitude, speed, heading.
    context.fillStyle = 'rgba(12, 18, 28, 0.55)';
    roundRect(20, 20, 250, 128, 10);
    context.fill();
    mono(altLabel(Math.round(toFeet(f.y))), 36, 58, 26, PALETTE.hudText, 'left');
    text('FT', 236, 58, 16, PALETTE.hudDim, 'right');
    mono(speedLabel(Math.round(toKnots(f.speed))), 36, 96, 26, PALETTE.hudText, 'left');
    text('KT', 236, 96, 16, PALETTE.hudDim, 'right');
    const headingDeg = Math.round(((f.heading * 180) / Math.PI + 360) % 360);
    mono(headingLabel(String(headingDeg).padStart(3, '0')), 36, 134, 26, PALETTE.hudText, 'left');
    text('°', 236, 134, 16, PALETTE.hudDim, 'right');
    // Top-right mission block.
    context.fillStyle = 'rgba(12, 18, 28, 0.55)';
    roundRect(FIELD.width - 270, 20, 250, 128, 10);
    context.fill();
    text(sortie.mission.short, FIELD.width - 36, 58, 24, PALETTE.hudText, 'right');
    mono(ringLabel(`${f.ringsPassed}/${f.rings.length}`), FIELD.width - 36, 96, 24, PALETTE.hudText, 'right');
    mono(timeLabel(`${Math.floor(sortie.time / 60)}:${String(Math.floor(sortie.time % 60)).padStart(2, '0')}`), FIELD.width - 36, 134, 24, PALETTE.hudText, 'right');
    // Score under the mission block.
    mono(scoreLabel(sortie.score), FIELD.width - 36, 176, 24, PALETTE.gaugeAmber, 'right');
    // Bottom-left fuel and damage bars (chase view only; the cockpit panel
    // carries its own gauges, so this would cover the throttle lever there).
    if (camera === CAMERA_CHASE) {
      context.fillStyle = 'rgba(12, 18, 28, 0.55)';
      roundRect(20, FIELD.height - 116, 260, 96, 10);
      context.fill();
      mono(fuelLabel(`${Math.round(f.fuel)}%`), 36, FIELD.height - 88, 18, PALETTE.hudDim, 'left');
      context.fillStyle = '#0d1117';
      context.fillRect(36, FIELD.height - 78, 228, 12);
      context.fillStyle = f.fuel < 20 ? PALETTE.gaugeRed : PALETTE.gaugeGreen;
      context.fillRect(36, FIELD.height - 78, 228 * (f.fuel / 100), 12);
      mono(damageLabel(`${Math.round(f.damage)}%`), 36, FIELD.height - 52, 18, PALETTE.hudDim, 'left');
      context.fillStyle = '#0d1117';
      context.fillRect(36, FIELD.height - 42, 228, 12);
      context.fillStyle = PALETTE.gaugeRed;
      context.fillRect(36, FIELD.height - 42, 228 * (f.damage / 100), 12);
    }
    // Warnings and messages, centre.
    if (f.stalled) {
      const blink = Math.floor(sortie.time * 4) % 2 === 0;
      if (blink) text('STALL — NOSE DOWN', FIELD.width / 2, 220, 34, PALETTE.gaugeRed, 'center');
    } else if (f.fuel > 0 && f.fuel < 20) {
      text('LOW FUEL', FIELD.width / 2, 220, 30, PALETTE.hudWarn, 'center');
    }
    const messages = sortie.messages;
    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      const age = sortie.time - m.at;
      const alpha = Math.max(0, 1 - age / m.life);
      context.globalAlpha = alpha;
      text(m.text, FIELD.width / 2, 300 + i * 40, 30, PALETTE.hudText, 'center');
      context.globalAlpha = 1;
    }
  }

  function drawPanel(title, lines, prompt, accent) {
    const height = 150 + lines.length * 36 + 70;
    const x = (FIELD.width - 640) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(12, 18, 28, 0.82)';
    roundRect(x, y, 640, height, 14);
    context.fill();
    context.strokeStyle = accent || PALETTE.panelEdge;
    context.lineWidth = 2;
    roundRect(x, y, 640, height, 14);
    context.stroke();
    text(title, FIELD.width / 2, y + 72, 46, PALETTE.title, 'center');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], FIELD.width / 2, y + 128 + i * 36, 22, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 36, 22, PALETTE.gaugeAmber, 'center');
  }

  function drawTitle(best) {
    text('SKYLANE RIDGE', FIELD.width / 2, 150, 84, PALETTE.title, 'center');
    text('A valley flight game — fly the rings, bring her home.', FIELD.width / 2, 205, 26, PALETTE.muted, 'center');
    for (const card of MISSION_CARDS) {
      const mission = MISSIONS.find((m) => m.id === card.id);
      context.fillStyle = 'rgba(12, 18, 28, 0.78)';
      roundRect(card.x, card.y, card.width, card.height, 12);
      context.fill();
      context.strokeStyle = PALETTE.panelEdge;
      context.lineWidth = 2;
      roundRect(card.x, card.y, card.width, card.height, 12);
      context.stroke();
      text(`${card.id}. ${mission.name}`, card.x + 20, card.y + 48, 26, PALETTE.title, 'left');
      const words = mission.description.split(' ');
      let line = '';
      let ly = card.y + 86;
      for (const word of words) {
        if ((line + ' ' + word).trim().length > 26) {
          text(line.trim(), card.x + 20, ly, 17, PALETTE.muted, 'left');
          ly += 24;
          line = word;
        } else line += ' ' + word;
      }
      text(line.trim(), card.x + 20, ly, 17, PALETTE.muted, 'left');
      text(`Par ${Math.floor(mission.parTime / 60)}:${String(mission.parTime % 60).padStart(2, '0')}   Fuel ${mission.fuel}%`, card.x + 20, card.y + card.height - 52, 16, PALETTE.hudDim, 'left');
      const bestScore = best[mission.id] || 0;
      text(bestScore > 0 ? `Best ${bestScore}` : 'Not flown yet', card.x + 20, card.y + card.height - 26, 16, PALETTE.gaugeAmber, 'left');
    }
    text('Click a mission, or press 1 / 2 / 3', FIELD.width / 2, 790, 26, PALETTE.gaugeAmber, 'center');
    text('↑ ↓ pitch   ← → bank   W / S throttle   G gear   C camera   P pause   M mute', FIELD.width / 2, 838, 20, PALETTE.muted, 'center');
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen the game is on. */
  function draw(viewState) {
    const { flight, sortie, screen, camera, best } = viewState;
    const f = flight.state;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#0b0e13';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    const cam = cameraFor(f, camera);
    drawSky(cam);
    drawClouds(cam);
    drawTerrain(cam);
    drawRunway(cam);
    drawRings(cam, flight);
    if (camera === CAMERA_CHASE) drawPlaneChase(f);
    else drawCockpit(f, sortie);
    if (screen === SCREEN_TITLE) {
      drawHud(f, sortie, camera);
      drawTitle(best);
      return;
    }
    drawHud(f, sortie, camera);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The valley will wait for you.'], 'Press P to keep flying', PALETTE.panelEdge);
    } else if (screen === SCREEN_OVER) {
      drawPanel(`Crashed — ${sortie.crashReason}`, [`Score ${sortie.score}`], 'Press Space to fly again', PALETTE.gaugeRed);
    } else if (screen === SCREEN_COMPLETE) {
      drawPanel('Sortie complete', scoreLines(sortie), 'Press Space to fly again', PALETTE.gaugeGreen);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, cameraFor, project };
}
