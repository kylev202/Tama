// Turns tasks, routines and the focus session into alarms for the native scheduler, and
// routes fired alarms back to the right handler.
import { listName } from './dom.js';
import { invoke, listen } from './tauri.js';
import { commit, reminderTime, state, subscribe } from './store.js';
import { addDays, atTime, formatDuration, formatShortDate, formatTime, HOUR, MINUTE, startOfDay } from './time.js';

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The next time a routine runs, at or after a minute ago; null if never again. */
export function nextRun(routine, now = Date.now()) {
  const [hh, mm] = routine.time.split(':').map(Number);
  if (routine.repeat === 'once') {
    if (!routine.date) return null;
    const [y, m, d] = routine.date.split('-').map(Number);
    const at = new Date(y, m - 1, d, hh, mm).getTime();
    return at >= now - MINUTE && routine.lastRun !== at ? at : null;
  }
  for (let i = 0; i < 8; i++) {
    const day = addDays(startOfDay(now), i);
    if (!routine.days.includes(new Date(day).getDay())) continue;
    const at = atTime(day, hh, mm);
    if (at >= now - MINUTE && routine.lastRun !== at) return at;
  }
  return null;
}

/** "Weekdays", "Every day", "Mon, Wed", or "Once, 10 Nov". */
export function describeWhen(routine) {
  if (routine.repeat === 'once') {
    if (!routine.date) return 'Once';
    const [y, m, d] = routine.date.split('-').map(Number);
    return `Once, ${formatShortDate(new Date(y, m - 1, d))}`;
  }
  const days = [...routine.days].sort();
  if (days.length === 7) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.join() === '0,6') return 'Weekends';
  if (!days.length) return 'Never';
  return days.map((d) => DAY_NAMES[d]).join(', ');
}

/** "Opens Unity and Spotify", "Searches YouTube for spaghetti". */
export function describeActions(routine) {
  const parts = routine.actions.map((action) => action.label ?? action.name ?? action.url);
  if (!parts.length) return 'No actions yet';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function alarms(now = Date.now()) {
  const list = [];
  for (const task of state.tasks) {
    if (task.done || task.due == null || task.allDay) continue;
    const at = reminderTime(task);
    if (task.remindedFor === at || at < now - 15 * MINUTE) continue;
    list.push({
      id: `task:${task.id}:${at}`,
      at,
      grace: 15 * MINUTE,
      notify: true,
      title: task.title,
      body: `${listName(task.list)} task, due ${formatTime(task.due)}`,
    });
  }
  for (const routine of state.routines) {
    if (!routine.enabled) continue;
    const at = nextRun(routine, now);
    if (at == null) continue;
    list.push({
      id: `routine:${routine.id}:${at}`,
      at,
      grace: 2 * MINUTE,
      notify: true,
      title: routine.name || 'Routine',
      body: describeActions(routine),
      actions: routine.actions.map((a) => (a.type === 'app' ? { type: 'app', id: a.id } : { type: 'url', url: a.url })),
    });
  }
  const session = state.focus.session;
  if (session && session.pausedLeft == null) {
    const focus = session.kind === 'focus';
    list.push({
      id: `focus:${session.id}:${session.endsAt}`,
      at: session.endsAt,
      grace: 12 * HOUR,
      notify: true,
      title: focus ? 'Focus session done' : 'Break is over',
      body: focus ? `${formatDuration(session.length)} of focus. Time for a break.` : 'Ready for another round?',
    });
  }
  return list;
}

export function startScheduler({ onTask, onRoutine, onFocus }) {
  let timer = 0;
  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(() => invoke('schedule_set', { alarms: alarms() }).catch(console.error), 250);
  };
  subscribe(send);
  send();
  // Routines roll forward to their next day; resend now and then in case an event was missed.
  setInterval(send, 10 * MINUTE);

  listen('alarm', (id) => {
    const [kind, key, at] = id.split(':');
    if (kind === 'task') {
      const task = state.tasks.find((t) => t.id === key);
      if (!task || task.done) return;
      task.remindedFor = Number(at);
      commit();
      onTask(task);
    } else if (kind === 'routine') {
      const routine = state.routines.find((r) => r.id === key);
      if (!routine) return;
      routine.lastRun = Number(at);
      if (routine.repeat === 'once') routine.enabled = false;
      commit();
      onRoutine(routine);
    } else if (kind === 'focus') {
      onFocus(key);
    }
  });
}
