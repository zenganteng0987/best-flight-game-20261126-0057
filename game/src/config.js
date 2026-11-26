// Every tuning number, colour and mission in one place. The playfield is a fixed
// 1280x960 logical area; the renderer scales it to the window, so no rule below
// depends on the screen size. Distances are metres, speeds metres per second,
// headings radians (0 = north, +z), altitude metres above the valley floor.

export const FIELD = { width: 1280, height: 960 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLANE = {
  stallSpeed: 27,
  minSpeed: 0,
  maxSpeed: 130,
  /** Speed at throttle 0 and at throttle 1, before the climb penalty. */
  idleSpeed: 24,
  fullSpeed: 112,
  /** How fast speed chases its throttle target, per second. */
  speedResponse: 0.35,
  /** Speed lost per second of climb (sin of pitch times this). */
  climbPenalty: 14,
  /** Pitch rate from full stick, radians per second. */
  pitchRate: 0.5,
  maxPitch: 0.55,
  /** Roll rate from full stick, radians per second. */
  rollRate: 1.9,
  maxRoll: 1.15,
  /** Speed that lifts the wheels off the runway. */
  rotateSpeed: 33,
  /** Touchdown limits for a landing that counts. */
  landingMaxSpeed: 62,
  landingMaxSink: 7,
  landingMaxRoll: 0.3,
  landingMaxHeadingError: 0.35,
  /** Fuel burn, percent per second: idle plus full throttle. */
  fuelIdle: 0.1,
  fuelFull: 0.45,
  /** Braking on the runway, metres per second squared. */
  brake: 10,
};

export const RING_RADIUS = 34;

/** One mission: a name, its rings, its fuel, its par time and whether it ends on the runway. */
export const MISSIONS = [
  {
    id: 1,
    name: 'Ring Run',
    short: 'RING RUN',
    description: 'Six rings over the valley. Fly them all, then the sortie is done.',
    parTime: 150,
    fuel: 100,
    requiresLanding: false,
    rings: [
      { x: 0, y: 150, z: 900 },
      { x: 600, y: 200, z: 1200 },
      { x: 900, y: 220, z: 400 },
      { x: 500, y: 160, z: -600 },
      { x: -400, y: 180, z: -800 },
      { x: -700, y: 150, z: 200 },
    ],
  },
  {
    id: 2,
    name: 'Ridge Tour',
    short: 'RIDGE TOUR',
    description: 'Eight rings, up through the north pass. Thin air, tight fuel.',
    parTime: 210,
    fuel: 85,
    requiresLanding: false,
    rings: [
      { x: 0, y: 180, z: 1000 },
      { x: 400, y: 260, z: 1800 },
      { x: -200, y: 330, z: 2400 },
      { x: -800, y: 310, z: 2000 },
      { x: -1200, y: 260, z: 1200 },
      { x: -900, y: 200, z: 300 },
      { x: -300, y: 160, z: -500 },
      { x: 200, y: 140, z: -200 },
    ],
  },
  {
    id: 3,
    name: 'Valley Landing',
    short: 'VALLEY LANDING',
    description: 'Four rings, then bring her home: land on runway 36, gear down, gentle.',
    parTime: 180,
    fuel: 100,
    requiresLanding: true,
    rings: [
      { x: 0, y: 150, z: 800 },
      { x: 500, y: 180, z: 600 },
      { x: 300, y: 150, z: -300 },
      { x: -100, y: 120, z: -700 },
    ],
  },
];

export const PALETTE = {
  skyTop: '#5f9fd8',
  skyMid: '#8fc3e8',
  skyLow: '#dceefb',
  sun: '#fff3c4',
  cloud: '#ffffff',
  terrainFar: '#8aa88f',
  terrainMid: '#6b8f66',
  terrainNear: '#55794a',
  terrainLow: '#46683c',
  mountain: '#7d8ba0',
  runway: '#3a3f46',
  runwayEdge: '#f2f2ea',
  ringNext: '#ffb020',
  ringOther: '#9fd8ff',
  ringPassed: '#7ddb8a',
  planeCream: '#f2ead8',
  planeRed: '#d94f3d',
  planeDark: '#2c2f36',
  canopy: '#9fd4e8',
  panel: '#1c2430',
  panelEdge: '#39445a',
  gaugeFace: '#10151d',
  gaugeAmber: '#ffb020',
  gaugeGreen: '#7ddb8a',
  gaugeRed: '#e5534b',
  hudText: '#ffffff',
  hudDim: '#cfe0ee',
  hudWarn: '#ffb020',
  title: '#ffffff',
  muted: '#d7e4ef',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Where the best score per mission is kept between visits (this browser only). */
export const BEST_KEY = 'skylane-ridge.best';
