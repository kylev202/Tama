// Personalise: every choice about how Tama looks and behaves, on one page inside Settings.
// Changes apply at once, so the island itself is the preview.
import {
  ACCENTS,
  DATES,
  DECORATIONS,
  FONTS,
  look,
  LYRIC_SIZES,
  onLook,
  OPEN_TO,
  resetLook,
  setLook,
  SIZES,
  STANDBY,
  STYLES,
  SURFACES,
} from '../appearance.js';
import { button, fill, h, iconButton } from '../dom.js';
import { icon } from '../icons.js';
import { invoke } from '../tauri.js';
import { formatLongDate } from '../time.js';

const NS = 'http://www.w3.org/2000/svg';

export function createPersonalise({ back, app }) {
  const body = h('div', { class: 'pz-body' });
  const el = h(
    'div',
    { class: 'pz', hidden: true },
    h(
      'div',
      { class: 'pz-head' },
      iconButton('chevronLeft', 'Back to Settings', back),
      h('span', { class: 'pz-title' }, 'Personalise'),
      h('span', { class: 'spacer' }),
      button('Reset', reset, { kind: 'ghost', label: 'Reset Personalise to the defaults' }),
    ),
    body,
  );

  function reset() {
    const previous = { ...look() };
    resetLook();
    app.toast('Back to the defaults', { label: 'Undo', run: () => setLook(previous) });
  }

  function render() {
    // Every control is rebuilt on a change; keep keyboard focus on the one that was used.
    const focused = el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const l = look();
    const catStyle = l.style === 'cat';
    const catOn = catStyle || l.cat;
    fill(
      body,
      section(
        'Style',
        h(
          'div',
          { class: 'style-tiles', role: 'group', 'aria-label': 'Style' },
          STYLES.map(([id, name, hint]) => styleTile(id, name, hint, l.style === id)),
        ),
        group(
          choiceRow('Size', 'size', SIZES, l.size),
          switchRow('Show the cat', 'cat', catOn, { disabled: catStyle, note: catStyle ? 'Always on in the Cat style' : null }),
          switchRow('Cat antics', 'antics', catOn && l.antics, {
            disabled: !catOn,
            note: catOn ? 'Yawns, naps and chases fireflies when left alone' : 'The cat is off',
          }),
          stackRow(
            ['Standby', h('span', { class: 'set-sub' }, catOn ? "Shows in the cat's place while the cat is off" : "In the cat's place while the island rests")],
            h(
              'div',
              { class: 'chips', role: 'group', 'aria-label': 'Standby' },
              STANDBY.map(([id, name]) => {
                const option = chip(`standby:${id}`, name, l.standby === id, () => setLook({ standby: id }));
                option.disabled = catOn;
                return option;
              }),
            ),
          ),
        ),
      ),
      section(
        'Colour',
        group(
          stackRow(
            'Accent',
            h(
              'div',
              { class: 'swatches', role: 'group', 'aria-label': 'Accent' },
              ACCENTS.map(([id, name, L, C, H]) => swatch(id, name, `oklch(${L} ${C} ${H})`, l.accent === id)),
            ),
          ),
          choiceRow('Theme', 'surface', SURFACES, l.surface),
          stackRow(
            'Background',
            h('div', { class: 'deco-tiles', role: 'group', 'aria-label': 'Background' }, DECORATIONS.map(([id, name]) => decoTile(id, name, l.decoration === id))),
          ),
        ),
      ),
      section(
        'Text',
        group(
          stackRow(
            'Font',
            h(
              'div',
              { class: 'chips', role: 'group', 'aria-label': 'Font' },
              FONTS.map(([id, name]) => chip(`font:${id}`, name, l.font === id, () => setLook({ font: id }), { 'font-family': `var(--font-${id})` }, 'font')),
            ),
          ),
          choiceRow('Lyrics size', 'lyricSize', LYRIC_SIZES, l.lyricSize),
        ),
      ),
      section(
        'Time and date',
        group(
          choiceRow('Clock', 'clock24', [[true, '24-hour'], [false, '12-hour']], l.clock24),
          switchRow('Show seconds', 'seconds', l.seconds),
          switchRow('Clock in the resting island', 'restClock', l.restClock && !catStyle, {
            disabled: catStyle,
            note: catStyle ? 'The Cat style rests as just the cat' : null,
          }),
          stackRow(
            'Dates',
            h(
              'div',
              { class: 'chips', role: 'group', 'aria-label': 'Date format' },
              DATES.map((id) => chip(`dates:${id}`, formatLongDate(Date.now(), id), l.dates === id, () => setLook({ dates: id }))),
            ),
          ),
          choiceRow('Week starts on', 'weekStart', [[1, 'Monday'], [0, 'Sunday']], l.weekStart),
        ),
      ),
      section(
        'Behaviour',
        group(
          switchRow('Quick controls on hover', 'hoverPeek', l.hoverPeek),
          switchRow('Lyric line on hover', 'peekLyrics', l.peekLyrics),
          choiceRow('Open to', 'openTo', OPEN_TO, l.openTo),
        ),
      ),
      h(
        'button',
        { class: 'pz-link press', type: 'button', onclick: () => invoke('settings_open', { page: 'personalization' }).catch(() => {}) },
        icon('palette'),
        h('span', { class: 'set-label' }, 'Windows wallpaper, colours and themes'),
        icon('chevronRight'),
      ),
    );
    if (focused) body.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
  }

  /* Building blocks */

  const section = (title, ...children) => h('section', { class: 'pz-section' }, h('h3', { class: 'pz-heading' }, title), children);
  const group = (...rows) => h('div', { class: 'set-group' }, rows);
  const stackRow = (label, content) => h('div', { class: 'set-row stack' }, h('span', { class: 'set-label' }, label), content);

  function chip(key, label, pressed, onclick, style, extra = '') {
    return h('button', { class: `chip press ${extra}`.trim(), type: 'button', 'aria-pressed': String(pressed), dataset: { key }, style, onclick }, label);
  }

  /** A row with a small segmented choice on the right. */
  function choiceRow(label, key, options, value) {
    return h(
      'div',
      { class: 'set-row' },
      h('span', { class: 'set-label' }, label),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': label },
        options.map(([id, name]) =>
          h(
            'button',
            { type: 'button', 'aria-pressed': String(value === id), dataset: { key: `${key}:${id}` }, onclick: () => setLook({ [key]: id }) },
            name,
          ),
        ),
      ),
    );
  }

  function switchRow(label, key, on, { disabled = false, note = null } = {}) {
    return h(
      'div',
      { class: 'set-row' },
      h('span', { class: 'set-label' }, label, note ? h('span', { class: 'set-sub' }, note) : null),
      h('button', {
        class: 'switch',
        type: 'button',
        role: 'switch',
        'aria-checked': String(on),
        'aria-label': label,
        disabled,
        dataset: { key },
        onclick: () => setLook({ [key]: !on }),
      }),
    );
  }

  function styleTile(id, name, hint, pressed) {
    return h(
      'button',
      { class: 'style-tile press', type: 'button', 'aria-pressed': String(pressed), dataset: { key: `style:${id}` }, onclick: () => setLook({ style: id }) },
      h('span', { class: 'style-preview', dataset: { style: id }, 'aria-hidden': 'true' }, h('span', { class: 'shape' }, miniCat())),
      h('span', { class: 'style-name' }, name),
      h('span', { class: 'style-hint' }, hint),
    );
  }

  function swatch(id, name, color, pressed) {
    return h('button', {
      class: 'swatch press',
      type: 'button',
      'aria-pressed': String(pressed),
      'aria-label': name,
      title: name,
      dataset: { key: `accent:${id}` },
      style: { '--swatch': color },
      onclick: () => setLook({ accent: id }),
    });
  }

  function decoTile(id, name, pressed) {
    return h(
      'button',
      { class: 'deco-tile press', type: 'button', 'aria-pressed': String(pressed), dataset: { key: `decoration:${id}` }, onclick: () => setLook({ decoration: id }) },
      h('span', { class: 'deco-preview', 'aria-hidden': 'true' }, id === 'none' ? null : h('i', { class: id === 'artwork' ? 'art' : '', style: { background: `var(--deco-${id})` } })),
      name,
    );
  }

  /** The cat, small and still, for the style previews. */
  function miniCat() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '14.5 9 19 19');
    svg.setAttribute('class', 'mini-cat');
    svg.innerHTML =
      '<path d="M16.6 16.3L17.13 11.39Q17.36 9.29 18.58 10.39L21.42 12.97ZM31.4 16.3L30.87 11.39Q30.64 9.29 29.42 10.39L26.58 12.97Z"/>' +
      '<path d="M15.4 20C15.4 15.86 19.18 12.6 24 12.6C28.82 12.6 32.6 15.86 32.6 20C32.6 25.03 29.85 27.4 24 27.4C18.15 27.4 15.4 25.03 15.4 20Z"/>' +
      '<rect x="19.95" y="18.65" width="1.9" height="3.3" rx=".95"/><rect x="26.15" y="18.65" width="1.9" height="3.3" rx=".95"/>';
    return svg;
  }

  onLook(() => !el.hidden && render());

  return { el, render };
}
