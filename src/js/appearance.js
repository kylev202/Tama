// Personalise: how Tama looks and behaves. The choices live in `state.settings.look` and are
// applied as attributes and custom properties on <html>, so the stylesheets do the styling;
// the island, the soul and the clock hear about changes through `onLook`.
import { media, onMedia } from './media.js';
import { commit, lookDefaults, state, subscribe } from './store.js';
import { configureTime } from './time.js';

/** Accents: id, name, then OKLCH lightness, chroma and hue. All light enough to carry dark
 *  text on a filled button, like the original teal. */
export const ACCENTS = [
  ['teal', 'Teal', 0.84, 0.105, 200],
  ['sky', 'Sky', 0.82, 0.11, 240],
  ['iris', 'Iris', 0.78, 0.12, 278],
  ['violet', 'Violet', 0.79, 0.13, 308],
  ['rose', 'Rose', 0.8, 0.13, 355],
  ['coral', 'Coral', 0.79, 0.14, 32],
  ['amber', 'Amber', 0.85, 0.135, 78],
  ['lime', 'Lime', 0.88, 0.16, 128],
  ['mint', 'Mint', 0.86, 0.12, 165],
  ['silver', 'Silver', 0.88, 0.012, 250],
];
export const STYLES = [
  ['island', 'Island', 'Floats below the top edge'],
  ['notch', 'Notch', 'Joined to the top edge'],
  ['soul', 'Soul', 'Only the soul until you hover'],
];
export const SIZES = [
  ['small', 'Small', 0.9],
  ['default', 'Default', 1],
  ['large', 'Large', 1.1],
];
export const SURFACES = [
  ['black', 'Black'],
  ['graphite', 'Graphite'],
  ['midnight', 'Midnight'],
  ['light', 'Light'],
];
export const DECORATIONS = [
  ['none', 'None'],
  ['glow', 'Glow'],
  ['aurora', 'Aurora'],
  ['stars', 'Stars'],
  ['grain', 'Grain'],
  ['artwork', 'Album art'],
];
export const FONTS = [
  ['segoe', 'Segoe UI'],
  ['bahnschrift', 'Bahnschrift'],
  ['sitka', 'Sitka'],
  ['georgia', 'Georgia'],
  ['cascadia', 'Cascadia'],
];
export const LYRIC_SIZES = [
  ['small', 'Small', '1.125rem'],
  ['default', 'Default', '1.375rem'],
  ['large', 'Large', '1.625rem'],
];
export const DATES = ['dmy', 'mdy', 'dmy-num', 'mdy-num', 'iso'];
export const OPEN_TO = [
  ['last', 'Last used'],
  ['today', 'Tasks'],
  ['music', 'Music'],
];

const listeners = new Set();
let applied = '';

export const look = () => state.settings.look;
const pick = (list, id) => list.find(([key]) => key === id) ?? list[0];
export const scale = () => pick(SIZES, look().size)[2];
export function accent() {
  const [, , l, c, h] = pick(ACCENTS, look().accent);
  return { l, c, h };
}
/** The soul shows in its own style even if it's switched off for the others. */
export const soulShown = () => look().style === 'soul' || look().soul;

export function setLook(patch) {
  Object.assign(state.settings.look, patch);
  commit();
}

export function resetLook() {
  state.settings.look = lookDefaults();
  commit();
}

/** Called with the look straight away and whenever it changes. */
export function onLook(handler) {
  listeners.add(handler);
  handler(look());
}

function apply() {
  const current = look();
  const key = JSON.stringify(current);
  if (key === applied) return;
  applied = key;
  const root = document.documentElement;
  Object.assign(root.dataset, {
    style: current.style,
    surface: current.surface,
    deco: current.decoration,
    font: current.font,
    soul: soulShown() ? 'on' : 'off',
  });
  const { l, c, h } = accent();
  root.style.setProperty('--accent', `oklch(${l} ${c} ${h})`);
  root.style.setProperty('--island-scale', String(scale()));
  root.style.setProperty('--text-lyric', pick(LYRIC_SIZES, current.lyricSize)[2]);
  configureTime({ clock24: current.clock24, seconds: current.seconds, dates: current.dates, weekStart: current.weekStart });
  for (const handler of listeners) handler(current);
}

// The album-art background needs the current cover as a CSS image.
let art = null;
onMedia(() => {
  if (media.art === art) return;
  art = media.art;
  document.documentElement.style.setProperty('--art-image', art ? `url("${art}")` : 'none');
});

apply();
subscribe(apply);
