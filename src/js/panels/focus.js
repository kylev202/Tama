// Focus timer: pick a task (or none), a length, and go. Breaks follow focus sessions.
import { button, fill, h, iconButton, listName, listTint, ring } from '../dom.js';
import * as focus from '../focus.js';
import { icon } from '../icons.js';
import { commit, isOverdue, state, subscribe } from '../store.js';
import { dayKey, formatClock, formatDuration, MINUTE } from '../time.js';

const LENGTHS = [15, 25, 50];
const BREAKS = [5, 10];

export default function focusPanel() {
  let visible = false;
  let timer = 0;
  let picking = false;
  let picked = null; // task id to focus on next
  let els;

  function mount(view) {
    const dial = ring(148, 7);
    const time = h('div', { class: 'focus-time tabular' });
    const label = h('div', { class: 'focus-label' });
    const side = h('div', { class: 'focus-side' });
    const foot = h('div', { class: 'focus-foot' });
    view.append(
      h('div', { class: 'focus' }, h('div', { class: 'focus-dial' }, dial.el, h('div', { class: 'focus-center' }, time, label)), side),
      foot,
    );
    els = { dial, time, label, side, foot };
    subscribe(() => visible && render());
  }

  function candidates() {
    const now = Date.now();
    return state.tasks
      .filter((t) => !t.done)
      .sort((a, b) => {
        const rank = (t) => (isOverdue(t, now) ? 0 : t.due != null ? 1 : 2);
        return rank(a) - rank(b) || (a.due ?? Infinity) - (b.due ?? Infinity) || b.priority - a.priority;
      })
      .slice(0, 8);
  }

  function render() {
    const session = focus.session();
    if (picked && !state.tasks.some((t) => t.id === picked && !t.done)) picked = null;
    if (!session) renderIdle();
    else if (session.kind === 'break') renderBreak(session);
    else renderRunning(session);
    renderFoot();
    update();
  }

  function renderIdle() {
    els.label.textContent = 'Ready';
    els.dial.tint('var(--brand)');
    const task = state.tasks.find((t) => t.id === picked);
    const picker = h(
      'button',
      {
        class: 'focus-pick press',
        type: 'button',
        'aria-expanded': String(picking),
        onclick: () => {
          picking = !picking;
          render();
        },
      },
      h('span', { class: 'focus-pick-label' }, 'Focus on'),
      h('span', { class: 'focus-pick-value', style: { '--tint': task ? listTint(task.list) : 'var(--ink-2)' } }, task ? task.title : 'Nothing in particular'),
      icon(picking ? 'chevronDown' : 'chevronRight'),
    );
    const options = picking
      ? h(
          'div',
          { class: 'focus-options scroll', role: 'listbox', 'aria-label': 'Task to focus on' },
          [null, ...candidates()].map((t) =>
            h(
              'button',
              {
                class: 'focus-option press',
                type: 'button',
                role: 'option',
                'aria-selected': String((t?.id ?? null) === picked),
                style: { '--tint': t ? listTint(t.list) : 'var(--ink-3)' },
                onclick: () => {
                  picked = t?.id ?? null;
                  picking = false;
                  render();
                },
              },
              h('i', { class: 'dot' }),
              t ? t.title : 'Nothing in particular',
            ),
          ),
        )
      : null;
    const lengths = h(
      'div',
      { class: 'focus-lengths' },
      h('span', { class: 'muted' }, 'Focus'),
      LENGTHS.map((m) => lengthChip(m, 'length')),
      h('span', { class: 'muted gap' }, 'Break'),
      BREAKS.map((m) => lengthChip(m, 'breakLength')),
    );
    fill(
      els.side,
      picker,
      options,
      picking ? null : lengths,
      picking ? null : h('div', { class: 'focus-actions' }, button('Start focus', () => focus.start('focus', picked), { kind: 'primary', iconName: 'play' })),
    );
  }

  function lengthChip(minutes, key) {
    return h(
      'button',
      {
        class: 'chip press',
        type: 'button',
        'aria-pressed': String(state.focus[key] === minutes),
        'aria-label': `${minutes} minutes`,
        onclick: () => {
          state.focus[key] = minutes;
          commit();
        },
      },
      `${minutes}`,
    );
  }

  function renderRunning(session) {
    const task = focus.taskOf(session);
    const paused = session.pausedLeft != null;
    els.label.textContent = paused ? 'Paused' : 'Focus';
    els.dial.tint(task ? listTint(task.list) : 'var(--brand)');
    fill(
      els.side,
      h(
        'div',
        { class: 'focus-now' },
        h('div', { class: 'focus-now-title' }, task ? task.title : 'Focusing'),
        h('div', { class: 'muted' }, task ? `${listName(task.list)} · ${state.focus.breakLength} min break after` : `${state.focus.breakLength} min break after`),
      ),
      h(
        'div',
        { class: 'focus-actions' },
        paused
          ? button('Resume', () => focus.resume(), { kind: 'primary', iconName: 'play' })
          : button('Pause', () => focus.pause(), { iconName: 'pause' }),
        button('Stop', () => focus.stop(), { kind: 'ghost', iconName: 'stop' }),
      ),
    );
  }

  function renderBreak(session) {
    els.label.textContent = session.pausedLeft != null ? 'Paused' : 'Break';
    els.dial.tint('var(--brand)');
    fill(
      els.side,
      h(
        'div',
        { class: 'focus-now' },
        h('div', { class: 'focus-now-title' }, 'Break'),
        h('div', { class: 'muted' }, 'Stand up, drink some water, rest your eyes on something far away.'),
      ),
      h('div', { class: 'focus-actions' }, button('End break', () => focus.stop(), { iconName: 'stop' })),
    );
  }

  function renderFoot() {
    const today = state.stats.focus[dayKey()] ?? {};
    const total = (today.work ?? 0) + (today.study ?? 0) + (today.free ?? 0);
    const parts = [
      today.study ? `Study ${formatDuration(today.study * MINUTE)}` : null,
      today.work ? `Work ${formatDuration(today.work * MINUTE)}` : null,
    ].filter(Boolean);
    fill(
      els.foot,
      icon('focus'),
      total ? `Focused today: ${formatDuration(total * MINUTE)}` : 'No focus time yet today',
      parts.length ? h('span', { class: 'muted' }, ` · ${parts.join(' · ')}`) : null,
    );
  }

  function update() {
    if (!els) return;
    const session = focus.session();
    els.dial.set(session ? focus.progress() : 0);
    els.time.textContent = formatClock(session ? focus.remaining() : state.focus.length * MINUTE);
  }

  return {
    id: 'focus',
    label: 'Focus',
    icon: 'focus',
    mount,
    show() {
      visible = true;
      render();
      clearInterval(timer);
      timer = setInterval(update, 500);
    },
    hide() {
      visible = false;
      picking = false;
      clearInterval(timer);
    },
  };
}
