// Two quiet sounds, synthesised so there are no audio files: a chime for alerts and a soft
// tick for completing a task. Both respect the Sounds setting.
import { state } from './store.js';

let context = null;

function audio() {
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume();
  return context;
}

function tone(ac, frequency, start, length, peak) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

export function chime() {
  if (!state.settings.sounds) return;
  const ac = audio();
  const t = ac.currentTime + 0.02;
  tone(ac, 659.25, t, 1.1, 0.09); // E5
  tone(ac, 987.77, t + 0.13, 1.3, 0.07); // B5
}

export function tick() {
  if (!state.settings.sounds) return;
  const ac = audio();
  tone(ac, 1318.5, ac.currentTime + 0.01, 0.18, 0.035);
}
