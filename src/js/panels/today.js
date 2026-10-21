// Tasks: Today, Upcoming (the next 7 days), Calendar, Work and Study views, quick add, and
// an inline editor with steps, notes and repeats.
import { button, fill, h, iconButton, listName, listTint, ring } from '../dom.js';
import * as focus from '../focus.js';
import { icon } from '../icons.js';
import { parseQuickAdd } from '../parse.js';
import { tick } from '../sound.js';
import {
  addTask,
  commit,
  isOverdue,
  moveToToday,
  removeTask,
  REPEATS,
  repeatName,
  setDone,
  state,
  studyStreak,
  subscribe,
  todayProgress,
  uid,
  updateTask,
} from '../store.js';
import { addDays, atTime, dayKey, formatDay, formatDue, formatFullDate, formatLongDate, formatMonth, formatTime, pad, startOfDay, weekStart } from '../time.js';

const PRIORITY = ['None', 'Low', 'Medium', 'High'];
const VIEWS = [
  ['today', 'Today'],
  ['upcoming', 'Upcoming'],
  ['calendar', 'Calendar'],
  ['work', 'Work'],
  ['study', 'Study'],
];
const WEEK = 7;
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sunday first, like Date#getDay

const startOfMonth = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
const addMonths = (t, n) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
};
/** "for today", "for Fri 24 Oct". */
const forDay = (t) => {
  const label = formatDay(t);
  return `for ${label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label}`;
};

