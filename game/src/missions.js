// The sortie around the flight model: which mission is flying, the score, the
// messages the pilot sees, and when the sortie is done. Scoring is plain and
// shown on the end screen: rings, centre bonuses, a landing bonus, time and
// fuel left.

import { EVENT_COMPLETE, EVENT_CRASH, EVENT_FUEL_EMPTY, EVENT_LANDED, EVENT_RING, EVENT_RING_MISSED, EVENT_TOUCHDOWN } from './flight.js';
import { wrapAngle } from './terrain.js';

export const RING_POINTS = 100;
export const LANDING_MAX_BONUS = 400;

/**
 * A message shown to the pilot: text, the second it appeared, and how long it lives.
 */
function pushMessage(sortie, text, life = 3) {
  sortie.messages.push({ text, at: sortie.time, life });
  if (sortie.messages.length > 4) sortie.messages.shift();
}

export function createSortie(mission, flight) {
  const sortie = {
    mission,
    flight,
    score: 0,
    time: 0,
    timeBonus: 0,
    fuelBonus: 0,
    landingBonus: 0,
    ringBonus: 0,
    status: 'flying',
    crashReason: '',
    messages: [],
  };

  function landingBonus() {
    const f = flight.state;
    const sink = Math.abs(f.touchdownSink);
    const soft = Math.max(0, 1 - sink / 7);
    const aligned = 1 - Math.min(1, Math.abs(wrapAngle(f.heading)) / 0.35);
    return Math.round(LANDING_MAX_BONUS * (0.5 * soft + 0.5 * aligned));
  }

  function finish() {
    sortie.timeBonus = Math.max(0, Math.round((mission.parTime - sortie.time) * 3));
    sortie.fuelBonus = Math.round(flight.state.fuel * 1.5);
    sortie.score += sortie.timeBonus + sortie.fuelBonus;
    sortie.status = 'complete';
  }

  /**
   * Feed one step's events in; returns nothing, the sortie's score and messages
   * carry the result. `dt` advances the sortie clock.
   */
  function applyEvents(events, dt) {
    sortie.time += dt;
    const f = flight.state;
    if (events & EVENT_RING) {
      sortie.score += RING_POINTS + f.lastRingBonus;
      sortie.ringBonus += f.lastRingBonus;
      pushMessage(sortie, `RING ${f.ringsPassed}/${f.rings.length}  +${RING_POINTS + f.lastRingBonus}`);
    }
    if (events & EVENT_RING_MISSED) {
      pushMessage(sortie, `RING MISSED — next ring ${f.ringIndex + 1}/${f.rings.length}`);
    }
    if (events & EVENT_TOUCHDOWN) {
      // One landing bonus a sortie: a bounce is not a second landing.
      if (sortie.landingBonus === 0) {
        sortie.landingBonus = landingBonus();
        sortie.score += sortie.landingBonus;
      }
      pushMessage(sortie, `TOUCHDOWN  +${sortie.landingBonus}`);
    }
    if (events & EVENT_LANDED) {
      pushMessage(sortie, 'LANDED — sortie complete');
    }
    if (events & EVENT_FUEL_EMPTY) {
      pushMessage(sortie, 'FUEL EMPTY — gliding', 4);
    }
    if (events & EVENT_CRASH) {
      sortie.status = 'crashed';
      sortie.crashReason = f.crashReason;
    }
    if (events & EVENT_COMPLETE) {
      if (sortie.status !== 'complete') finish();
    }
    if (f.status === 'complete' && sortie.status !== 'complete') finish();
    if (f.status === 'crashed' && sortie.status !== 'crashed') {
      sortie.status = 'crashed';
      sortie.crashReason = f.crashReason;
    }
    // Drop messages older than their life.
    sortie.messages = sortie.messages.filter((m) => sortie.time - m.at < m.life);
  }

  return { sortie, applyEvents };
}

/** The end screen's score lines, in order, for the sortie that just finished. */
export function scoreLines(sortie) {
  const f = sortie.flight.state;
  const lines = [
    `Rings flown  ${f.ringsPassed} of ${f.rings.length}  (+${f.ringsPassed * RING_POINTS + sortie.ringBonus})`,
    `Time  ${Math.floor(sortie.time / 60)}:${String(Math.floor(sortie.time % 60)).padStart(2, '0')}  (+${sortie.timeBonus})`,
    `Fuel left  ${Math.round(f.fuel)}%  (+${sortie.fuelBonus})`,
  ];
  if (sortie.landingBonus > 0) lines.push(`Landing  (+${sortie.landingBonus})`);
  if (f.ringsMissed > 0) lines.push(`Rings missed  ${f.ringsMissed}`);
  lines.push(`TOTAL  ${sortie.score}`);
  return lines;
}
