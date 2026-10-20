// Now playing, mirrored from the native media session watcher.
import { invoke, listen } from './tauri.js';

const subscribers = new Set();
let now = null;
let art = null;
let tint = null;
let artVersion = -1;

export const media = {
  get now() {
    return now;
  },
  get art() {
    return art;
  },
  /** A bright version of the artwork's dominant colour, or null for grey artwork. */
  get tint() {
    return tint;
  },
  /** Current position in ms, extrapolated while playing. */
  position() {
    if (!now) return 0;
    const position = now.playing ? now.position + (Date.now() - now.updatedAt) : now.position;
    return now.duration ? Math.min(position, now.duration) : position;
  },
};

export function onMedia(handler) {
  subscribers.add(handler);
  handler(media);
  return () => subscribers.delete(handler);
}

export const control = (action) => invoke('media_control', { action });

/** Jumps to `ms`. The position moves at once, so lyrics follow without waiting for the
 *  player to report back. */
export function seek(ms) {
  if (!now?.canSeek) return;
  now = { ...now, position: Math.max(0, Math.round(ms)), updatedAt: Date.now() };
  for (const handler of subscribers) handler(media);
  invoke('media_seek', { position: now.position }).catch(() => {});
}

async function update(next) {
  now = next;
  if (!next) {
    art = tint = null;
    artVersion = -1;
  } else if (next.artVersion !== artVersion) {
    artVersion = next.artVersion;
    const version = artVersion;
    const fetched = await invoke('media_art').catch(() => null);
    if (version !== artVersion) return; // a newer update won the race
    art = fetched;
    tint = art ? await dominantTint(art) : null;
  }
  for (const handler of subscribers) handler(media);
}

/** Averages the artwork down to one colour and lifts it so it reads on black. */
function dominantTint(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = new OffscreenCanvas(8, 8);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const w = (max - min) / 255 + 0.05; // favour colourful pixels
        r += data[i] * w;
        g += data[i + 1] * w;
        b += data[i + 2] * w;
        weight += w;
      }
      [r, g, b] = [r / weight, g / weight, b / weight].map(Math.round);
      const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
      resolve(saturation < 0.18 ? null : `oklch(from rgb(${r} ${g} ${b}) var(--tint-l) max(c, 0.12) h)`);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

invoke('media_now').then(update).catch(() => {});
listen('media', update);
