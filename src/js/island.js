// The island's state machine: rest, peek (hover), open, alert. One capsule whose width,
// height and radius move on a spring; content layers fade in behind the growing shape.
import { springGroup, springParams } from './spring.js';
import { invoke, listen } from './tauri.js';

const GAP = 6; // the capsule floats this far below the top edge (the notch style doesn't)
const SIZE = {
  rest: { w: 124, h: 34, r: 17 },
  live: { w: 228, h: 34, r: 17 },
  wide: { w: 268, h: 34, r: 17 }, // a resting clock with seconds or am/pm
  peek: { w: 384, h: 100, r: 30 },
  open: { w: 480, h: 468, r: 32 },
  alert: { w: 404, h: 132, r: 32 },
};
// The notch only rounds its lower corners, and less: it's a tab hanging from the edge.
const NOTCH_RADIUS = { rest: 13, live: 13, wide: 13, peek: 24, open: 28, alert: 28 };
// The soul style rests as just the soul.
const SOUL_REST = { w: 48, h: 34, r: 17 };
const EAR = 10; // px, matches .ear in island.css
const TEXT_INPUT = 'input:not([type]), input[type="text"], input[type="search"], input[type="password"], input[type="time"], input[type="date"], textarea';

export function createIsland(soul) {
  const el = document.getElementById('island');
  const bar = document.getElementById('bar');
  const layers = {
    peek: document.getElementById('layer-peek'),
    open: document.getElementById('layer-open'),
    alert: document.getElementById('layer-alert'),
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new Set();

  let state = 'rest';
  let live = 'rest'; // what rests in the bar: 'rest' (nothing), 'live' or 'wide'
  let hovered = false;
  let typing = false;
  let enterTimer = 0;
  let leaveTimer = 0;
  let lastScroll = 0;
  // From Personalise: island | notch | soul, the size multiplier, and whether hovering peeks.
  let look = { style: 'island', scale: 1, hoverPeek: true };
  const ears = [document.getElementById('ear-left'), document.getElementById('ear-right')];

  function paint({ w, h, r }) {
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    if (look.style === 'notch') {
      el.style.borderRadius = `0 0 ${r}px ${r}px`;
      const half = (w * look.scale) / 2;
      ears[0].style.translate = `${-half - EAR * look.scale}px 0`;
      ears[1].style.translate = `${half}px 0`;
    } else {
      el.style.borderRadius = `${r}px`;
    }
  }

  const shape = springGroup(SIZE.rest, springParams(0.5, 0.22), paint);

  function geometry() {
    if (look.style === 'soul' && state === 'rest') return SOUL_REST;
    const key = state === 'rest' ? live : state;
    return look.style === 'notch' ? { ...SIZE[key], r: NOTCH_RADIUS[key] } : SIZE[key];
  }

  function layout() {
    const g = geometry();
    shape.to(g, { instant: reducedMotion.matches });
    const s = look.scale;
    const top = look.style === 'notch' ? 0 : GAP;
    invoke('island_hit_rect', { x: (innerWidth - g.w * s) / 2, y: top, width: g.w * s, height: g.h * s }).catch(() => {});
  }

  function set(next) {
    clearTimeout(enterTimer);
    clearTimeout(leaveTimer);
    if (next === state) return;
    const previous = state;
    state = next;
    el.dataset.state = next;
    for (const [name, layer] of Object.entries(layers)) {
      const active = name === next;
      layer.toggleAttribute('data-active', active);
      layer.inert = !active;
    }
    if (previous === 'open') releaseKeyboard();
    soul.setAttentive(next !== 'rest' || hovered);
    layout();
    for (const listener of listeners) listener(next, previous);
  }

  /* Keyboard focus is borrowed only while a text field is in use. */
  async function borrowKeyboard(input) {
    if (!typing) {
      typing = true;
      await invoke('island_focus').catch(() => {});
    }
    input?.focus();
  }

  function releaseKeyboard() {
    if (!typing) return;
    typing = false;
    if (el.contains(document.activeElement)) document.activeElement.blur();
    invoke('island_release').catch(() => {});
  }

  function collapse() {
    set(hovered ? 'peek' : 'rest');
  }

  listen('island-hover', (inside) => {
    hovered = inside;
    clearTimeout(enterTimer);
    clearTimeout(leaveTimer);
    soul.setAttentive(inside || state !== 'rest');
    if (inside) {
      if (state === 'rest' && look.hoverPeek) enterTimer = setTimeout(() => set('peek'), 90);
    } else if (state === 'peek') {
      leaveTimer = setTimeout(() => set('rest'), 240);
    } else if (state === 'open' && !typing) {
      leaveTimer = setTimeout(() => set('rest'), 450);
    }
  });

  el.addEventListener('pointermove', (e) => soul.lookAt(e.clientX, e.clientY));

  bar.addEventListener('click', () => {
    if (state === 'open') set(hovered ? 'peek' : 'rest');
    else if (state !== 'alert') set('open');
  });

  el.addEventListener('scroll', () => (lastScroll = performance.now()), { capture: true, passive: true });
  el.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaY > 0 && (state === 'rest' || state === 'peek')) set('open');
      else if (e.deltaY < 0 && state === 'open' && !canScrollUp(e.target) && performance.now() - lastScroll > 300) collapse();
    },
    { passive: true },
  );

  el.addEventListener(
    'pointerdown',
    (e) => {
      const input = e.target.closest?.(TEXT_INPUT);
      if (input) borrowKeyboard(input);
    },
    true,
  );

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state === 'open') {
      e.preventDefault();
      set('rest');
    }
  });

  // Clicking into another app while typing: put the island away.
  addEventListener('blur', () => {
    if (!typing) return;
    typing = false;
    invoke('island_release').catch(() => {});
    if (state === 'open' && !hovered) set('rest');
  });

  function canScrollUp(target) {
    for (let node = target; node && node !== el; node = node.parentElement) {
      if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) return true;
    }
    return false;
  }

  layout();

  return {
    get state() {
      return state;
    },
    get hovered() {
      return hovered;
    },
    set,
    collapse,
    borrowKeyboard,
    releaseKeyboard,
    /** Applies Personalise: `{ style, scale, hoverPeek }`. The capsule morphs to the new shape. */
    setLook(next) {
      look = next;
      paint(shape.values); // corners and ears switch straight away; sizes then spring over
      layout();
    },
    /** What rests in the bar sets its width: 'rest' (nothing), 'live' or 'wide'. */
    setLive(value) {
      if (value === live) return;
      live = value;
      if (state === 'rest') layout();
    },
    onChange(listener) {
      listeners.add(listener);
    },
  };
}
