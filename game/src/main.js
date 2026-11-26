// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between five screens: title, play,
// paused, sortie complete and crashed. The title screen flies itself: the
// autopilot runs a demo sortie behind the mission cards.
//
// ?shot=cover|cockpit|rings|landing stages that scene instead of running the
// loop, paints it twice and sets window.__shotReady for a screenshot.

import { BEST_KEY, MISSIONS, STEP } from './config.js';
import { createAudio } from './audio.js';
import { createFlight, EVENT_CRASH, EVENT_RING, EVENT_TOUCHDOWN } from './flight.js';
import { ACTION_CAMERA, ACTION_CONFIRM, ACTION_GEAR, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createSortie } from './missions.js';
import { CAMERA_CHASE, CAMERA_COCKPIT, MISSION_CARDS, SCREEN_COMPLETE, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, createRenderer } from './render.js';
import { autopilotControls, stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return JSON.parse(window.localStorage.getItem(BEST_KEY) ?? '{}') || {};
  } catch {
    return {};
  }
}

function saveBest(best) {
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // Storage can be off (private windows): best scores then last this visit only.
  }
}

function runShot(name) {
  const staged = stageShot(name);
  let painted = 0;
  function paint() {
    renderer.draw({
      flight: staged.flight,
      sortie: staged.sortie,
      screen: staged.screen,
      camera: staged.camera,
      best: staged.best,
    });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else {
      window.__shotReady = true;
      window.__shotInfo = staged.stoppedAt;
    }
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let camera = CAMERA_CHASE;
  let best = readBest();
  let mission = MISSIONS[0];
  let flight = createFlight(mission);
  let sortiePair = createSortie(mission, flight);
  let sortie = sortiePair.sortie;
  let accumulator = 0;
  let last = performance.now();
  let throttle = 0;
  let gearDown = true;

  // The title screen's demo: mission 1 flown by the autopilot, behind the cards.
  let demoFlight = createFlight(MISSIONS[0]);
  let demoSortiePair = createSortie(MISSIONS[0], demoFlight);
  let demoSortie = demoSortiePair.sortie;

  function announce(message) {
    status.textContent = message;
  }

  function startMission(nextMission) {
    mission = nextMission;
    flight = createFlight(mission);
    sortiePair = createSortie(mission, flight);
    sortie = sortiePair.sortie;
    throttle = 0;
    gearDown = true;
    camera = CAMERA_CHASE;
    screen = SCREEN_PLAY;
    audio.unlock();
    announce(`${mission.name}. Throttle up with W, rotate at 65 knots.`);
  }

  function endSortie() {
    if (sortie.status === 'complete') {
      screen = SCREEN_COMPLETE;
      const score = sortie.score;
      if (score > (best[mission.id] || 0)) {
        best[mission.id] = score;
        saveBest(best);
      }
      announce(`Sortie complete. Score ${score}.`);
    } else if (sortie.status === 'crashed') {
      screen = SCREEN_OVER;
      announce(`Crashed: ${sortie.crashReason}. Score ${sortie.score}.`);
    }
  }

  function stepDemo() {
    const events = demoFlight.step(STEP, autopilotControls(demoFlight));
    demoSortiePair.applyEvents(events, STEP);
    if (demoFlight.state.status !== 'flying') {
      demoFlight = createFlight(MISSIONS[0]);
      demoSortiePair = createSortie(MISSIONS[0], demoFlight);
      demoSortie = demoSortiePair.sortie;
    }
  }

  function stepPlay() {
    const controls = input.control(throttle, gearDown);
    throttle = controls.throttle;
    gearDown = controls.gear;
    const events = flight.step(STEP, controls);
    sortiePair.applyEvents(events, STEP);
    audio.update(flight.state.speed, flight.state.throttle, flight.state.airborne);
    if (events & EVENT_RING) audio.ringChime();
    if (events & EVENT_TOUCHDOWN) audio.touchdownThud();
    if (events & EVENT_CRASH) audio.crashSound();
    if (sortie.status !== 'flying') endSortie();
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_CAMERA && screen === SCREEN_PLAY) {
      camera = camera === CAMERA_CHASE ? CAMERA_COCKPIT : CAMERA_CHASE;
    }
    if (actions & ACTION_GEAR && screen === SCREEN_PLAY) {
      gearDown = !gearDown;
    }
    if (actions & ACTION_RESTART && (screen === SCREEN_OVER || screen === SCREEN_COMPLETE)) {
      startMission(mission);
      return;
    }
    if (actions & ACTION_CONFIRM && (screen === SCREEN_OVER || screen === SCREEN_COMPLETE)) {
      startMission(mission);
      return;
    }
    if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Flying.');
    }
    if (screen === SCREEN_TITLE) {
      const key = input.takeMissionKey();
      if (key >= 1 && key <= 3) {
        audio.clickSound();
        startMission(MISSIONS[key - 1]);
        return;
      }
      const click = input.takeClick();
      if (click) {
        for (const card of MISSION_CARDS) {
          if (click.x >= card.x && click.x <= card.x + card.width && click.y >= card.y && click.y <= card.y + card.height) {
            audio.clickSound();
            startMission(MISSIONS.find((m) => m.id === card.id));
            return;
          }
        }
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE) {
      while (accumulator >= STEP) {
        stepDemo();
        accumulator -= STEP;
      }
      renderer.draw({ flight: demoFlight, sortie: demoSortie, screen, camera, best });
    } else if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        stepPlay();
        accumulator -= STEP;
      }
      renderer.draw({ flight, sortie, screen, camera, best });
    } else {
      accumulator = 0;
      renderer.draw({ flight, sortie, screen, camera, best });
    }
  }

  // Leaving the tab pauses a running game rather than letting the plane fly unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Skylane Ridge. Pick a mission to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
