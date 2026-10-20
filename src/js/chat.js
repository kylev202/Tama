// The Chatbot: gpt-oss-120b on Groq's free tier, which can set up, change, run and delete
// routines. The conversation and the tools run here; the Rust side adds the API key and
// sends each request, so the key never reaches the webview.
import { describeActions, describeWhen, nextRun } from './schedule.js';
import { commit, state, uid } from './store.js';
import { invoke } from './tauri.js';
import { addDays, dayKey } from './time.js';
import { loadApps, matchApps } from './panels/launch.js';

const MODEL = 'openai/gpt-oss-120b';
/** Tool round trips for one message, so a confused loop can't use up the free limit. */
const MAX_TURNS = 8;

const SYSTEM = `You're the chatbot inside Tama: a Dynamic Island at the top of the user's Windows desktop. The user chats with you in a small panel, and you look after their routines. A routine opens apps and web pages at a set time, either on chosen days of the week or once on a date. Tama runs them; you set them up, change them, run them and remove them with the tools.

Each user message starts with the current local date and time. Routine times are 24-hour local time.

When the user asks for a routine, set it up straight away if you have what you need, then say in one line what you made. If something essential is missing (usually the time), ask one short question. Before adding an app, look it up with find_apps and use an id it returns; if it isn't there, say so. For a web page use its full https address; for a search, build the search page's address (Google, YouTube, Amazon and so on). Before changing, running or deleting a routine, call list_routines to get its id. Only say a routine was saved, changed or deleted after the tool confirms it.

You can also just chat and answer questions. The panel is small and shows plain text only: keep replies to a few short sentences. No markdown, tables, headings or bullet symbols.`;

const fn = (name, description, parameters = { type: 'object', properties: {} }) => ({ type: 'function', function: { name, description, parameters } });
const byId = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };

const TOOLS = [
  fn('list_routines', 'Lists every routine with its id, schedule, actions and next run. Call this when the user asks about their routines, and before changing, running or deleting one.'),
  fn("find_apps", "Searches the apps in the user's Start menu by name. Call this before adding an app to a routine, and use an id it returns.", {
    type: 'object',
    properties: { query: { type: 'string', description: 'Part of the app name, like "spotify".' } },
    required: ['query'],
  }),
  fn('save_routine', 'Creates a routine, or replaces the routine with this id (send every field again, changed or not). Repeat "days" runs on the given days of the week; "once" runs on one date.', {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The id of the routine to replace. Leave out to create a new one.' },
      name: { type: 'string', description: 'A short name, like "Morning". Can be empty.' },
      time: { type: 'string', description: '24-hour local time, HH:MM.' },
      repeat: { type: 'string', enum: ['days', 'once'] },
      days: { type: 'array', items: { type: 'integer' }, description: 'For repeat "days": days of the week, 0 = Sunday to 6 = Saturday.' },
      date: { type: 'string', description: 'For repeat "once": YYYY-MM-DD.' },
      enabled: { type: 'boolean', description: 'False keeps the routine but switches it off. Defaults to true.' },
      actions: {
        type: 'array',
        description: 'What to open, in order.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['app', 'url'] },
            app_id: { type: 'string', description: 'For type "app": an id that find_apps returned.' },
            url: { type: 'string', description: 'For type "url": the full https:// address.' },
            label: { type: 'string', description: 'For type "url": a short label, like "YouTube: lofi beats".' },
          },
          required: ['type'],
        },
      },
    },
    required: ['time', 'repeat', 'actions'],
  }),
  fn('run_routine', "Opens a routine's apps and pages right now, without waiting for its time. Only when the user asks for it.", byId),
  fn('delete_routine', 'Deletes a routine. Only when the user asks for it.', byId),
];

/** "Tue, 20 Oct 2026, 14:05": unambiguous whatever date format the user picked. */
const stamp = (t) =>
  new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * A conversation. `show(item)` hears what to put in the panel: the chatbot's words
 * ({ kind: 'bot', text }) and what the tools did ({ kind: 'event', iconName, text }).
 * `undo(message, run)` offers to take back a deletion.
 */
