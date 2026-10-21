// Tama's data: tasks, routines, focus, stats and settings, kept in localStorage.
import { addDays, atTime, dayKey, startOfDay } from './time.js';

const KEY = 'tama.v1';

const defaults = () => ({
  tasks: [],
  routines: [],
  focus: { length: 25, breakLength: 5, session: null },
  // done[day] = { work, study } tasks completed; focus[day] = { work, study, free } minutes
  stats: { done: {}, focus: {} },
  settings: {
    sounds: true,
    wallpaperFolder: null,
    pinnedApps: [],
    tab: 'today',
    more: 'clipboard', // last section opened under More
    view: 'today',
    list: 'work',
    lyrics: true, // look lyrics up on LRCLIB and show them
    hidden: false, // the island is put away as a small icon
    look: lookDefaults(),
  },
});

/** Personalise: how Tama looks and behaves. See appearance.js for the choices. */
export const lookDefaults = () => ({
  style: 'island', // island | notch | cat
  size: 'default', // small | default | large
  cat: true,
  antics: true, // the cat yawns, stretches, naps and plays now and then
  standby: 'clock', // what rests where the cat sits while it's off: none | clock | digits | hourglass | breathe | orbit
  accent: 'teal',
  surface: 'black', // black | graphite | midnight | light
  decoration: 'none', // none | glow | aurora | stars | grain | artwork
  font: 'segoe',
  lyricSize: 'default',
  clock24: true,
  seconds: false,
  restClock: false,
  dates: 'dmy', // dmy | mdy | dmy-num | mdy-num | iso
  weekStart: 1, // 1 Monday, 0 Sunday
  hoverPeek: true,
  peekLyrics: true,
  openTo: 'last', // last | today | music
});

// Fields added after 0.1, so older saved tasks get them too.
const taskDefaults = () => ({ notes: '', subtasks: [], repeat: null, repeatOf: null });

/** Settings saved before 2026-10-21 use the cat's old name for its style and switch. */
function renameOldLook(look) {
  if (look.style === 'soul') look.style = 'cat';
  if ('soul' in look) look.cat = look.soul;
  delete look.soul;
  return look;
}

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved) {
      return {
        ...base,
        ...saved,
        tasks: (saved.tasks ?? []).map((task) => ({ ...taskDefaults(), ...task })),
        focus: { ...base.focus, ...saved.focus },
        stats: { ...base.stats, ...saved.stats },
        settings: { ...base.settings, ...saved.settings, look: renameOldLook({ ...base.settings.look, ...saved.settings?.look }) },
      };
    }
  } catch (error) {
    console.error('Tama could not read its saved data', error);
  }
  return base;
}

export const state = load();
const listeners = new Set();
let saveTimer = 0;

/** Call after changing `state`: saves (debounced) and notifies subscribers. */
export function commit() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 150);
  for (const listener of listeners) listener(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function save() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Tama could not save', error);
  }
}

addEventListener('pagehide', save);

export const uid = () => crypto.randomUUID();

/* Tasks */

export function addTask({ title, list = 'work', due = null, allDay = false, priority = 0, repeat = null }) {
  const task = {
    ...taskDefaults(),
    id: uid(),
    title,
    list,
    due,
    allDay,
    priority,
    repeat: due == null ? null : repeat,
    done: false,
    doneAt: null,
    createdAt: Date.now(),
    remindedFor: null,
    snoozedUntil: null,
  };
  state.tasks.push(task);
  commit();
  return task;
}

export function updateTask(task, patch) {
  Object.assign(task, patch);
  if ('due' in patch || 'allDay' in patch) {
    task.snoozedUntil = null;
    task.remindedFor = null;
  }
  if (task.due == null) task.repeat = null; // a repeat counts from a date
  commit();
}

/** Ticks a task off (or back on). Finishing a repeating task returns the done copy it
 *  leaves behind, while the task itself moves on to its next date; un-ticking that copy
 *  undoes the whole thing. */
export function setDone(task, done) {
  if (task.done === done) return null;
  if (done && task.repeat && task.due != null) return completeRepeating(task);
  const original = !done && task.repeatOf ? state.tasks.find((t) => t.id === task.repeatOf && t.repeat && !t.done) : null;
  if (original) {
    reopenRepeating(task, original);
    return null;
  }
  countDone(task, done ? Date.now() : task.doneAt ?? Date.now(), done ? 1 : -1);
  task.done = done;
  task.doneAt = done ? Date.now() : null;
  commit();
  return null;
}

function countDone(task, at, delta) {
  const day = (state.stats.done[dayKey(at)] ??= { work: 0, study: 0 });
  day[task.list] = Math.max(0, (day[task.list] ?? 0) + delta);
}

