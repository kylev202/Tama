// The website's handle on the demo island (window.tamaDemo). It imports the app's own
// modules, so it drives the same state the island shows: open a tab, run a section's scene
// (focus, music, a reminder), add a task, change the look. The page is same-origin and
// calls it directly.
import { ACCENTS, DECORATIONS, setLook, STYLES, SURFACES } from './js/appearance.js';
import * as focus from './js/focus.js';
import { lyrics, onLine, onLyrics } from './js/lyrics.js';
import { control, media, onMedia, seek } from './js/media.js';
import { addTask, reminderTime, state, subscribe } from './js/store.js';
import { addDays, startOfDay } from './js/time.js';

const bridge = window.__tamaBridge;
const island = document.getElementById('island');
const bar = document.getElementById('bar');
const isOpen = () => island.dataset.state === 'open';

/** Opens the island, on a tab or a section under More. */
function open(tab) {
  if (!isOpen()) bar.click();
  if (!tab) return;
  if (!document.getElementById(`tab-${tab}`)) document.getElementById('tab-more')?.click();
  document.getElementById(`tab-${tab}`)?.click();
}

function close() {
  if (isOpen()) bar.click();
}

const byTitle = (title) => state.tasks.find((t) => t.title === title && !t.done);

/* Focus. A session the page started is the page's to stop when music takes over, since
   the resting island shows focus ahead of music. */
let pageFocus = null;

function startFocus() {
  if (!focus.session()) {
    focus.start('focus', byTitle('Read chapter 4: graphs')?.id ?? null);
    pageFocus = focus.session().id;
  }
}

function play() {
  if (pageFocus && focus.session()?.id === pageFocus) focus.stop();
  pageFocus = null;
  bridge.play();
}

/** A reminder, as if the next timed task just came due. */
function remind() {
  const soon = state.tasks.find((t) => t.id === bridge.soonTask && !t.done) ?? state.tasks.find((t) => !t.done && t.due != null && !t.allDay);
  if (soon) bridge.remind(`task:${soon.id}:${reminderTime(soon)}`);
}

/** Adds a parsed quick-add task and shows it in the view where it lands. */
function add({ title, list: chosen, priority, due, allDay, repeat }) {
  const list = chosen ?? 'work';
  const tomorrow = addDays(startOfDay(), 1);
  state.settings.view = due == null ? list : due < tomorrow ? 'today' : due < addDays(tomorrow, 6) ? 'upcoming' : 'calendar';
  const task = addTask({ title, list, due, allDay, priority: priority ?? 0, repeat }); // commits, so the panel redraws
  open('today');
  return task;
}

window.tamaDemo = {
  open,
  close,
  isOpen,
  rect: () => bridge.rect,
  focus: {
    start: startFocus,
    pause: focus.pause,
    resume: focus.resume,
    stop() {
      focus.stop();
      pageFocus = null;
    },
    session: focus.session,
    remaining: focus.remaining,
    progress: focus.progress,
    task: () => focus.taskOf(),
  },
  music: {
    play,
    pause: bridge.pause,
    seek,
    control,
    media,
    lyrics,
    onLine,
    onLyrics,
    onMedia,
  },
  remind,
  add,
  choices: { accent: ACCENTS, style: STYLES, surface: SURFACES, decoration: DECORATIONS },
  look: () => state.settings.look,
  setLook,
  /** Hears every change to tasks, focus and settings. */
  subscribe,
};

try {
  parent.tamaSite?.ready?.(window.tamaDemo);
} catch {
  // Opened on its own.
}
