// Lyrics for whatever is playing. The native side looks them up on LRCLIB and caches them
// on disk; this module parses them and keeps a line clock that wakes exactly when the next
// line starts, instead of polling every frame.
import { media, onMedia } from './media.js';
import { state, subscribe } from './store.js';
import { invoke } from './tauri.js';

/** Lines light up this much early, so the motion lands as the words start. */
const LEAD = 180;
/** A pause this long between lines shows the breathing dots. */
export const INTERLUDE = 4500;
/** Players publish the title first and the album and length a beat later. */
const SETTLE = 350;

export const lyrics = {
  /** off | idle | loading | synced | plain | instrumental | missing | error */
  status: 'idle',
  /** Synced lines, `{ time, end, text }` in ms; an interlude has empty text. */
  lines: [],
  plain: '',
  /** The line being sung, or -1 before the first one. */
  index: -1,
};

const songListeners = new Set();
const lineListeners = new Set();
const memo = new Map(); // song → parsed lyrics, for this session (the disk cache is native)
let song = '';
let request = 0;
let settle = 0;
let clock = 0;

/** Called when the song's lyrics change (new song, loaded, failed). */
export function onLyrics(handler) {
  songListeners.add(handler);
  handler(lyrics);
  return () => songListeners.delete(handler);
}

/** Called with the new index whenever the current line changes. */
export function onLine(handler) {
  lineListeners.add(handler);
  return () => lineListeners.delete(handler);
}

export const currentLine = () => lyrics.lines[lyrics.index] ?? null;

/** Looks the current song up again, after a failure. */
export function retry() {
  memo.delete(song);
  song = '';
  refresh();
}

const songKey = (now) => `${now.title}\u001f${now.artist}\u001f${now.album ?? ''}`;

function set(next) {
  Object.assign(lyrics, next, { index: -1 });
  for (const handler of songListeners) handler(lyrics);
  tick();
}

function refresh() {
  const now = media.now;
  const status = !state.settings.lyrics ? 'off' : !now?.title ? 'idle' : null;
  if (status) {
    clearTimeout(settle);
    song = '';
    if (lyrics.status !== status) set({ status, lines: [], plain: '' });
    return;
  }
  const key = songKey(now);
  if (key === song) return tick(); // same song: only the position or play state moved
  song = key;
  clearTimeout(settle);
  if (memo.has(key)) return set(memo.get(key));
  if (lyrics.status !== 'loading') set({ status: 'loading', lines: [], plain: '' });
  settle = setTimeout(() => load(key), SETTLE);
}

async function load(key) {
  const id = ++request;
  const now = media.now;
  if (!now || songKey(now) !== key) return;
  try {
    const found = await invoke('lyrics_get', { title: now.title, artist: now.artist, album: now.album ?? '', duration: now.duration ?? 0 });
    const parsed = parse(found, now.duration);
    memo.set(key, parsed);
    if (id === request && song === key) set(parsed);
  } catch {
    if (id === request && song === key) set({ status: 'error', lines: [], plain: '' });
  }
}

function parse({ synced, plain, instrumental }, duration) {
  const lines = synced ? parseLrc(synced, duration) : [];
  if (lines.some((line) => line.text)) return { status: 'synced', lines, plain: '' };
  if (plain?.trim()) return { status: 'plain', lines: [], plain: plain.trim() };
  if (instrumental) return { status: 'instrumental', lines: [], plain: '' };
  return { status: 'missing', lines: [], plain: '' };
}

/** "[01:02.34] words" → `{ time: 62340, text: 'words' }`. Several stamps on one line repeat
 *  it, an [offset:] tag shifts everything, word stamps like <01:02.34> are dropped, and an
 *  empty line only becomes an interlude when the pause is long enough to notice. */
export function parseLrc(text, duration = 0) {
  let offset = 0;
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const shift = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (shift) {
      offset = Number(shift[1]);
      continue;
    }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = raw
      .replace(/\[[^\]]*\]/g, '')
      .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    for (const [, minutes, seconds] of stamps) {
      // A positive offset means the words come earlier.
      const time = Number(minutes) * 60_000 + Number(seconds.replace(':', '.')) * 1000 - offset;
      entries.push({ time: Math.max(0, Math.round(time)), text: words });
    }
  }
  entries.sort((a, b) => a.time - b.time);
  while (entries.length && !entries.at(-1).text) entries.pop(); // nothing to show after the last words
  if (entries.length && entries[0].time >= INTERLUDE) entries.unshift({ time: 0, text: '' }); // the intro

  const kept = [];
  for (const [i, entry] of entries.entries()) {
    if (!entry.text) {
      if (kept.at(-1)?.text === '') continue; // one interlude per pause
      const resume = entries.slice(i + 1).find((e) => e.text);
      // A short blank only marks where a line stops; the line simply stays lit.
      if (!resume || resume.time - entry.time < INTERLUDE) continue;
    }
    kept.push(entry);
  }
  return kept.map((entry, i) => ({ ...entry, end: kept[i + 1]?.time ?? Math.max(duration, entry.time + 4000) }));
}

function indexAt(position) {
  const lines = lyrics.lines;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= position) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** Moves to the line at the current position, then sleeps until the next one is due. */
function tick() {
  clearTimeout(clock);
  if (lyrics.status !== 'synced') return;
  const position = media.position() + LEAD;
  const index = indexAt(position);
  if (index !== lyrics.index) {
    lyrics.index = index;
    for (const handler of lineListeners) handler(index);
  }
  const next = lyrics.lines[index + 1];
  if (media.now?.playing && next) clock = setTimeout(tick, Math.max(20, next.time - position));
}

onMedia(refresh);
subscribe(() => {
  if (!state.settings.lyrics !== (lyrics.status === 'off')) refresh();
});
