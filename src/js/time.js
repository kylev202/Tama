// Dates and durations. UI copy is English; the clock (24 or 12-hour, with or without
// seconds), the date order and the first day of the week follow Personalise.
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fullDateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

let prefs = { clock24: true, seconds: false, dates: 'dmy', weekStart: 1 };
let timeFormat;
let clockFormat;
configureTime(prefs);

/** Applies the Personalise choices: `{ clock24, seconds, dates, weekStart }`. */
export function configureTime(next) {
  prefs = { ...prefs, ...next };
  const time = prefs.clock24 ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' };
  timeFormat = new Intl.DateTimeFormat('en-GB', time);
  clockFormat = new Intl.DateTimeFormat('en-GB', prefs.seconds ? { ...time, second: '2-digit' } : time);
}

/** 1 when weeks start on Monday, 0 for Sunday. */
export const weekStart = () => prefs.weekStart;

export const pad = (n) => String(n).padStart(2, '0');

/** "24 Oct", "Oct 24", "24/10", "10/24" or "2026-10-24". */
export function formatShortDate(t, dates = prefs.dates) {
  const d = new Date(t);
  const day = d.getDate();
  const month = d.getMonth();
  if (dates === 'mdy') return `${MONTHS[month]} ${day}`;
  if (dates === 'dmy-num') return `${day}/${month + 1}`;
  if (dates === 'mdy-num') return `${month + 1}/${day}`;
  if (dates === 'iso') return dayKey(t);
  return `${day} ${MONTHS[month]}`;
}

/** The short date with its weekday: "Tue 24 Oct", "Tue, Oct 24", "Tue 2026-10-24". */
export function formatLongDate(t, dates = prefs.dates) {
  const weekday = WEEKDAYS[new Date(t).getDay()];
  return `${weekday}${dates === 'mdy' ? ',' : ''} ${formatShortDate(t, dates)}`;
}

export function startOfDay(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t, days) {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function atTime(dayStart, hours, minutes = 0) {
  const d = new Date(dayStart);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const formatTime = (t) => timeFormat.format(t);
/** The clock in the island's bar: like formatTime, plus seconds when chosen. */
export const formatClockTime = (t) => clockFormat.format(t);
/** "Friday 24 October", for screen readers. */
export const formatFullDate = (t) => fullDateFormat.format(t);
/** "October 2026". */
export const formatMonth = (t) => monthFormat.format(t);

/** "Today", "Tomorrow" or "Wed 22 Oct": a day heading. */
export function formatDay(t, now = Date.now()) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : formatLongDate(t);
}

/** "Today", "Tomorrow", "Fri", "24 Oct", with the time unless the task is all-day. */
export function formatDue(due, allDay, now = Date.now()) {
  const today = startOfDay(now);
  const day = startOfDay(due);
  const diff = Math.round((day - today) / DAY);
  let label;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff === -1) label = 'Yesterday';
  else if (diff > 1 && diff < 7) label = WEEKDAYS[new Date(due).getDay()];
  else label = formatShortDate(due);
  if (allDay) return label;
  return diff === 0 ? formatTime(due) : `${label} ${formatTime(due)}`;
}

/** "25 min", "1 h 20 min". */
export function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Countdown text: "24:13", or "1:02:03" past an hour. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "now", "4 min", "2 h", "Yesterday", "3 Oct". */
export function formatAgo(t, now = Date.now()) {
  const diff = now - t;
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min`;
  if (startOfDay(t) === startOfDay(now)) return `${Math.floor(diff / HOUR)} h`;
  if (startOfDay(t) === addDays(startOfDay(now), -1)) return 'Yesterday';
  return formatShortDate(t);
}

/** "in 12 min", "in 2 h". */
export function formatIn(t, now = Date.now()) {
  const diff = t - now;
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `in ${Math.round(diff / MINUTE)} min`;
  return `in ${Math.round(diff / HOUR)} h`;
}
