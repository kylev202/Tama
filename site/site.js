// Tama's website. The island at the top is the app itself (demo/, with a stand-in for the
// native side); this script lets the page reach it the way Windows does, and wires each
// section to it. The app's pure modules are reused as they are: the soul, quick add, times
// and icons.
import { icon } from './demo/js/icons.js';
import { parseQuickAdd } from './demo/js/parse.js';
import { createSoul } from './demo/js/soul.js';
import { formatClock, formatDue, formatTime, startOfDay } from './demo/js/time.js';

const $ = (id) => document.getElementById(id);
const frame = $('island-demo');
let demo = null;

/* The island. As in the Rust app, only the capsule takes the pointer: the frame lets every
   click through until the pointer is over the capsule, and the demo says when it leaves. */

let rect = null;
let live = false;

function fit() {
  document.documentElement.style.setProperty('--demo-scale', String(Math.min(1, (innerWidth - 24) / 480)));
}
fit();
addEventListener('resize', fit);

function overCapsule(x, y) {
  if (!rect) return false;
  const box = frame.getBoundingClientRect();
  const s = box.width / 600;
  const fx = (x - box.left) / s;
  const fy = (y - box.top) / s;
  return fx >= rect.x && fx < rect.x + rect.width && fy >= 0 && fy < rect.y + rect.height;
}

function setLive(next) {
  if (next === live) return;
  live = next;
  frame.classList.toggle('live', next);
}

addEventListener(
  'pointermove',
  (e) => {
    if (e.pointerType === 'mouse' && overCapsule(e.clientX, e.clientY)) setLive(true);
  },
  { passive: true },
);

// Touch has no hover. A tap on the capsule lets the pointer through, so the tap's click lands
// on the island and opens it; if the click stays on the page instead, open it from here. A
// tap elsewhere puts it away.
let tapped = 0;
addEventListener('pointerdown', (e) => {
  if (!demo) return;
  if (overCapsule(e.clientX, e.clientY)) {
    setLive(true);
    seen();
    tapped = performance.now();
  } else if (demo.isOpen() && !e.target.closest('[data-demo]')) demo.close();
});
addEventListener(
  'click',
  () => {
    if (demo && performance.now() - tapped < 600 && !demo.isOpen()) demo.open();
    tapped = 0;
  },
  true,
);

const hint = $('hint');
function seen() {
  hint.classList.add('seen');
}

// What the demo calls back on (same origin).
window.tamaSite = {
  ready: connect,
  rect(next) {
    rect = next;
  },
  hover(inside) {
    if (inside) seen();
    else setLive(false);
  },
  media: renderPlayer,
  wallpaper: setWallpaper,
  quit: restartDemo,
};

// The demo may have finished loading before this script ran.
if (frame.contentWindow?.tamaDemo) connect(frame.contentWindow.tamaDemo);
frame.addEventListener('load', () => {
  if (frame.contentWindow?.tamaDemo && demo !== frame.contentWindow.tamaDemo) connect(frame.contentWindow.tamaDemo);
});

/** Hooks the page up to a (re)loaded demo. Subscriptions die with the old frame. */
function connect(api) {
  demo = api;
  rect = api.rect();
  renderControls();
  syncLook();
  api.subscribe(() => {
    syncLook();
    renderFocus();
  });
  api.music.onMedia(renderPlayer);
  api.music.onLyrics(renderLyrics);
  api.music.onLine(highlight);
  renderFocus();
}

/** "Quit Tama" in the demo: it goes, then comes back as if started again. */
function restartDemo() {
  frame.classList.add('quitting');
  setLive(false);
  setTimeout(() => {
    demo = null;
    rect = null;
    frame.contentWindow.location.reload();
  }, 500);
  frame.addEventListener('load', () => frame.classList.remove('quitting'), { once: true });
}

/** Setting a wallpaper in the demo tints this page, softly, behind everything. */
function setWallpaper(url) {
  let layer = document.querySelector('.wallpaper');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'wallpaper';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }
  layer.style.backgroundImage = `url("${url}")`;
  requestAnimationFrame(() => layer.classList.add('on'));
}

/* Buttons that drive the demo. */

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (!button || !demo) return;
  const { action, tab } = button.dataset;
  const music = demo.music;
  if (action === 'open') demo.open(tab);
  else if (action === 'remind') demo.remind();
  else if (action === 'focus-start') demo.focus.start();
  else if (action === 'focus-pause') demo.focus.pause();
  else if (action === 'focus-resume') demo.focus.resume();
  else if (action === 'focus-stop') demo.focus.stop();
  else if (action === 'toggle') music.media.now ? music.control('toggle') : music.play();
  else if (action === 'next' || action === 'previous') music.media.now ? music.control(action) : music.play();
  seen();
});

/* The hero: the soul over the lake, at seven times its island size. */

