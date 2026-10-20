// Quick add: pulls the list, priority, day and time out of a one-line task.
//   "Essay draft fri 9am #study !high" → title "Essay draft", Study, high, Friday 09:00
// Only whole words are taken, so "Review today's notes" keeps its title.
import { addDays, atTime, HOUR, MINUTE, startOfDay } from './time.js';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PRIORITY = { '!': 1, '!!': 2, '!!!': 3, '!low': 1, '!med': 2, '!medium': 2, '!high': 3, '!3': 1, '!2': 2, '!1': 3 };
const REPEAT_WORDS = {
  'every day': 'daily',
  everyday: 'daily',
  daily: 'daily',
  'every weekday': 'weekdays',
  'every workday': 'weekdays',
  weekdays: 'weekdays',
  'every week': 'weekly',
  weekly: 'weekly',
  'every month': 'monthly',
  monthly: 'monthly',
};

export function parseQuickAdd(input, now = Date.now()) {
  let text = ` ${input} `;
  const found = { list: null, priority: null, day: null, time: null, exact: null, repeat: null };

  // Replaces each match with a space; a handler returning false keeps the text.
  const take = (pattern, handler) => {
    text = text.replace(pattern, (...match) => (handler(...match) === false ? match[0] : ' '));
  };

  take(/\s#(work|w|study|s)(?=\s)/gi, (_, list) => {
    found.list = /^w/i.test(list) ? 'work' : 'study';
  });
  take(/\s(!{1,3}|!(?:low|med|medium|high|[123]))(?=\s)/gi, (_, mark) => {
    found.priority = PRIORITY[mark.toLowerCase()];
  });
  take(/\sin\s+(\d{1,3})\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)(?=\s)/gi, (_, amount, unit) => {
    const n = Number(amount);
    if (/^d/i.test(unit)) found.day = addDays(startOfDay(now), n);
    else found.exact = now + n * (/^h/i.test(unit) ? HOUR : MINUTE);
  });
  // Repeats go before the weekdays, so "every fri" isn't read as just "fri".
  take(/\s(every\s+day|everyday|daily|every\s+(?:weekday|workday)|weekdays|every\s+week|weekly|every\s+month|monthly)(?=\s)/gi, (_, word) => {
    found.repeat = REPEAT_WORDS[word.toLowerCase().replace(/\s+/g, ' ')];
  });
  take(
    /\severy\s+(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?=\s)/gi,
    (_, day) => {
      found.repeat = 'weekly';
      found.day = nextWeekday(WEEKDAYS.indexOf(day.slice(0, 3).toLowerCase()), now);
    },
  );
  take(/\s(today|tonight|tomorrow|tmr|tmrw|next\s+week)(?=\s)/gi, (_, word) => {
    const w = word.toLowerCase();
    if (w === 'today') found.day = startOfDay(now);
    else if (w === 'tonight') {
      found.day = startOfDay(now);
      found.time ??= [20, 0];
    } else if (w.startsWith('next')) found.day = nextWeekday(1, now, true);
    else found.day = addDays(startOfDay(now), 1);
  });
  take(
    /\s(?:on\s+)?(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?=\s)/gi,
    (_, day) => {
      found.day = nextWeekday(WEEKDAYS.indexOf(day.slice(0, 3).toLowerCase()), now);
    },
  );
  take(/\s(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s?(am|pm)(?=\s)/gi, (_, hh, mm = '0', meridiem) => {
    const hour = Number(hh);
    if (hour < 1 || hour > 12) return false;
    found.time = [(hour % 12) + (/pm/i.test(meridiem) ? 12 : 0), Number(mm)];
  });
  take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/g, (_, hh, mm) => {
    found.time = [Number(hh), Number(mm)];
  });
  take(/\s(?:at\s+)?([01]?\d|2[0-3])h([0-5]\d)?(?=\s)/gi, (_, hh, mm = '0') => {
    found.time = [Number(hh), Number(mm)];
  });
  take(/\sat\s+([01]?\d|2[0-3])(?=\s)/gi, (_, hh) => {
    const hour = Number(hh);
    found.time = [hour >= 1 && hour <= 6 ? hour + 12 : hour, 0];
  });

  let due = null;
  let allDay = false;
  if (found.exact != null) due = found.exact;
  else if (found.time) {
    const day = found.day ?? startOfDay(now);
    due = atTime(day, ...found.time);
    // A bare time that already passed today means tomorrow.
    if (found.day == null && due <= now) due = atTime(addDays(day, 1), ...found.time);
  } else if (found.day != null) {
    due = found.day;
    allDay = true;
  }
  if (found.repeat) {
    // A repeat with no day starts today; weekday repeats skip the weekend.
    if (due == null) [due, allDay] = [startOfDay(now), true];
    while (found.repeat === 'weekdays' && [0, 6].includes(new Date(due).getDay())) due = addDays(due, 1);
  }

  return {
    title: text.replace(/\s+/g, ' ').trim(),
    list: found.list,
    priority: found.priority,
    due,
    allDay,
    repeat: found.repeat,
  };
}

/** Start of the next given weekday (today counts unless `strict`). */
function nextWeekday(weekday, now, strict = false) {
  const today = startOfDay(now);
  let diff = (weekday - new Date(today).getDay() + 7) % 7;
  if (strict && diff === 0) diff = 7;
  return addDays(today, diff);
}
