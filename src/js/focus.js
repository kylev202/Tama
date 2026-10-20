// Focus sessions (Pomodoro-style). The native scheduler fires the end-of-session alarm,
// so a session finishes on time even when the webview is throttled.
import { commit, recordFocus, state, uid } from './store.js';
import { MINUTE } from './time.js';

export const session = () => state.focus.session;

export const taskOf = (s = session()) => state.tasks.find((task) => task.id === s?.taskId) ?? null;

export function remaining(now = Date.now()) {
  const s = session();
  if (!s) return 0;
  return s.pausedLeft ?? Math.max(0, s.endsAt - now);
}

export function progress(now = Date.now()) {
  const s = session();
  return s ? 1 - remaining(now) / s.length : 0;
}

export function start(kind = 'focus', taskId = null) {
  const minutes = kind === 'focus' ? state.focus.length : state.focus.breakLength;
  const length = minutes * MINUTE;
  const now = Date.now();
  state.focus.session = { id: uid(), kind, taskId, startedAt: now, endsAt: now + length, length, pausedLeft: null };
  commit();
}

export function pause() {
  const s = session();
  if (!s || s.pausedLeft != null) return;
  s.pausedLeft = Math.max(0, s.endsAt - Date.now());
  commit();
}

export function resume() {
  const s = session();
  if (!s || s.pausedLeft == null) return;
  s.endsAt = Date.now() + s.pausedLeft;
  s.pausedLeft = null;
  commit();
}

/** Stops early. Focus time already spent still counts. */
export function stop() {
  const s = session();
  if (!s) return;
  if (s.kind === 'focus') credit(s, s.length - remaining());
  state.focus.session = null;
  commit();
}

/** Finishes the session with this id (the alarm and the local tick may both report it).
 *  Returns the finished session, or null if it was already handled. */
export function finish(id) {
  const s = session();
  if (!s || (id && s.id !== id)) return null;
  if (s.kind === 'focus') credit(s, s.length);
  state.focus.session = null;
  commit();
  return s;
}

function credit(s, ms) {
  const task = taskOf(s);
  recordFocus(task?.list ?? 'free', Math.round(ms / MINUTE));
}