export function createChat({ show, undo }) {
  let messages = [];

  const tools = {
    list_routines: () => state.routines.map(summary),

    async find_apps({ query }) {
      return matchApps(await loadApps(), String(query ?? ''), 8).map(({ id, name }) => ({ id, name }));
    },

    async save_routine(input) {
      const existing = input.id == null ? null : state.routines.find((r) => r.id === input.id);
      if (input.id != null && !existing) throw new Error(`No routine has the id ${input.id}. Call list_routines.`);
      if (!['days', 'once'].includes(input.repeat)) throw new Error('repeat must be "days" or "once".');
      const routine = {
        id: existing?.id ?? uid(),
        name: String(input.name ?? '').trim().slice(0, 60),
        time: parseTime(input.time),
        repeat: input.repeat,
        // The unused one of days/date keeps a sensible value, as the routine editor did.
        days: input.repeat === 'days' ? parseDays(input.days) : existing?.days ?? [1, 2, 3, 4, 5],
        date: input.repeat === 'once' ? parseDate(input.date) : existing?.date ?? dayKey(addDays(Date.now(), 1)),
        actions: await parseActions(input.actions),
        enabled: input.enabled !== false,
        lastRun: existing?.lastRun ?? null,
      };
      if (routine.repeat === 'once' && nextRun({ ...routine, lastRun: null }) == null) throw new Error('That date and time has already passed.');
      if (existing) state.routines[state.routines.indexOf(existing)] = routine;
      else state.routines.push(routine);
      commit();
      show({ kind: 'event', iconName: 'check', text: `${existing ? 'Changed' : 'Saved'} ${title(routine)} · ${describeWhen(routine)} at ${routine.time}${routine.enabled ? '' : ' (off)'}` });
      return summary(routine);
    },

    async run_routine({ id }) {
      const routine = find(id);
      for (const action of routine.actions) {
        const call = action.type === 'app' ? invoke('app_launch', { id: action.id }) : invoke('url_open', { url: action.url });
        await call.catch((e) => console.error(e));
      }
      show({ kind: 'event', iconName: 'play', text: `Ran ${title(routine)}` });
      return { ran: routine.id };
    },

    delete_routine({ id }) {
      const routine = find(id);
      const index = state.routines.indexOf(routine);
      state.routines.splice(index, 1);
      commit();
      show({ kind: 'event', iconName: 'trash', text: `Deleted ${title(routine)}` });
      undo('Routine deleted', () => {
        state.routines.splice(Math.min(index, state.routines.length), 0, routine);
        commit();
      });
      return { deleted: routine.id };
    },
  };

  /** Sends one message and runs the tools the model asks for until it has answered. */
  async function send(text) {
    // This conversation, even if "New chat" swaps in another while the model is answering.
    const history = messages;
    const before = history.length;
    history.push({ role: 'user', content: `Now: ${stamp(Date.now())}\n\n${text}` });
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = JSON.parse(await invoke('chat_send', { body: JSON.stringify(request(history)) }));
        const choice = response.choices?.[0];
        if (!choice) throw new Error('The chatbot sent back an empty answer. Try again.');
        if (choice.finish_reason === 'length') throw new Error('The answer was cut off. Try asking for less at once.');
        const { content, tool_calls: calls } = choice.message;
        // Only the standard fields go back into the conversation.
        history.push({ role: 'assistant', content: content ?? '', ...(calls?.length ? { tool_calls: calls } : {}) });
        if (content?.trim()) show({ kind: 'bot', text: content.trim() });
        if (!calls?.length) return;
        for (const call of calls) history.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: await use(call) });
      }
      throw new Error('The chatbot kept going without finishing, so Tama stopped it. Try asking another way.');
    } catch (error) {
      // Drop the unfinished exchange, so the next message starts from a valid conversation.
      // Anything a tool already did stays done (and shows in the panel).
      history.length = before;
      throw typeof error === 'string' ? new Error(error) : error;
    }
  }

  const request = (messages) => ({
    model: MODEL,
    messages: [{ role: 'system', content: SYSTEM }, ...messages],
    tools: TOOLS,
    reasoning_effort: 'low', // quick replies, and fewer tokens against the free per-minute limit
    include_reasoning: false,
    max_completion_tokens: 2048,
  });

  async function use(call) {
    try {
      const run = tools[call.function.name];
      if (!run) throw new Error(`There's no tool called ${call.function.name}.`);
      let input;
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        throw new Error('The arguments were not valid JSON.');
      }
      return JSON.stringify(await run(input ?? {}));
    } catch (error) {
      return `Error: ${error.message ?? error}`;
    }
  }

  return {
    send,
    reset() {
      messages = [];
    },
  };
}

function find(id) {
  const routine = state.routines.find((r) => r.id === id);
  if (!routine) throw new Error(`No routine has the id ${id}. Call list_routines.`);
  return routine;
}

const title = (routine) => `“${routine.name || describeActions(routine)}”`;

/** A routine as the model sees it. */
function summary(routine) {
  const next = routine.enabled ? nextRun(routine) : null;
  return {
    id: routine.id,
    name: routine.name,
    time: routine.time,
    repeat: routine.repeat,
    ...(routine.repeat === 'once' ? { date: routine.date } : { days: routine.days }),
    enabled: routine.enabled,
    actions: routine.actions.map((a) => (a.type === 'app' ? { type: 'app', app_id: a.id, label: a.label } : { type: 'url', url: a.url, label: a.label })),
    next_run: next == null ? null : stamp(next),
  };
}

function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('time must be 24-hour HH:MM.');
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function parseDays(days) {
  if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw new Error('days must be numbers from 0 (Sunday) to 6 (Saturday).');
  if (!days.length) throw new Error('Pick at least one day.');
  return [...new Set(days)].sort();
}

function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ''));
  const d = match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!d || d.getMonth() !== Number(match[2]) - 1) throw new Error('date must be YYYY-MM-DD.');
  return match[0];
}

/** The routine editor's action shapes, from the model's. Apps must be ones Start lists, and
 *  pages plain web addresses, so a routine can't open a file or another app's link. */
async function parseActions(actions) {
  if (!Array.isArray(actions) || !actions.length) throw new Error('Add at least one app or web page.');
  const apps = actions.some((a) => a?.type === 'app') ? await loadApps() : [];
  return actions.map((action) => {
    if (action?.type === 'app') {
      const app = apps.find((a) => a.id === action.app_id);
      if (!app) throw new Error(`No app has the id ${action.app_id}. Use find_apps.`);
      return { type: 'app', id: app.id, name: app.name, label: app.name };
    }
    if (action?.type === 'url') {
      let url;
      try {
        url = new URL(String(action.url));
      } catch {
        throw new Error(`${action.url} isn't a web address.`);
      }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https addresses can be opened.');
      const label = String(action.label ?? '').trim().slice(0, 80) || url.host;
      return { type: 'url', url: url.href, label, iconName: 'globe' };
    }
    throw new Error('Each action needs type "app" or "url".');
  });
}
