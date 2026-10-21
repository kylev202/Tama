// Launch: search Start's apps or the web; pin the apps you open most.
import { fill, h, iconButton } from '../dom.js';
import { icon } from '../icons.js';
import { commit, state } from '../store.js';
import { invoke } from '../tauri.js';

export const ENGINES = [
  { id: 'google', label: 'Google', iconName: 'globe', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: 'youtube', label: 'YouTube', iconName: 'video', url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { id: 'amazon', label: 'Amazon', iconName: 'cart', url: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
];

let appsPromise = null;
/** Start's app list, fetched once and shared with the routines editor. */
export function loadApps() {
  appsPromise ??= invoke('apps_list').catch((error) => {
    appsPromise = null;
    throw error;
  });
  return appsPromise;
}

const icons = new Map();
/** An app icon that fills in when the shell hands it over. */
export function appIcon(id, size = 32) {
  const holder = h('span', { class: 'app-icon skeleton', style: { width: `${size}px`, height: `${size}px` } });
  if (!icons.has(id)) icons.set(id, invoke('app_icon', { id }).catch(() => null));
  icons.get(id).then((src) => {
    holder.classList.remove('skeleton');
    holder.replaceChildren(src ? h('img', { src, alt: '' }) : icon('app'));
  });
  return holder;
}

export function matchApps(apps, query, limit = 6) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const app of apps) {
    const name = app.name.toLowerCase();
    let score = -1;
    if (name.startsWith(needle)) score = 3;
    else if (name.split(/[\s\-_.()]+/).some((word) => word.startsWith(needle))) score = 2;
    else if (name.includes(needle)) score = 1;
    if (score >= 0) scored.push([score, app]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length);
  return scored.slice(0, limit).map(([, app]) => app);
}

const looksLikeUrl = (text) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(text);

export default function launchPanel() {
  let app;
  let visible = false;
  let apps = [];
  let failed = false;
  let items = [];
  let active = 0;
  let els;

  function results(query) {
    const q = query.trim();
    if (!q) return [];
    const list = matchApps(apps, q).map((a) => ({ kind: 'app', app: a }));
    if (looksLikeUrl(q)) list.push({ kind: 'link', url: /^https?:\/\//i.test(q) ? q : `https://${q}` });
    for (const engine of ENGINES) list.push({ kind: 'web', engine, query: q });
    return list;
  }

  async function run(item) {
    try {
      if (item.kind === 'app') await invoke('app_launch', { id: item.app.id });
      else if (item.kind === 'link') await invoke('url_open', { url: item.url });
      else await invoke('url_open', { url: item.engine.url(item.query) });
      els.input.value = '';
      render();
      if (!app.island.pinned) app.island.set('rest');
    } catch (error) {
      app.toast('Could not open that. It may have been uninstalled.');
      console.error(error);
    }
  }

  function togglePin(id) {
    const pins = state.settings.pinnedApps;
    const index = pins.indexOf(id);
    if (index >= 0) pins.splice(index, 1);
    else pins.push(id);
    commit();
    render();
  }

  function render() {
    const query = els.input.value;
    items = results(query);
    active = Math.min(active, Math.max(0, items.length - 1));
    if (!query.trim()) renderPinned();
    else renderResults();
  }

  function renderPinned() {
    const pinned = state.settings.pinnedApps.map((id) => apps.find((a) => a.id === id)).filter(Boolean);
    if (failed) {
      fill(els.body, h('div', { class: 'empty' }, h('strong', {}, 'Could not read your apps'), 'Try opening this tab again in a moment.'));
      return;
    }
    if (!pinned.length) {
      fill(
        els.body,
        h(
          'div',
          { class: 'empty' },
          icon('pin'),
          h('strong', {}, 'Pin the apps you use most'),
          'Search for an app, then press its pin. You can also search Google, YouTube or Amazon from here.',
        ),
      );
      return;
    }
    fill(
      els.body,
      h(
        'div',
        { class: 'pin-grid' },
        pinned.map((a) =>
          h(
            'div',
            { class: 'pin' },
            h('button', { class: 'pin-main press', type: 'button', title: `Open ${a.name}`, onclick: () => run({ kind: 'app', app: a }) }, appIcon(a.id, 36), h('span', { class: 'pin-name' }, a.name)),
            iconButton('close', `Unpin ${a.name}`, () => togglePin(a.id), 'pin-remove'),
          ),
        ),
      ),
    );
  }

  function renderResults() {
    fill(
      els.body,
      h(
        'div',
        { class: 'results', role: 'listbox', 'aria-label': 'Results' },
        items.map((item, index) => {
          const selected = index === active;
          const pinned = item.kind === 'app' && state.settings.pinnedApps.includes(item.app.id);
          let lead;
          let text;
          if (item.kind === 'app') {
            lead = appIcon(item.app.id, 28);
            text = item.app.name;
          } else if (item.kind === 'link') {
            lead = h('span', { class: 'result-glyph' }, icon('link'));
            text = `Open ${item.url.replace(/^https?:\/\//i, '')}`;
          } else {
            lead = h('span', { class: 'result-glyph' }, icon(item.engine.iconName));
            text = `Search ${item.engine.label} for “${item.query}”`;
          }
          return h(
            'div',
            { class: `result${selected ? ' active' : ''}`, role: 'option', 'aria-selected': String(selected) },
            h(
              'button',
              { class: 'result-main press', type: 'button', onclick: () => run(item), onpointerenter: () => setActive(index) },
              lead,
              h('span', { class: 'result-text' }, text),
            ),
            item.kind === 'app'
              ? h(
                  'button',
                  {
                    class: `icon-btn press pin-toggle${pinned ? ' on' : ''}`,
                    type: 'button',
                    'aria-pressed': String(pinned),
                    'aria-label': pinned ? `Unpin ${item.app.name}` : `Pin ${item.app.name}`,
                    title: pinned ? 'Unpin' : 'Pin',
                    onclick: () => togglePin(item.app.id),
                  },
                  icon('pin'),
                )
              : null,
          );
        }),
      ),
    );
  }

  function setActive(index) {
    if (index === active) return;
    active = index;
    const rows = els.body.querySelectorAll('.result');
    rows.forEach((row, i) => {
      row.classList.toggle('active', i === active);
      row.setAttribute('aria-selected', String(i === active));
    });
    rows[active]?.scrollIntoView({ block: 'nearest' });
  }

  return {
    id: 'launch',
    label: 'Launch',
    icon: 'search',
    mount(view, context) {
      app = context;
      const input = h('input', {
        type: 'text',
        placeholder: 'Search apps or the web',
        'aria-label': 'Search apps or the web',
        maxlength: 300,
        oninput: () => {
          active = 0;
          render();
        },
        onkeydown: (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            run(items[active]);
          } else if (e.key === 'Escape' && input.value) {
            e.stopPropagation();
            input.value = '';
            render();
          }
        },
      });
      const body = h('div', { class: 'launch-body scroll' });
      view.append(h('label', { class: 'field' }, icon('search'), input), body);
      els = { input, body };
    },
    async show({ user } = {}) {
      visible = true;
      if (user) app.island.borrowKeyboard(els.input);
      try {
        apps = await loadApps();
        failed = false;
      } catch {
        failed = true;
      }
      if (visible) render();
    },
    hide() {
      visible = false;
    },
  };
}
