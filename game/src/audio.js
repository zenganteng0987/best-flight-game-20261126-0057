// Synthesised sound, no audio files: a WebAudio engine hum that follows throttle
// and speed, wind that follows airspeed, and short blips for rings, touchdowns
// and crashes. Everything is created lazily on the first user gesture, so the
// page never asks for sound before the player touches it.

export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      context = new AC();
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineGain.connect(context.destination);
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc.connect(engineGain);
      engineOsc.start();
      engineOsc2 = context.createOscillator();
      engineOsc2.type = 'square';
      engineOsc2.frequency.value = 110;
      const gain2 = context.createGain();
      gain2.gain.value = 0.4;
      engineOsc2.connect(gain2);
      gain2.connect(engineGain);
      engineOsc2.start();

      // Wind: a looped noise buffer through a low-pass filter.
      const length = context.sampleRate;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      windFilter = context.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 500;
      windGain = context.createGain();
      windGain.gain.value = 0;
      noise.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(context.destination);
      noise.start();
      return true;
    } catch {
      context = null;
      return false;
    }
  }

  /** Call on any user gesture: starts the context and the engine loop. */
  function unlock() {
    if (!ensure()) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
  }

  /** Called every frame while flying: engine and wind follow the plane. */
  function update(speed, throttle, airborne) {
    if (!context || muted) return;
    const now = context.currentTime;
    const engineLevel = airborne || throttle > 0.05 ? 0.045 + throttle * 0.05 : 0;
    engineGain.gain.setTargetAtTime(engineLevel, now, 0.1);
    engineOsc.frequency.setTargetAtTime(48 + speed * 0.9 + throttle * 26, now, 0.1);
    engineOsc2.frequency.setTargetAtTime(96 + speed * 1.8 + throttle * 52, now, 0.1);
    windGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.0011), now, 0.15);
    windFilter.frequency.setTargetAtTime(300 + speed * 9, now, 0.15);
  }

  function blip(frequency, duration, type, volume, when = 0) {
    if (!context || muted) return;
    try {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const gain = context.createGain();
      const start = context.currentTime + when;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  function ringChime() {
    blip(880, 0.35, 'sine', 0.16);
    blip(1318, 0.4, 'sine', 0.12, 0.07);
  }

  function touchdownThud() {
    blip(70, 0.3, 'sine', 0.3);
    blip(140, 0.18, 'triangle', 0.12, 0.02);
  }

  function crashSound() {
    if (!context || muted) return;
    try {
      const length = context.sampleRate * 0.6;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = 0.35;
      noise.connect(gain);
      gain.connect(context.destination);
      noise.start();
      blip(55, 0.5, 'sine', 0.3);
    } catch {
      // Sound is garnish.
    }
  }

  function clickSound() {
    blip(660, 0.08, 'sine', 0.08);
  }

  function toggleMute() {
    muted = !muted;
    if (context) {
      if (muted) {
        engineGain.gain.value = 0;
        windGain.gain.value = 0;
      }
    }
    return muted;
  }

  return { unlock, update, ringChime, touchdownThud, crashSound, clickSound, toggleMute, isMuted: () => muted };
}