export default function todayPanel() {
  let app;
  let visible = false;
  let editing = null;
  let revealEditor = false;
  // Set while saving text the user is still typing, so the list isn't rebuilt under them.
  let quiet = false;
  let focusStep = null; // task whose "Add a step" field keeps focus across a rebuild
  let calendarDay = startOfDay();
  let month = startOfMonth(calendarDay);
  let focusDay = false;
  const showDone = new Set();
  const draft = { list: null, due: undefined, allDay: false, priority: null, repeat: undefined, picking: false };
  let els;

  const view = () => (VIEWS.some(([id]) => id === state.settings.view) ? state.settings.view : 'today');
  const quietly = (save) => {
    quiet = true;
    try {
      save();
    } finally {
      quiet = false;
    }
  };

  function mount(view, context) {
    app = context;
    const segmented = h(
      'div',
      { class: 'segmented', role: 'tablist', 'aria-label': 'Which tasks' },
      VIEWS.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            dataset: { view: id },
            onclick: () => {
              state.settings.view = id;
              editing = null;
              draft.due = undefined;
              commit();
              renderComposer();
            },
          },
          label,
        ),
      ),
    );
    const progress = ring(22, 3);
    const progressText = h('span', { class: 'tabular' });
    const streakText = h('span', { class: 'tabular' });
    const streak = h('span', { class: 'today-streak' }, icon('flame'), streakText);
    const meta = h('div', { class: 'today-meta' }, h('span', { class: 'today-progress' }, progress.el, progressText), streak);

    const input = h('input', {
      type: 'text',
      'aria-label': 'New task',
      maxlength: 200,
      oninput: renderComposer,
      onfocus: renderComposer,
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape' && input.value) {
          e.stopPropagation();
          resetComposer();
        }
      },
    });
    const field = h('label', { class: 'field' }, icon('plus'), input);
    const chips = h('div', { class: 'composer-chips' });
    const when = h('div', { class: 'composer-when' });
    const list = h('div', { class: 'task-list scroll' });

    // Calendar: a month on the left, the chosen day's tasks on the right.
    const monthLabel = h('span', { class: 'cal-month' });
    const todayChip = h('button', { class: 'chip press', type: 'button', onclick: () => selectDay(startOfDay(), true) }, 'Today');
    const week = h('div', { class: 'cal-week', 'aria-hidden': 'true' });
    const grid = h('div', { class: 'cal-grid', role: 'group' });
    grid.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      selectDay(addDays(calendarDay, step), true);
    });
    const agenda = h('div', { class: 'agenda scroll' });
    const calendar = h(
      'div',
      { class: 'calendar', hidden: true },
      h(
        'div',
        { class: 'cal' },
        h(
          'div',
          { class: 'cal-head' },
          iconButton('chevronLeft', 'Previous month', () => showMonth(-1), 'small'),
          monthLabel,
          iconButton('chevronRight', 'Next month', () => showMonth(1), 'small'),
          h('span', { class: 'spacer' }),
          todayChip,
        ),
        week,
        grid,
      ),
      agenda,
    );

    view.append(h('div', { class: 'today-head' }, segmented, meta), h('div', { class: 'composer' }, field, chips, when), list, calendar);
    els = { segmented, progress, progressText, streak, streakText, input, field, chips, when, list, calendar, monthLabel, todayChip, week, grid, agenda };
    subscribe(() => visible && !quiet && render());
  }

  /* Composer */

  function resolved() {
    const parsed = parseQuickAdd(els.input.value);
    const v = view();
    const list = draft.list ?? parsed.list ?? (v === 'work' || v === 'study' ? v : state.settings.list);
    let due = null;
    let allDay = false;
    if (draft.due !== undefined) [due, allDay] = [draft.due, draft.allDay];
    else if (parsed.due != null) [due, allDay] = [parsed.due, parsed.allDay];
    else if (v === 'calendar') [due, allDay] = [calendarDay, true]; // added in the calendar: for the chosen day
    else if (v === 'today' || v === 'upcoming') [due, allDay] = [startOfDay(), true]; // added in Today: it's for today
    const repeat = due == null ? null : draft.repeat !== undefined ? draft.repeat : parsed.repeat;
    return { title: parsed.title, list, due, allDay, priority: draft.priority ?? parsed.priority ?? 0, repeat };
  }

  function placeholder() {
    if (view() === 'calendar') return `Add a task ${forDay(calendarDay)}`;
    if (draft.due != null) return `Add a task ${forDay(draft.due)}`;
    return 'Add a task, like “essay fri 9am #study”';
  }

  function renderComposer() {
    els.input.placeholder = placeholder();
    const active = els.input.value.trim().length > 0 || draft.picking;
    els.chips.hidden = !active;
    els.when.hidden = !(active && draft.picking);
    if (!active) return;
    const r = resolved();
    const repeats = [null, ...REPEATS.map(([id]) => id)];
    fill(
      els.chips,
      h(
        'button',
        {
          class: `chip press ${r.list}`,
          type: 'button',
          'aria-pressed': 'true',
          title: 'Switch list',
          onclick: () => {
            draft.list = r.list === 'work' ? 'study' : 'work';
            renderComposer();
          },
        },
        icon(r.list),
        listName(r.list),
      ),
      h(
        'button',
        {
          class: 'chip press',
          type: 'button',
          'aria-pressed': String(r.due != null),
          'aria-expanded': String(draft.picking),
          onclick: () => {
            draft.picking = !draft.picking;
            renderComposer();
          },
        },
        icon('calendar'),
        r.due == null ? 'No date' : formatDue(r.due, r.allDay),
      ),
      h(
        'button',
        {
          class: 'chip press',
          type: 'button',
          'aria-pressed': String(r.priority > 0),
          title: 'Change priority',
          onclick: () => {
            draft.priority = (r.priority + 1) % 4;
            renderComposer();
          },
        },
        icon('flag'),
        r.priority ? PRIORITY[r.priority] : 'Priority',
      ),
      h(
        'button',
        {
          class: 'chip press',
          type: 'button',
          'aria-pressed': String(Boolean(r.repeat)),
          title: 'Change repeat',
          onclick: () => {
            draft.repeat = repeats[(repeats.indexOf(r.repeat) + 1) % repeats.length];
            if (draft.repeat && r.due == null) [draft.due, draft.allDay] = [startOfDay(), true];
            renderComposer();
          },
        },
        icon('repeat'),
        r.repeat ? repeatName(r.repeat) : 'Repeat',
      ),
      h('span', { class: 'spacer' }),
      button('Add task', submit, { kind: 'primary' }),
    );
    if (draft.picking) {
      fill(
        els.when,
        dueEditor(r.due, r.allDay, (due, allDay) => {
          draft.due = due;
          draft.allDay = allDay;
          renderComposer();
        }),
      );
    }
  }

  function submit() {
    const r = resolved();
    if (!r.title) {
      els.field.classList.remove('shake');
      void els.field.offsetWidth;
      els.field.classList.add('shake');
      els.input.focus();
      return;
    }
    const task = addTask(r);
    state.settings.list = r.list;
    resetComposer();
    tick();
    reveal(task);
  }

  /** Tells (or shows) where a new task went when the current view doesn't list it. */
  function reveal(task) {
    const v = view();
    const now = Date.now();
    if (task.due == null) {
      if (v !== task.list) app.toast(`Added to ${listName(task.list)}, no date`);
      return;
    }
    if (v === 'calendar') {
      if (startOfDay(task.due) !== calendarDay) selectDay(task.due);
      return;
    }
    const day = startOfDay(task.due);
    const listed = v === 'today' ? day <= startOfDay(now) : v === 'upcoming' ? day < addDays(startOfDay(now), WEEK) : v === task.list;
    if (!listed) {
      app.toast(`Added ${forDay(task.due)}`, {
        label: 'Show',
        run: () => {
          selectDay(task.due);
          state.settings.view = 'calendar';
          commit();
        },
      });
    }
  }

  function resetComposer() {
    els.input.value = '';
    Object.assign(draft, { list: null, due: undefined, allDay: false, priority: null, repeat: undefined, picking: false });
    renderComposer();
  }

  /** Starts a task for a given day: the composer picks up the date. */
  function composeFor(day) {
    draft.due = day;
    draft.allDay = true;
    renderComposer();
    app.island.borrowKeyboard(els.input);
  }

  /** Day presets plus date and time fields. Calls back with (due, allDay). */
  function dueEditor(due, allDay, onChange) {
    const today = startOfDay();
    const time = due != null && !allDay ? [new Date(due).getHours(), new Date(due).getMinutes()] : null;
    const at = (day) => (time ? atTime(day, ...time) : day);
    const day = due != null ? startOfDay(due) : null;
    const preset = (label, value) =>
      h(
        'button',
        { class: 'chip press', type: 'button', 'aria-pressed': String(day === value), onclick: () => onChange(at(value), !time) },
        label,
      );
    const dateInput = h('input', {
      type: 'date',
      'aria-label': 'Date',
      value: due != null ? dayKey(due) : '',
      onchange: () => {
        if (!dateInput.value) return onChange(null, false);
        const [y, m, d] = dateInput.value.split('-').map(Number);
        onChange(at(new Date(y, m - 1, d).getTime()), !time);
      },
    });
    const timeInput = h('input', {
      type: 'time',
      'aria-label': 'Time',
      value: time ? `${pad(time[0])}:${pad(time[1])}` : '',
      onchange: () => {
        if (!timeInput.value) return onChange(day, true);
        const [hh, mm] = timeInput.value.split(':').map(Number);
        onChange(atTime(day ?? today, hh, mm), false);
      },
    });
    return h(
      'div',
      { class: 'due-editor' },
      preset('Today', today),
      preset('Tomorrow', addDays(today, 1)),
      preset('Next week', addDays(today, 7)),
      h('button', { class: 'chip press', type: 'button', 'aria-pressed': String(due == null), onclick: () => onChange(null, false) }, 'No date'),
      dateInput,
      timeInput,
    );
  }

  /* Lists */

  function groups(now) {
    const v = view();
    const start = startOfDay(now);
    const end = addDays(start, 1);
    const tasks = state.tasks.filter((t) => v === 'today' || v === 'upcoming' || t.list === v);
    const open = tasks.filter((t) => !t.done).sort(byDue);
    const done = tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
    const overdue = { id: 'overdue', title: 'Overdue', tone: 'danger', tasks: open.filter((t) => isOverdue(t, now)), move: true };
    if (v === 'upcoming') {
      const days = Array.from({ length: WEEK }, (_, i) => {
        const day = addDays(start, i);
        const next = addDays(day, 1);
        return {
          id: `day-${i}`,
          title: i < 2 ? `${formatDay(day, now)} · ${formatLongDate(day)}` : formatLongDate(day),
          day,
          dayKnown: true,
          keep: true, // empty days still show, so free days are visible when planning
          tasks: open.filter((t) => t.due != null && !isOverdue(t, now) && t.due >= day && t.due < next),
        };
      });
      const later = open.filter((t) => t.due != null && t.due >= addDays(start, WEEK));
      return [overdue, ...days, { id: 'later', title: 'Later', tasks: [], later }];
    }
    const dueToday = (t) => t.due != null && !isOverdue(t, now) && t.due < end;
    const result = [overdue, { id: 'today', title: 'Today', tasks: open.filter(dueToday), dayKnown: true }];
    if (v !== 'today') {
      result.push(
        { id: 'upcoming', title: 'Upcoming', tasks: open.filter((t) => t.due != null && t.due >= end) },
        { id: 'someday', title: 'No date', tasks: open.filter((t) => t.due == null) },
      );
    }
    result.push({
      id: 'done',
      title: v === 'today' ? 'Done today' : 'Done',
      tasks: v === 'today' ? done.filter((t) => t.doneAt >= start) : done.slice(0, 40),
      collapsible: true,
    });
    return result;
  }

  function byDue(a, b) {
    const ad = a.due ?? Infinity;
    const bd = b.due ?? Infinity;
    if (ad !== bd) return ad - bd;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.createdAt - b.createdAt;
  }

  function render() {
    const now = Date.now();
    const v = view();
    for (const tab of els.segmented.children) tab.setAttribute('aria-selected', String(tab.dataset.view === v));

    const { done, total } = todayProgress(now);
    els.progress.set(total ? done / total : 0);
    els.progressText.textContent = `${done}/${total}`;
    els.progressText.parentElement.title = `${done} of ${total} done today`;
    const streak = studyStreak(now);
    els.streakText.textContent = String(streak);
    els.streak.title = streak === 1 ? '1-day study streak' : `${streak}-day study streak`;
    els.streak.classList.toggle('lit', streak > 0);
    els.input.placeholder = placeholder();

    els.list.hidden = v === 'calendar';
    els.calendar.hidden = v !== 'calendar';
    // Editing from the calendar: the month steps aside so the editor gets the full width.
    els.calendar.classList.toggle('editing', editing != null);
    const scroller = v === 'calendar' ? els.agenda : els.list;
    if (v === 'calendar') renderCalendar(now);
    else renderList(now);

    if (revealEditor) {
      revealEditor = false;
      const wrap = scroller.querySelector('.task-wrap');
      if (wrap) revealIn(scroller, wrap);
    }
    if (focusStep) {
      scroller.querySelector(`[data-add-step="${focusStep}"]`)?.focus();
      focusStep = null;
    }
  }

  function renderList(now) {
    const all = groups(now);
    const v = view();
    const openCount = all.filter((g) => g.id !== 'done').reduce((n, g) => n + g.tasks.length, 0);
    const doneGroup = all.find((g) => g.id === 'done');
    if (!openCount && v !== 'upcoming') {
      fill(els.list, emptyState(doneGroup.tasks.length), doneGroup.tasks.length ? group(doneGroup, now) : null);
      return;
    }
    fill(
      els.list,
      all.filter((g) => g.tasks.length || g.keep || g.later?.length).map((g) => group(g, now)),
    );
  }

  function emptyState(doneCount) {
    const v = view();
    if (v === 'today' && doneCount) {
      return h('div', { class: 'empty compact' }, h('strong', {}, 'Today is clear'), `${doneCount} done. Nice work.`);
    }
    if (v === 'today') {
      return h(
        'div',
        { class: 'empty compact' },
        h('strong', {}, 'Nothing due today'),
        'Type a task above. Words like “fri 9am”, “#study” and “every mon” set the day, list and repeat as you type.',
      );
    }
    return h('div', { class: 'empty compact' }, h('strong', {}, `No ${listName(v).toLowerCase()} tasks`), `Add one above and it lands here.`);
  }

  function group(g, now) {
    if (g.later) {
      // Upcoming ends after a week; the calendar has the rest.
      const first = g.later[0];
      return h(
        'section',
        { class: 'group' },
        h(
          'button',
          {
            class: 'group-title press',
            type: 'button',
            onclick: () => {
              selectDay(first.due);
              state.settings.view = 'calendar';
              commit();
            },
          },
          `Later · ${g.later.length}`,
          h('span', { class: 'group-hint' }, `next ${formatDay(first.due, now)}`),
          icon('chevronRight'),
        ),
      );
    }
    const collapsed = g.collapsible && !showDone.has(view());
    let header;
    if (g.collapsible) {
      header = h(
        'button',
        {
          class: 'group-title press',
          type: 'button',
          'aria-expanded': String(!collapsed),
          onclick: () => {
            const key = view();
            if (showDone.has(key)) showDone.delete(key);
            else showDone.add(key);
            render();
          },
        },
        icon(collapsed ? 'chevronRight' : 'chevronDown'),
        `${g.title} · ${g.tasks.length}`,
      );
    } else {
      const count = g.tasks.length ? ` · ${g.tasks.length}` : '';
      header = h(
        'div',
        { class: 'group-head' },
        h('div', { class: `group-title ${g.tone ?? ''}` }, `${g.title}${count}`, g.day != null && !g.tasks.length ? h('span', { class: 'group-hint' }, 'Free') : null),
        h('span', { class: 'spacer' }),
        g.move
          ? h(
              'button',
              {
                class: 'group-action press',
                type: 'button',
                onclick: () => {
                  const undo = moveToToday(g.tasks, now);
                  app.toast(g.tasks.length === 1 ? 'Moved 1 task to today' : `Moved ${g.tasks.length} tasks to today`, { label: 'Undo', run: undo });
                },
              },
              icon('calendar'),
              'Move to today',
            )
          : null,
        g.day != null ? iconButton('plus', `Add a task ${forDay(g.day)}`, () => composeFor(g.day), 'small') : null,
      );
    }
    return h('section', { class: 'group' }, header, collapsed ? null : g.tasks.map((task) => row(task, now, g)));
  }

  /* Calendar */

  function selectDay(day, focusIt = false) {
    calendarDay = startOfDay(day);
    month = startOfMonth(calendarDay);
    editing = null;
    draft.due = undefined;
    focusDay = focusIt;
    if (visible) {
      render();
      renderComposer();
    }
  }

  function showMonth(step) {
    month = addMonths(month, step);
    const today = startOfDay();
    calendarDay = startOfMonth(today) === month ? today : month;
    editing = null;
    draft.due = undefined;
    render();
    renderComposer();
  }

  function renderCalendar(now) {
    const today = startOfDay(now);
    els.monthLabel.textContent = formatMonth(month);
    els.grid.setAttribute('aria-label', `Days of ${formatMonth(month)}`);
    els.todayChip.hidden = calendarDay === today;

    // Six weeks from the first day of the week (Personalise: Monday or Sunday) on or before the 1st.
    const firstDay = weekStart();
    fill(els.week, Array.from({ length: 7 }, (_, i) => h('span', {}, WEEKDAY_LETTERS[(firstDay + i) % 7])));
    const first = startOfMonth(month);
    const start = addDays(first, -((new Date(first).getDay() - firstDay + 7) % 7));
    const end = addDays(start, 42);
    const byDay = new Map();
    for (const task of state.tasks) {
      if (task.done || task.due == null || task.due < start || task.due >= end) continue;
      const key = dayKey(task.due);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(task);
    }

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = addDays(start, i);
      const tasks = (byDay.get(dayKey(day)) ?? []).sort(byDue);
      const outside = startOfMonth(day) !== month;
      const selected = day === calendarDay;
      const late = day < today;
      cells.push(
        h(
          'button',
          {
            class: `cal-day${outside ? ' outside' : ''}${day === today ? ' today' : ''}`,
            type: 'button',
            tabindex: selected ? '0' : '-1',
            'aria-pressed': String(selected),
            'aria-label': `${formatFullDate(day)}${tasks.length ? `, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}${late ? ' overdue' : ''}` : ''}`,
            dataset: { day: String(day) },
            onclick: () => selectDay(day),
          },
          h('span', { class: 'cal-num' }, new Date(day).getDate()),
          h(
            'span',
            { class: 'cal-dots', 'aria-hidden': 'true' },
            tasks.slice(0, 3).map((t) => h('i', { style: { '--dot': late ? 'var(--danger)' : listTint(t.list) } })),
          ),
        ),
      );
    }
    fill(els.grid, cells);
    if (focusDay) {
      focusDay = false;
      els.grid.querySelector('[tabindex="0"]')?.focus();
    }

    const next = addDays(calendarDay, 1);
    const dayTasks = state.tasks.filter((t) => t.due != null && t.due >= calendarDay && t.due < next);
    const open = dayTasks.filter((t) => !t.done).sort(byDue);
    const done = dayTasks.filter((t) => t.done);
    const count = open.length ? ` · ${open.length}` : '';
    fill(
      els.agenda,
      h('div', { class: 'agenda-head' }, `${formatDay(calendarDay, now)}${count}`),
      open.length || done.length
        ? [open, done].flat().map((task) => row(task, now, { dayKnown: true }))
        : h('div', { class: 'agenda-empty' }, calendarDay < today ? 'Nothing was due.' : `Nothing due. Type above to add a task ${forDay(calendarDay)}.`),
    );
  }

  /* Rows */

  function row(task, now, { dayKnown = false } = {}) {
    const overdue = isOverdue(task, now);
    const check = h(
      'button',
      {
        class: 'check',
        type: 'button',
        role: 'checkbox',
        'aria-checked': String(task.done),
        'aria-label': task.done ? `Mark “${task.title}” not done` : `Mark “${task.title}” done`,
        onclick: () => toggle(task, check),
      },
      checkMark(),
    );
    const meta = [];
    if (task.due != null) {
      // Under a day heading the day goes without saying; the time doesn't.
      const when = dayKnown && !overdue ? (task.allDay ? null : formatTime(task.due)) : formatDue(task.due, task.allDay, now);
      if (when) meta.push(h('span', { class: overdue ? 'due overdue' : 'due' }, when));
    }
    meta.push(h('span', { class: 'tag' }, icon(task.list), listName(task.list)));
    if (task.repeat) meta.push(h('span', { class: 'tag' }, icon('repeat'), repeatName(task.repeat)));
    if (task.subtasks.length) {
      const doneSteps = task.subtasks.filter((s) => s.done).length;
      meta.push(h('span', { class: 'tag', title: `${doneSteps} of ${task.subtasks.length} steps done` }, icon('steps'), `${doneSteps}/${task.subtasks.length}`));
    }
    if (task.notes.trim()) meta.push(h('span', { class: 'tag', title: 'Has notes' }, icon('note'), h('span', { class: 'sr-only' }, 'Has notes')));
    if (task.priority) meta.push(h('span', { class: `tag prio p${task.priority}` }, icon('flag'), PRIORITY[task.priority]));
    const open = editing === task.id;
    const title = h('span', { class: 'task-title' }, task.title);
    const body = h(
      'button',
      {
        class: 'task-body',
        type: 'button',
        'aria-expanded': String(open),
        title: 'Edit task',
        onclick: () => {
          editing = open ? null : task.id;
          revealEditor = !open;
          render();
        },
      },
      title,
      h('span', { class: 'task-meta' }, meta),
    );
    const actions = h(
      'div',
      { class: 'task-actions' },
      task.done
        ? null
        : iconButton('focus', `Focus on “${task.title}”`, () => {
            focus.start('focus', task.id);
            app.open('focus');
          }),
    );
    const el = h('div', { class: `task${task.done ? ' done' : ''}${open ? ' editing' : ''}`, style: { '--tint': listTint(task.list) } }, check, body, actions);
    return open ? h('div', { class: 'task-wrap', style: { '--tint': listTint(task.list) } }, el, editor(task, title)) : el;
  }

  function checkMark() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="m5.5 10.4 3 3 6-6.4"/>';
    return svg;
  }

  function toggle(task, check) {
    const done = !task.done;
    check.setAttribute('aria-checked', String(done));
    if (done) {
      tick();
      app.cat.react('happy');
    }
    // Let the check draw before the row moves to its new group.
    setTimeout(() => {
      const copy = setDone(task, done);
      if (copy) app.toast(`Done. Next: ${formatDue(task.due, task.allDay)}`, { label: 'Undo', run: () => setDone(copy, false) });
      const { done: count, total } = todayProgress();
      if (done && total > 0 && count === total) app.cat.react('celebrate');
    }, done ? 420 : 0);
  }

  /* Editor */

  function editor(task, rowTitle) {
    const title = h('input', {
      type: 'text',
      value: task.title,
      'aria-label': 'Task title',
      maxlength: 200,
      onchange: () => {
        const value = title.value.trim();
        if (!value || value === task.title) return;
        // Saved without a rebuild, so a click that caused this blur still lands.
        quietly(() => updateTask(task, { title: value }));
        rowTitle.textContent = value;
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          title.blur();
          editing = null;
          render();
        }
      },
    });
    const notes = h('textarea', {
      class: 'notes',
      rows: 2,
      placeholder: 'Notes',
      'aria-label': 'Notes',
      maxlength: 2000,
      value: task.notes,
      oninput: () => grow(notes),
      onchange: () => {
        if (notes.value !== task.notes) quietly(() => updateTask(task, { notes: notes.value }));
      },
    });
    requestAnimationFrame(() => grow(notes));

    const lists = ['work', 'study'].map((list) =>
      h(
        'button',
        { class: `chip press ${list}`, type: 'button', 'aria-pressed': String(task.list === list), onclick: () => updateTask(task, { list }) },
        icon(list),
        listName(list),
      ),
    );
    const priorities = [1, 2, 3].map((p) =>
      h(
        'button',
        {
          class: 'chip press',
          type: 'button',
          'aria-pressed': String(task.priority === p),
          onclick: () => updateTask(task, { priority: task.priority === p ? 0 : p }),
        },
        PRIORITY[p],
      ),
    );
    const repeats = [[null, 'Never'], ...REPEATS].map(([id, label]) =>
      h(
        'button',
        {
          class: 'chip press',
          type: 'button',
          'aria-pressed': String((task.repeat ?? null) === id),
          onclick: () => updateTask(task, id && task.due == null ? { repeat: id, due: startOfDay(), allDay: true } : { repeat: id }),
        },
        label,
      ),
    );
    return h(
      'div',
      { class: 'task-editor' },
      h('label', { class: 'field' }, icon('edit'), title),
      notes,
      steps(task),
      h('div', { class: 'editor-row' }, lists, h('span', { class: 'divider' }), priorities),
      dueEditor(task.due, task.allDay, (due, allDay) => updateTask(task, { due, allDay })),
      h('div', { class: 'editor-row' }, h('span', { class: 'editor-key' }, icon('repeat'), 'Repeat'), repeats),
      h(
        'div',
        { class: 'editor-row end' },
        button(
          'Delete task',
          () => {
            editing = null;
            const undo = removeTask(task);
            app.toast('Task deleted', { label: 'Undo', run: undo });
          },
          { kind: 'ghost', iconName: 'trash' },
        ),
        h('span', { class: 'spacer' }),
        button('Done', () => {
          editing = null;
          render();
        }),
      ),
    );
  }

  /** Checklist steps under a task, plus a field that adds one per Enter. */
  function steps(task) {
    const items = task.subtasks.map((step) => {
      const input = h('input', {
        type: 'text',
        class: 'step-title',
        value: step.title,
        'aria-label': 'Step',
        maxlength: 200,
        onchange: () => {
          const value = input.value.trim();
          if (!value) {
            task.subtasks.splice(task.subtasks.indexOf(step), 1);
            commit();
          } else if (value !== step.title) {
            step.title = value;
            quietly(commit);
          }
        },
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
        },
      });
      return h(
        'div',
        { class: `step${step.done ? ' done' : ''}` },
        h(
          'button',
          {
            class: 'check small',
            type: 'button',
            role: 'checkbox',
            'aria-checked': String(step.done),
            'aria-label': step.done ? `Mark step “${step.title}” not done` : `Mark step “${step.title}” done`,
            onclick: () => {
              step.done = !step.done;
              if (step.done) tick();
              commit();
            },
          },
          checkMark(),
        ),
        input,
        iconButton(
          'close',
          `Remove step “${step.title}”`,
          () => {
            task.subtasks.splice(task.subtasks.indexOf(step), 1);
            commit();
          },
          'small',
        ),
      );
    });
    const add = h('input', {
      type: 'text',
      placeholder: task.subtasks.length ? 'Add another step' : 'Add a step',
      'aria-label': 'Add a step',
      maxlength: 200,
      dataset: { addStep: task.id },
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const value = add.value.trim();
        if (!value) return;
        task.subtasks.push({ id: uid(), title: value, done: false });
        focusStep = task.id;
        commit();
      },
    });
    return h('div', { class: 'steps' }, items, h('label', { class: 'step-add' }, icon('plus'), add));
  }

  function grow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }

  /** Scrolls a list just enough to show `el` (scrollIntoView would also move the island),
   *  keeping it clear of a sticky heading. */
  function revealIn(scroller, el) {
    const head = scroller.querySelector('.agenda-head')?.offsetHeight ?? 0;
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - head - 4;
    const bottom = top + el.offsetHeight + head + 8;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = Math.min(top, bottom - scroller.clientHeight);
  }

  return {
    id: 'today',
    label: 'Tasks',
    icon: 'today',
    mount,
    show(options = {}) {
      visible = true;
      render();
      renderComposer();
      if (options.compose) app.island.borrowKeyboard(els.input);
    },
    hide() {
      visible = false;
      editing = null;
    },
  };
}
