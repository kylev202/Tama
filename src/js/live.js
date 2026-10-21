// What the island shows without being opened: the compact live activity in the bar, the
// peek row on hover, and the clock while open. It also picks the cat's mood.
import { look, onLook } from './appearance.js';
import { button, fill, h, iconButton, listName, listTint, ring } from './dom.js';
import * as focus from './focus.js';
import { icon } from './icons.js';
import { currentLine, onLine, onLyrics } from './lyrics.js';
import { control, media, onMedia } from './media.js';
import { reminderTime, setDone, state, subscribe, todayProgress } from './store.js';
import {
  addDays,
  dayKey,
  formatClock,
  formatClockTime,
  formatDue,
  formatIn,
  formatLongDate,
  formatShortDate,
  formatTime,
  MINUTE,
  startOfDay,
} from './time.js';

export function createLive({ island, cat, open }) {
  const lead = document.getElementById('bar-lead');
  const trail = document.getElementById('bar-trail');
  const peek = document.getElementById('layer-peek');
  let barKey = '';
  let peekKey = '';
  let barTickers = [];
  let peekTickers = [];
  let peekLyric = null; // the peek's lyric line, while the peek shows music

  /** The soonest timed task due within the next hour (or overdue by less than an hour). */
  function soonTask(now) {
    let best = null;
    for (const task of state.tasks) {
      if (task.done || task.due == null || task.allDay) continue;
      const at = reminderTime(task);
      if (at < now - 60 * MINUTE || at > now + 60 * MINUTE) continue;
      if (!best || at < reminderTime(best)) best = task;
    }
    return best;
  }

  /** Compact activity for the resting island, by priority. The key covers everything the
   *  bar shows, so the bar is only rebuilt (restarting its animations) when it changes. */
  function compact(now) {
    const session = focus.session();
    if (session) return { kind: 'focus', key: `focus:${session.id}:${session.kind}:${session.pausedLeft == null}` };
    if (media.now?.playing) return { kind: 'media', key: `media:${media.now.artVersion}:${media.tint}` };
    const task = soonTask(now);
    if (task) return { kind: 'task', task, key: `task:${task.id}:${task.list}` };
    return { kind: 'none', key: 'none' };
  }

  /** What the resting bar shows: the activity, else the clock if chosen. The cat style (and a
   *  hidden island) rests as the cat alone; its mood still shows what's going on. */
  function restActivity(now) {
    if (look().style === 'cat' || island.hidden) return { kind: 'none', key: 'none' };
    const activity = compact(now);
    if (activity.kind === 'none' && look().restClock) return { kind: 'clock', key: `clock:${dayKey(now)}` };
    return activity;
  }

  /** What the open island's top bar shows on the right. */
  function openNote(now) {
    const next = nextReminder(now);
    return next ? `${next.id}:${reminderTime(next)}` : formatLongDate(now);
  }

  /** Peek content: like compact, but paused music and a day summary also qualify. */
  function peekActivity(now) {
    const c = compact(now);
    if (c.kind !== 'none') return c;
    if (media.now) return { kind: 'media', key: 'media:paused' };
    return { kind: 'summary', key: 'summary' };
  }

  function moodFor(now) {
    if (island.state === 'alert') return 'alert';
    const session = focus.session();
    if (session?.kind === 'focus' && session.pausedLeft == null) return 'focus';
    if (media.now?.playing) return 'music';
    const hour = new Date(now).getHours();
    return hour >= 23 || hour < 5 ? 'sleepy' : 'idle';
  }

  function render() {
    const now = Date.now();
    const islandState = island.state;
    const activity = restActivity(now);
    const wideClock = activity.kind === 'clock' && (look().seconds || !look().clock24);
    island.setLive(activity.kind === 'none' ? 'rest' : wideClock ? 'wide' : 'live');
    cat.setMood(moodFor(now));

    const nextBarKey = islandState === 'rest' ? activity.key : islandState === 'open' ? `open:${openNote(now)}` : islandState;
    if (nextBarKey !== barKey) {
      const first = barKey === '';
      barKey = nextBarKey;
      const build = () => {
        barTickers = [];
        renderBar(islandState, activity, now);
        tick();
      };
      if (first) build();
      else swap(build);
    }

    // The peek row is rebuilt when its subject changes, or refreshed while it's on screen.
    const p = peekActivity(now);
    const nextPeekKey = `${p.key}:${media.now?.title}:${media.now?.playing}:${focus.session()?.pausedLeft == null}`;
    if (nextPeekKey !== peekKey || (islandState === 'peek' && (p.kind === 'summary' || p.kind === 'task'))) {
      peekKey = nextPeekKey;
      peekTickers = [];
      renderPeek(p, now);
    }
    tick();
  }

  // Bar contents cross-fade with a little blur when the activity changes.
  function swap(build) {
    lead.classList.add('swap');
    trail.classList.add('swap');
    setTimeout(() => {
      build();
      lead.classList.remove('swap');
      trail.classList.remove('swap');
    }, 110);
  }

  function renderBar(islandState, activity, now) {
    // Peek and alert show their content in the row below, so only the cat stays on top.
    if (islandState === 'alert' || islandState === 'peek') {
      fill(lead);
      fill(trail);
      return;
    }
    if (islandState === 'open') {
      const clock = h('span', { class: 'bar-clock' });
      barTickers.push(() => (clock.textContent = formatClockTime(Date.now())));
      fill(lead, clock);
      const next = nextReminder(now);
      fill(
        trail,
        next
          ? h('span', { class: 'bar-note', title: `Next reminder: ${next.title}` }, icon('bell'), formatTime(reminderTime(next)))
          : h('span', { class: 'bar-note' }, formatLongDate(now)),
        pinButton(),
        iconButton('hide', 'Hide the island', () => island.hide(), 'small bar-btn'),
      );
      return;
    }
    if (activity.kind === 'focus') {
      const session = focus.session();
      const task = focus.taskOf(session);
      const tint = session.kind === 'break' ? 'var(--brand)' : task ? listTint(task.list) : 'var(--brand)';
      const progress = ring(20, 2.6, tint);
      const time = h('span', { class: 'live-time', style: { '--live-tint': session.pausedLeft != null ? 'var(--ink-2)' : 'var(--ink)' } });
      barTickers.push(() => {
        progress.set(focus.progress());
        time.textContent = formatClock(focus.remaining());
      });
      fill(lead, progress.el);
      fill(trail, time);
    } else if (activity.kind === 'media') {
      fill(lead, media.art ? h('img', { class: 'live-art', src: media.art, alt: '' }) : h('span', { class: 'live-icon' }, icon('music')));
      const bars = h(
        'span',
        { class: `bars${media.now?.playing ? ' playing' : ''}`, style: { '--live-tint': media.tint ?? 'var(--brand)' } },
        h('i'),
        h('i'),
        h('i'),
        h('i'),
      );
      fill(trail, bars);
    } else if (activity.kind === 'task') {
      const tint = listTint(activity.task.list);
      fill(lead, h('span', { class: 'live-icon', style: { '--live-tint': tint } }, icon('bell')));
      const when = h('span', { class: 'live-time' });
      barTickers.push(() => (when.textContent = formatIn(reminderTime(activity.task))));
      fill(trail, when);
    } else if (activity.kind === 'clock') {
      const clock = h('span', { class: 'bar-clock' });
      barTickers.push(() => (clock.textContent = formatClockTime(Date.now())));
      fill(lead, clock);
      fill(trail, h('span', { class: 'bar-note' }, formatShortDate(now)));
    } else {
      fill(lead);
      fill(trail);
    }
  }

  /** Keeps the open island open while the pointer is elsewhere. */
  function pinButton() {
    const label = () => (island.pinned ? 'Unpin the island' : 'Pin the island open');
    const pin = iconButton('pin', label(), () => {
      island.setPinned(!island.pinned);
      pin.setAttribute('aria-pressed', String(island.pinned));
      pin.setAttribute('aria-label', label());
      pin.title = label();
    }, 'small toggle bar-btn');
    pin.setAttribute('aria-pressed', String(island.pinned));
    return pin;
  }

  function nextReminder(now) {
    const end = addDays(startOfDay(now), 1);
    let best = null;
    for (const task of state.tasks) {
      if (task.done || task.due == null || task.allDay) continue;
      const at = reminderTime(task);
      if (at < now || at >= end) continue;
      if (!best || at < reminderTime(best)) best = task;
    }
    return best;
  }

  function renderPeek(activity, now) {
    peekLyric = null;
    let content;
    if (activity.kind === 'focus') content = peekFocus();
    else if (activity.kind === 'media') content = peekMedia();
    else if (activity.kind === 'task') content = peekTask(activity.task, now);
    else content = peekSummary(now);
    fill(peek, content);
  }

  function peekFocus() {
    const session = focus.session();
    const task = focus.taskOf(session);
    const isBreak = session.kind === 'break';
    const tint = isBreak ? 'var(--brand)' : task ? listTint(task.list) : 'var(--brand)';
    const progress = ring(40, 3.5, tint);
    const sub = h('div', { class: 'peek-sub' });
    peekTickers.push(() => {
      progress.set(focus.progress());
      const left = formatClock(focus.remaining());
      sub.textContent = session.pausedLeft != null ? `Paused, ${left} left` : `${left} left${task ? ` · ${listName(task.list)}` : ''}`;
    });
    const paused = session.pausedLeft != null;
    return h(
      'div',
      { class: 'peek' },
      h('div', { class: 'peek-media', style: { '--peek-tint': tint } }, progress.el),
      h(
        'div',
        { class: 'peek-text', onclick: () => open('focus') },
        h('div', { class: 'peek-title' }, isBreak ? 'Break' : task ? task.title : 'Focus'),
        sub,
      ),
      h(
        'div',
        { class: 'peek-actions' },
        iconButton(paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause', () => (paused ? focus.resume() : focus.pause()), 'solid'),
        iconButton('stop', isBreak ? 'End break' : 'Stop focus', () => focus.stop()),
      ),
    );
  }

  function peekMedia() {
    const now = media.now;
    const art = media.art ? h('img', { src: media.art, alt: '' }) : icon('music');
    const sub = h('div', { class: 'peek-sub' }, [now.artist, now.app].filter(Boolean).join(' · ') || 'Playing');
    const line = h('div', { class: 'peek-line', 'aria-hidden': 'true' });
    peekLyric = { sub, line, text: null };
    showLyric(false);
    return h(
      'div',
      { class: 'peek' },
      h('div', { class: 'peek-media' }, art),
      h('div', { class: 'peek-text', onclick: () => open('music') }, h('div', { class: 'peek-title' }, now.title || 'Unknown track'), sub, line),
      h(
        'div',
        { class: 'peek-actions' },
        iconButton('previous', 'Previous track', () => control('previous')),
        iconButton(now.playing ? 'pause' : 'play', now.playing ? 'Pause' : 'Play', () => control('toggle'), 'solid'),
        iconButton('next', 'Next track', () => control('next')),
      ),
    );
  }

  /** The line being sung replaces the artist under the title; the old line slides up and
   *  out as the new one rises in. Between lines (and without lyrics) the artist is back. */
  function showLyric(animate = true) {
    if (!peekLyric) return;
    const text = look().peekLyrics ? (currentLine()?.text ?? '') : '';
    if (text === peekLyric.text) return;
    peekLyric.text = text;
    peekLyric.sub.hidden = Boolean(text);
    peekLyric.line.hidden = !text;
    const old = peekLyric.line.lastElementChild;
    if (old && animate) {
      old.classList.add('leaving');
      setTimeout(() => old.remove(), 220);
    } else old?.remove();
    if (text) peekLyric.line.append(h('span', {}, text));
  }

  function peekTask(task, now) {
    const sub = h('div', { class: 'peek-sub' });
    peekTickers.push(() => (sub.textContent = `Due ${formatDue(task.due, false, Date.now())}, ${formatIn(reminderTime(task))} · ${listName(task.list)}`));
    return h(
      'div',
      { class: 'peek' },
      h('div', { class: 'peek-media', style: { '--peek-tint': listTint(task.list) } }, icon('bell')),
      h('div', { class: 'peek-text', onclick: () => open('today') }, h('div', { class: 'peek-title' }, task.title), sub),
      h(
        'div',
        { class: 'peek-actions' },
        iconButton('focus', 'Start focus on this task', () => {
          focus.start('focus', task.id);
        }),
        iconButton('check', 'Mark done', () => {
          setDone(task, true);
          cat.react('happy');
        }, 'solid'),
      ),
    );
  }

  function peekSummary(now) {
    const { done, total } = todayProgress(now);
    const progress = ring(40, 3.5);
    progress.set(total ? done / total : 0);
    const next = nextReminder(now);
    const title = total === 0 ? 'Nothing due today' : done === total ? 'Today is clear' : `${done} of ${total} done today`;
    const sub = next ? `Next: ${next.title} at ${formatTime(reminderTime(next))}` : 'Scroll down to open Tama';
    return h(
      'div',
      { class: 'peek' },
      h('div', { class: 'peek-media' }, progress.el),
      h('div', { class: 'peek-text', onclick: () => open('today') }, h('div', { class: 'peek-title' }, title), h('div', { class: 'peek-sub' }, sub)),
      h('div', { class: 'peek-actions' }, button('Add task', () => open('today', { compose: true }), { iconName: 'plus' })),
    );
  }

  function tick() {
    for (const update of barTickers) update();
    for (const update of peekTickers) update();
  }

  island.onChange(render);
  subscribe(render);
  onMedia(render);
  onLyrics(() => showLyric());
  onLine(() => showLyric());
  // A new look can change the clock, the dates and what rests in the bar: rebuild both rows.
  onLook(() => {
    barKey = '';
    peekKey = '';
    render();
  });
  // Cheap: nothing is rebuilt unless a key changed; otherwise only countdown text updates.
  setInterval(render, 1000);
  render();
}
