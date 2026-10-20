// Routines: at a time (every day, some weekdays, or once), open apps and web pages.
//   "Every weekday at 9:00, open Unity and Spotify."
//   "On 10 Nov at 11:00, search Amazon for gift wrap."
import { button, fill, h, iconButton } from '../dom.js';
import { icon } from '../icons.js';
import { DAY_LETTERS, describeActions, describeWhen, nextRun } from '../schedule.js';
import { commit, state, uid } from '../store.js';
import { invoke } from '../tauri.js';
import { addDays, dayKey, formatDue } from '../time.js';
import { appIcon, ENGINES, loadApps, matchApps } from './launch.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function routinesPanel() {
  let app;
  let visible = false;
  let draft = null; // the routine being edited (a copy)
  let adding = null; // 'app' | 'web' while picking an action
  let engine = ENGINES[0].id;
  let error = '';
  let apps = [];
  let root;

  function render() {
    if (draft) renderEditor();
    else renderList();
  }

  function renderList() {
    const add = button('New routine', () => edit(null), { kind: 'primary', iconName: 'plus' });
    if (!state.routines.length) {
      fill(
        root,
        h(
          'div',
          { class: 'empty' },
          icon('routines'),
          h('strong', {}, 'Let Tama do the routine stuff'),
          'At a set time, Tama can open apps and web pages for you. For example, every weekday at 9:00, open your work apps. Or on 10 Nov at 11:00, search Amazon for gift wrap.',
          add,
        ),
      );
      return;
    }
    const now = Date.now();
    fill(
      root,
      h(
        'div',
        { class: 'routine-list scroll' },
        state.routines.map((routine) => {
          const next = routine.enabled ? nextRun(routine, now) : null;
          return h(
            'div',
            { class: `routine${routine.enabled ? '' : ' off'}` },
            h(
              'button',
              { class: 'routine-main press', type: 'button', title: 'Edit routine', onclick: () => edit(routine) },
              h('span', { class: 'routine-time tabular' }, routine.time),
              h(
                'span',
                { class: 'routine-body' },
                h('span', { class: 'routine-name' }, routine.name || describeActions(routine)),
                h(
                  'span',
                  { class: 'routine-sub' },
                  [
                    describeWhen(routine),
                    routine.name ? describeActions(routine) : null,
                    next && routine.repeat !== 'once' ? `next ${formatDue(next, false, now)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
            ),
            h('button', {
              class: 'switch',
              type: 'button',
              role: 'switch',
              'aria-checked': String(routine.enabled),
              'aria-label': `${routine.name || 'Routine'} on`,
              onclick: () => {
                routine.enabled = !routine.enabled;
                commit();
                render();
              },
            }),
          );
        }),
      ),
      h('div', { class: 'panel-foot' }, add),
    );
  }

  function edit(routine) {
    draft = routine
      ? structuredClone(routine)
      : { id: null, name: '', time: '09:00', repeat: 'days', days: [1, 2, 3, 4, 5], date: dayKey(addDays(Date.now(), 1)), actions: [], enabled: true, lastRun: null };
    adding = null;
    error = '';
    render();
  }

  function save() {
    if (!draft.actions.length) return fail('Add at least one app or web page.');
    if (draft.repeat === 'days' && !draft.days.length) return fail('Pick at least one day.');
    if (draft.repeat === 'once' && nextRun({ ...draft, lastRun: null }) == null) return fail('That time has already passed.');
    const routine = { ...draft, name: draft.name.trim(), id: draft.id ?? uid(), enabled: true };
    const index = state.routines.findIndex((r) => r.id === routine.id);
    if (index >= 0) state.routines[index] = routine;
    else state.routines.push(routine);
    commit();
    draft = null;
    render();
  }

  function fail(message) {
    error = message;
    render();
  }

  function remove() {
    const index = state.routines.findIndex((r) => r.id === draft.id);
    if (index < 0) return;
    const [routine] = state.routines.splice(index, 1);
    commit();
    draft = null;
    render();
    app.toast('Routine deleted', {
      label: 'Undo',
      run: () => {
        state.routines.splice(index, 0, routine);
        commit();
        render();
      },
    });
  }

  async function runNow() {
    for (const action of draft.actions) {
      const call = action.type === 'app' ? invoke('app_launch', { id: action.id }) : invoke('url_open', { url: action.url });
      await call.catch((e) => console.error(e));
    }
  }

  function renderEditor() {
    const name = h('input', {
      type: 'text',
      value: draft.name,
      placeholder: 'Name (optional), like “Morning”',
      'aria-label': 'Routine name',
      maxlength: 60,
      oninput: () => (draft.name = name.value),
    });
    const time = h('input', {
      type: 'time',
      value: draft.time,
      'aria-label': 'Time',
      required: true,
      onchange: () => {
        if (time.value) draft.time = time.value;
      },
    });
    const repeat = h(
      'div',
      { class: 'segmented', role: 'tablist', 'aria-label': 'How often' },
      [
        ['days', 'Repeat'],
        ['once', 'Once'],
      ].map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': String(draft.repeat === id),
            onclick: () => {
              draft.repeat = id;
              render();
            },
          },
          label,
        ),
      ),
    );
    const when =
      draft.repeat === 'once'
        ? h('input', {
            type: 'date',
            value: draft.date,
            'aria-label': 'Date',
            onchange: (e) => (draft.date = e.target.value || draft.date),
          })
        : h(
            'div',
            { class: 'day-chips' },
            WEEK_ORDER.map((d) =>
              h(
                'button',
                {
                  class: 'chip day press',
                  type: 'button',
                  'aria-pressed': String(draft.days.includes(d)),
                  'aria-label': DAY_NAMES[d],
                  title: DAY_NAMES[d],
                  onclick: () => {
                    draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d];
                    render();
                  },
                },
                DAY_LETTERS[d],
              ),
            ),
          );

    const actions = h(
      'div',
      { class: 'action-list' },
      draft.actions.map((action, index) =>
        h(
          'span',
          { class: 'action' },
          action.type === 'app' ? appIcon(action.id, 18) : icon(action.iconName ?? 'globe'),
          h('span', { class: 'action-label' }, action.label),
          iconButton('close', `Remove ${action.label}`, () => {
            draft.actions.splice(index, 1);
            render();
          }),
        ),
      ),
      adding ? null : button('App', () => startAdding('app'), { iconName: 'plus' }),
      adding ? null : button('Web page', () => startAdding('web'), { iconName: 'plus' }),
    );

    fill(
      root,
      h(
        'div',
        { class: 'routine-editor scroll' },
        h('label', { class: 'field' }, icon('edit'), name),
        h('div', { class: 'editor-row' }, time, repeat),
        when,
        h('div', { class: 'editor-label' }, 'Then open'),
        actions,
        adding === 'app' ? appPicker() : null,
        adding === 'web' ? webPicker() : null,
        error ? h('p', { class: 'form-error', role: 'alert' }, error) : null,
      ),
      h(
        'div',
        { class: 'panel-foot' },
        draft.id ? button('Delete', remove, { kind: 'ghost', iconName: 'trash' }) : null,
        draft.actions.length ? button('Run now', runNow, { kind: 'ghost', iconName: 'play' }) : null,
        h('span', { class: 'spacer' }),
        button('Cancel', () => {
          draft = null;
          render();
        }),
        button('Save routine', save, { kind: 'primary' }),
      ),
    );
  }

  async function startAdding(kind) {
    adding = kind;
    error = '';
    render();
    if (kind === 'app') {
      apps = await loadApps().catch(() => []);
      if (visible && adding === 'app') render();
    }
  }

  function appPicker() {
    const results = h('div', { class: 'picker-results' });
    const input = h('input', {
      type: 'text',
      placeholder: 'Find an app',
      'aria-label': 'Find an app',
      oninput: () => show(),
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          results.querySelector('button')?.click();
        }
      },
    });
    const show = () =>
      fill(
        results,
        matchApps(apps, input.value, 5).map((a) =>
          h(
            'button',
            {
              class: 'picker-option press',
              type: 'button',
              onclick: () => {
                draft.actions.push({ type: 'app', id: a.id, name: a.name, label: a.name });
                adding = null;
                render();
              },
            },
            appIcon(a.id, 20),
            a.name,
          ),
        ),
      );
    queueMicrotask(() => app.island.borrowKeyboard(input));
    return h(
      'div',
      { class: 'picker' },
      h('div', { class: 'editor-row' }, h('label', { class: 'field grow' }, icon('search'), input), iconButton('close', 'Cancel', cancelAdding)),
      results,
    );
  }

  function webPicker() {
    const input = h('input', {
      type: 'text',
      placeholder: engine === 'link' ? 'Web address' : 'What to search for',
      'aria-label': engine === 'link' ? 'Web address' : 'Search words',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          add();
        }
      },
    });
    const add = () => {
      const text = input.value.trim();
      if (!text) return input.focus();
      if (engine === 'link') {
        const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
        draft.actions.push({ type: 'url', url, label: url.replace(/^https?:\/\//i, ''), iconName: 'link' });
      } else {
        const e = ENGINES.find((x) => x.id === engine);
        draft.actions.push({ type: 'url', url: e.url(text), label: `${e.label}: ${text}`, iconName: e.iconName });
      }
      adding = null;
      render();
    };
    queueMicrotask(() => app.island.borrowKeyboard(input));
    return h(
      'div',
      { class: 'picker' },
      h(
        'div',
        { class: 'editor-row' },
        [...ENGINES, { id: 'link', label: 'Link', iconName: 'link' }].map((e) =>
          h(
            'button',
            {
              class: 'chip press',
              type: 'button',
              'aria-pressed': String(engine === e.id),
              onclick: () => {
                engine = e.id;
                render();
              },
            },
            icon(e.iconName),
            e.label,
          ),
        ),
      ),
      h('div', { class: 'editor-row' }, h('label', { class: 'field grow' }, icon(engine === 'link' ? 'link' : 'search'), input), button('Add', add), iconButton('close', 'Cancel', cancelAdding)),
    );
  }

  function cancelAdding() {
    adding = null;
    render();
  }

  return {
    id: 'routines',
    label: 'Routines',
    icon: 'routines',
    mount(view, context) {
      app = context;
      root = view;
    },
    show() {
      visible = true;
      render();
    },
    hide() {
      visible = false;
    },
  };
}