const heroCanvas = $('hero-soul');
const heroSoul = createSoul(heroCanvas, { scale: 7 });
let restless = 0;
document.querySelector('.hero').addEventListener(
  'pointermove',
  (e) => {
    heroSoul.setAttentive(true);
    heroSoul.lookAt(e.clientX, e.clientY);
    clearTimeout(restless);
    restless = setTimeout(() => heroSoul.setAttentive(false), 2500);
  },
  { passive: true },
);
heroCanvas.addEventListener('click', () => heroSoul.react('celebrate'));
new IntersectionObserver(([entry]) => (entry.isIntersecting ? heroSoul.start() : heroSoul.stop())).observe(heroCanvas);

/* Quick add: the app's own parser, live as you type. */

const quickadd = $('quickadd');
const quickInput = $('quickadd-input');
const parsedList = $('parsed');
const PRIORITY = { 1: 'Low priority', 2: 'Medium priority', 3: 'High priority' };
const REPEAT = { daily: 'Repeats daily', weekdays: 'Every weekday', weekly: 'Repeats weekly', monthly: 'Repeats monthly' };
const LISTS = { work: ['Work', 'var(--work)'], study: ['Study', 'var(--study)'] };

function describeDue({ due, allDay }) {
  if (due == null) return null;
  const sameDay = startOfDay(due) === startOfDay();
  return sameDay && !allDay ? `Today ${formatTime(due)}` : formatDue(due, allDay);
}

function chips(parsed) {
  const list = [['title', parsed.title || 'Add a title', parsed.title ? null : 'muted']];
  const when = describeDue(parsed);
  if (when) list.push(['when', when]);
  if (parsed.list) list.push(['list', LISTS[parsed.list][0], LISTS[parsed.list][1]]);
  if (parsed.priority) list.push(['priority', PRIORITY[parsed.priority]]);
  if (parsed.repeat) list.push(['repeat', REPEAT[parsed.repeat]]);
  return list;
}

/** Keyed, so only a chip that's new animates in; the rest just change their words. */
function renderParsed() {
  const next = chips(parseQuickAdd(quickInput.value));
  const old = new Map([...parsedList.children].map((li) => [li.dataset.key, li]));
  let fresh = 0;
  const items = next.map(([key, text, tint]) => {
    let li = old.get(key);
    if (!li) {
      li = document.createElement('li');
      li.dataset.key = key;
      li.style.setProperty('--i', String(fresh++));
      li.append(document.createElement('span'));
    }
    const label = li.lastElementChild;
    if (label.textContent !== text) label.textContent = text;
    li.classList.toggle('muted', tint === 'muted');
    const dot = tint && tint !== 'muted';
    if (dot && li.firstElementChild === label) li.prepend(Object.assign(document.createElement('i'), { className: 'dot' }));
    if (!dot && li.firstElementChild !== label) li.firstElementChild.remove();
    if (dot) li.style.setProperty('--tint', tint);
    return li;
  });
  parsedList.replaceChildren(...items);
}
quickInput.addEventListener('input', renderParsed);
renderParsed();

quickadd.addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseQuickAdd(quickInput.value);
  if (!parsed.title || !demo) return quickInput.focus();
  demo.add(parsed);
  seen();
});

/* Focus: the page's dial follows the demo's session. */

const focusSection = $('focus');
const focusTime = $('focus-time');
const focusTask = $('focus-task');
const focusProgress = $('focus-progress');
const focusButtons = Object.fromEntries([...focusSection.querySelectorAll('[data-action]')].map((b) => [b.dataset.action, b]));
let focusTimer = 0;
let focusVisible = false;

function renderFocus() {
  clearTimeout(focusTimer);
  if (!demo) return;
  const session = demo.focus.session();
  const running = Boolean(session && session.pausedLeft == null);
  focusSection.toggleAttribute('data-active', Boolean(session));
  focusSection.toggleAttribute('data-running', running);
  focusTime.textContent = formatClock(session ? demo.focus.remaining() : 25 * 60_000);
  focusTask.textContent = session ? (session.kind === 'break' ? 'Break' : (demo.focus.task()?.title ?? 'Focus')) : 'Read chapter 4: graphs';
  focusProgress.style.setProperty('--progress', String(session ? demo.focus.progress() : 0));
  focusButtons['focus-start'].hidden = Boolean(session);
  focusButtons['focus-pause'].hidden = !running;
  focusButtons['focus-resume'].hidden = !session || running;
  focusButtons['focus-stop'].hidden = !session;
  // Tick on the second, and only while someone can see it.
  if (running && focusVisible) focusTimer = setTimeout(renderFocus, (demo.focus.remaining() % 1000) + 20);
}

/* Music: the player and big lyrics follow the demo's song. */

const musicSection = $('music');
const player = $('player');
const lyricsFrame = document.querySelector('.lyrics-frame');
const lyricsList = $('lyrics');