function completeRepeating(task) {
  const now = Date.now();
  const copy = { ...task, id: uid(), done: true, doneAt: now, repeat: null, repeatOf: task.id, subtasks: task.subtasks.map((s) => ({ ...s })) };
  task.due = nextDue(task, now);
  task.subtasks = task.subtasks.map((s) => ({ ...s, done: false }));
  task.remindedFor = task.snoozedUntil = null;
  state.tasks.splice(state.tasks.indexOf(task) + 1, 0, copy);
  countDone(copy, now, 1);
  commit();
  return copy;
}

function reopenRepeating(copy, original) {
  Object.assign(original, {
    due: copy.due,
    allDay: copy.allDay,
    subtasks: copy.subtasks,
    remindedFor: copy.remindedFor,
    snoozedUntil: copy.snoozedUntil,
  });
  countDone(copy, copy.doneAt, -1);
  state.tasks.splice(state.tasks.indexOf(copy), 1);
  commit();
}

/* Repeats */

export const REPEATS = [
  ['daily', 'Daily'],
  ['weekdays', 'Weekdays'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
];

export const repeatName = (repeat) => REPEATS.find(([id]) => id === repeat)?.[1] ?? '';

/** The next date of a repeating task: at least one step on from its due date, and past
 *  now (past today for all-day tasks), so finishing a late one doesn't leave it overdue. */
export function nextDue(task, now = Date.now()) {
  const after = task.allDay ? startOfDay(now) : now;
  let due = task.due;
  do due = stepRepeat(due, task.repeat);
  while (due <= after);
  return due;
}

export function stepRepeat(t, repeat) {
  if (repeat === 'weekly') return addDays(t, 7);
  if (repeat === 'monthly') {
    const d = new Date(t);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); // the 31st → the 30th
    return d.getTime();
  }
  let next = addDays(t, 1);
  if (repeat === 'weekdays') while ([0, 6].includes(new Date(next).getDay())) next = addDays(next, 1);
  return next;
}

/** Moves late tasks to today. Timed ones keep their time if it's still ahead, otherwise
 *  they become all-day, so they don't land straight back in Overdue. Returns an undo. */
export function moveToToday(tasks, now = Date.now()) {
  const before = tasks.map((t) => [t, { due: t.due, allDay: t.allDay, remindedFor: t.remindedFor, snoozedUntil: t.snoozedUntil }]);
  const today = startOfDay(now);
  for (const task of tasks) {
    const d = new Date(task.due);
    const at = atTime(today, d.getHours(), d.getMinutes());
    if (!task.allDay && at > now) task.due = at;
    else [task.due, task.allDay] = [today, true];
    task.remindedFor = task.snoozedUntil = null;
  }
  commit();
  return () => {
    for (const [task, previous] of before) Object.assign(task, previous);
    commit();
  };
}

/** Removes a task and returns a function that puts it back. */
export function removeTask(task) {
  const index = state.tasks.indexOf(task);
  if (index < 0) return () => {};
  state.tasks.splice(index, 1);
  commit();
  return () => {
    state.tasks.splice(Math.min(index, state.tasks.length), 0, task);
    commit();
  };
}

export function snooze(task, minutes) {
  task.snoozedUntil = Date.now() + minutes * 60_000;
  commit();
}

/** When a task's reminder fires: its due time, or later if snoozed. */
export const reminderTime = (task) => task.snoozedUntil ?? task.due;

/** Overdue: past its time (timed tasks) or before today (all-day tasks). */
export function isOverdue(task, now = Date.now()) {
  if (task.done || task.due == null) return false;
  return task.allDay ? task.due < startOfDay(now) : task.due < now;
}

export function openTasks() {
  return state.tasks.filter((task) => !task.done);
}

/* Progress */

/** Today's done count against everything due today (overdue included). */
export function todayProgress(now = Date.now()) {
  const start = startOfDay(now);
  const end = addDays(start, 1);
  let done = 0;
  let open = 0;
  for (const task of state.tasks) {
    if (task.done && task.doneAt >= start) done++;
    else if (!task.done && task.due != null && task.due < end) open++;
  }
  return { done, total: done + open };
}

/** Consecutive days with study progress (a study task done or study focus time). Today
 *  without progress yet doesn't break the streak. */
export function studyStreak(now = Date.now()) {
  const active = (t) => {
    const key = dayKey(t);
    return (state.stats.done[key]?.study ?? 0) > 0 || (state.stats.focus[key]?.study ?? 0) > 0;
  };
  let day = startOfDay(now);
  if (!active(day)) day = addDays(day, -1);
  let streak = 0;
  while (streak < 3650 && active(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export function recordFocus(list, minutes, at = Date.now()) {
  if (minutes <= 0) return;
  const day = (state.stats.focus[dayKey(at)] ??= { work: 0, study: 0, free: 0 });
  day[list] = (day[list] ?? 0) + minutes;
  commit();
}
