// Keyboard and pointer input. Held keys give a flight control (-1..1 for pitch
// and roll, throttle up/down); one-shot presses (start, pause, camera, gear,
// mute) are queued as bit flags and taken once by the loop, so a press between
// two frames is never lost and never counted twice. Mouse clicks are reported
// with their canvas coordinates for the title screen's mission cards.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_CAMERA = 4;
export const ACTION_GEAR = 8;
export const ACTION_MUTE = 16;
export const ACTION_RESTART = 32;

const PITCH_UP = new Set(['ArrowUp', 'KeyI']);
const PITCH_DOWN = new Set(['ArrowDown', 'KeyK']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyA', 'KeyJ']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyD', 'KeyL']);
const THROTTLE_UP = new Set(['KeyW']);
const THROTTLE_DOWN = new Set(['KeyS']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const CAMERA = new Set(['KeyC']);
const GEAR = new Set(['KeyG']);
const MUTE = new Set(['KeyM']);
const RESTART = new Set(['KeyR']);
const MISSION_KEYS = new Set(['Digit1', 'Digit2', 'Digit3']);

export function createInput(canvas) {
  let pitchUp = false;
  let pitchDown = false;
  let rollLeft = false;
  let rollRight = false;
  let throttleUp = false;
  let throttleDown = false;
  let actions = 0;
  let missionKey = 0;
  let click = null;

  window.addEventListener('keydown', (event) => {
    if (PITCH_UP.has(event.code)) pitchUp = true;
    else if (PITCH_DOWN.has(event.code)) pitchDown = true;
    else if (ROLL_LEFT.has(event.code)) rollLeft = true;
    else if (ROLL_RIGHT.has(event.code)) rollRight = true;
    else if (THROTTLE_UP.has(event.code)) throttleUp = true;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (CAMERA.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CAMERA;
    } else if (GEAR.has(event.code)) {
      if (!event.repeat) actions |= ACTION_GEAR;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (MISSION_KEYS.has(event.code)) {
      if (!event.repeat) missionKey = Number(event.code.slice(-1));
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (PITCH_UP.has(event.code)) pitchUp = false;
    else if (PITCH_DOWN.has(event.code)) pitchDown = false;
    else if (ROLL_LEFT.has(event.code)) rollLeft = false;
    else if (ROLL_RIGHT.has(event.code)) rollRight = false;
    else if (THROTTLE_UP.has(event.code)) throttleUp = false;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    pitchUp = false;
    pitchDown = false;
    rollLeft = false;
    rollRight = false;
    throttleUp = false;
    throttleDown = false;
  });
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    click = {
      x: ((event.clientX - rect.left) / rect.width) * 1280,
      y: ((event.clientY - rect.top) / rect.height) * 960,
    };
  });

  return {
    /** The flight control this frame: pitch, roll, throttle delta and gear. */
    control(throttle, gearDown) {
      const pitch = (pitchUp ? 1 : 0) - (pitchDown ? 1 : 0);
      const roll = (rollRight ? 1 : 0) - (rollLeft ? 1 : 0);
      let nextThrottle = throttle;
      if (throttleUp) nextThrottle = Math.min(1, throttle + 0.7 / 60);
      if (throttleDown) nextThrottle = Math.max(0, throttle - 0.7 / 60);
      return { pitch, roll, throttle: nextThrottle, gear: gearDown };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** A mission number key (1-3) pressed since the last call, or 0. */
    takeMissionKey() {
      const taken = missionKey;
      missionKey = 0;
      return taken;
    },
    /** A click since the last call, in 1280x960 field coordinates, or null. */
    takeClick() {
      const taken = click;
      click = null;
      return taken;
    },
  };
}