function renderPlayer() {
  if (!demo) return;
  const { media } = demo.music;
  const now = media.now;
  player.toggleAttribute('data-playing', Boolean(now?.playing));
  $('player-toggle').setAttribute('aria-label', now?.playing ? 'Pause' : 'Play');
  $('player-title').textContent = now?.title ?? 'Lantern Hours';
  $('player-artist').textContent = now ? [now.artist, now.album].filter(Boolean).join(' · ') : 'Low Tide Radio · Night Ferry';
  const art = $('player-art');
  if (media.art && art.getAttribute('src') !== media.art) art.src = media.art;
  musicSection.style.setProperty('--music-tint', media.tint ?? 'var(--soul)');
}

function renderLyrics(lyrics) {
  if (lyrics.status === 'synced') {
    lyricsList.replaceChildren(
      ...lyrics.lines.map((line) => {
        const li = document.createElement('li');
        if (line.text) li.textContent = line.text;
        else {
          li.className = 'gap';
          li.setAttribute('aria-label', 'Instrumental break');
          li.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
        }
        li.addEventListener('click', () => {
          if (!demo.music.media.now?.playing) demo.music.control('toggle');
          demo.music.seek(line.time);
        });
        return li;
      }),
    );
    highlight(lyrics.index);
    return;
  }
  const note =
    lyrics.status === 'instrumental'
      ? 'An instrumental. Nothing to sing along to, so the island says so.'
      : lyrics.status === 'loading'
        ? 'Finding the words…'
        : 'Press play, and the words keep time with the song.';
  const li = document.createElement('li');
  li.className = 'note current';
  li.textContent = note;
  lyricsList.replaceChildren(li);
  lyricsList.style.setProperty('--shift', '0px');
}

/** Glides the sung line to a third of the way down; lines below follow a beat apart. */
function highlight(index) {
  const items = [...lyricsList.children];
  if (!items.length || items[0].classList.contains('note')) return;
  const target = items[Math.max(0, index)];
  const shift = lyricsFrame.clientHeight * 0.32 - (target.offsetTop + target.offsetHeight / 2);
  items.forEach((li, i) => {
    const away = Math.abs(i - index);
    li.classList.toggle('current', i === index);
    li.classList.toggle('far', away >= 2);
    li.style.transitionDelay = i > index ? `${Math.min(i - index, 6) * 42}ms` : '0ms';
  });
  lyricsList.style.setProperty('--shift', `${Math.round(shift)}px`);
}

/* Personalise: the page's controls set the demo's look, and the page takes its accent. */

const controls = $('controls');
const GROUPS = [
  ['accents', 'accent'],
  ['styles', 'style'],
  ['surfaces', 'surface'],
  ['decorations', 'decoration'],
];

function renderControls() {
  const look = demo.look();
  for (const [id, name] of GROUPS) {
    const group = $(id);
    group.replaceChildren(
      ...demo.choices[name].map(([value, label, l, c, h]) => {
        const option = document.createElement('label');
        const input = Object.assign(document.createElement('input'), { type: 'radio', name, value, checked: look[name] === value });
        const face = document.createElement('span');
        if (name === 'accent') {
          option.className = 'swatch';
          option.style.setProperty('--c', `oklch(${l} ${c} ${h})`);
          option.title = label;
          face.className = 'visually-hidden';
        } else option.className = 'seg';
        face.textContent = label;
        option.append(input, face);
        return option;
      }),
    );
  }
}

controls.addEventListener('change', (e) => {
  if (demo && e.target.name) demo.setLook({ [e.target.name]: e.target.value });
});

let accentKey = '';
function syncLook() {
  const look = demo.look();
  for (const [, name] of GROUPS) {
    const input = controls.querySelector(`input[name="${name}"][value="${look[name]}"]`);
    if (input && !input.checked) input.checked = true;
  }
  frame.style.colorScheme = look.surface === 'light' ? 'light' : 'dark';
  if (look.accent === accentKey) return;
  accentKey = look.accent;
  const [, , l, c, h] = demo.choices.accent.find(([id]) => id === look.accent) ?? demo.choices.accent[0];
  document.documentElement.style.setProperty('--accent', `oklch(${l} ${c} ${h})`);
  heroSoul.setTint({ c, h });
}

/* Icons for the desktop tools, from the app's own set. */

for (const slot of document.querySelectorAll('[data-icon]')) slot.append(icon(slot.dataset.icon));

/* Scenes: the island acts out the section you're reading, once, unless you're using it. */

const played = new Set();
const dwell = new Map(); // a section has to stay in view a moment: scrolling past doesn't count
function act(section) {
  if (!demo || demo.isOpen() || played.has(section.id)) return;
  played.add(section.id);
  if (section === focusSection && !demo.focus.session()) demo.focus.start();
  if (section === musicSection && !demo.music.media.now?.playing) demo.music.play();
}
const scenes = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.target === focusSection) {
        focusVisible = entry.isIntersecting;
        renderFocus();
      }
      clearTimeout(dwell.get(entry.target));
      if (entry.isIntersecting) dwell.set(entry.target, setTimeout(() => act(entry.target), 700));
    }
  },
  { rootMargin: '-30% 0px -30% 0px' },
);
scenes.observe(focusSection);
scenes.observe(musicSection);
