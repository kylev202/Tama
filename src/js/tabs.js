// The open island's tabs. Panels mount the first time they're shown. A panel can own
// sections of its own (`children`); selecting one of those selects its owner.
import { h } from './dom.js';
import { icon } from './icons.js';
import { commit, state } from './store.js';

export function createTabs(island, panels, app) {
  const tabList = document.getElementById('tabs');
  const views = document.getElementById('views');
  let current = null;

  const entries = panels.map((panel) => {
    const tab = h(
      'button',
      {
        class: 'tab',
        type: 'button',
        role: 'tab',
        id: `tab-${panel.id}`,
        'aria-controls': `view-${panel.id}`,
        'aria-selected': 'false',
        tabindex: '-1',
        title: panel.label,
        onclick: () => select(panel.id, { user: true }),
      },
      icon(panel.icon),
      h('span', { class: 'tab-label' }, panel.label),
    );
    const view = h('div', { class: 'view', role: 'tabpanel', id: `view-${panel.id}`, 'aria-labelledby': `tab-${panel.id}`, hidden: true });
    tabList.append(tab);
    views.append(view);
    return { panel, tab, view, mounted: false };
  });

  function select(id, options = {}) {
    const next = entries.find((entry) => entry.panel.id === id || entry.panel.children?.includes(id)) ?? entries[0];
    const sub = next.panel.children?.includes(id) ? id : undefined;
    if (current !== next) {
      if (current) {
        current.tab.setAttribute('aria-selected', 'false');
        current.tab.tabIndex = -1;
        current.view.hidden = true;
        current.panel.hide?.();
      }
      current = next;
      next.tab.setAttribute('aria-selected', 'true');
      next.tab.tabIndex = 0;
      next.view.hidden = false;
      if (!next.mounted) {
        next.panel.mount(next.view, app);
        next.mounted = true;
      }
      if (state.settings.tab !== next.panel.id) {
        state.settings.tab = next.panel.id;
        commit();
      }
    }
    if (sub) next.panel.select?.(sub);
    if (island.state === 'open') next.panel.show?.(sub ? { ...options, sub } : options);
  }

  // Arrow keys move between tabs (roving tabindex).
  tabList.addEventListener('keydown', (e) => {
    const index = entries.indexOf(current);
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: entries.length - 1 }[e.key];
    if (target == null) return;
    e.preventDefault();
    const entry = entries[(target + entries.length) % entries.length];
    select(entry.panel.id, { user: true });
    entry.tab.focus();
  });

  island.onChange((next, previous) => {
    if (next === 'open') {
      // Personalise can pin the tab the island opens to. A link that opens a particular tab
      // (app.open) selects it again right after, so it still wins.
      const preferred = state.settings.look.openTo;
      if (preferred !== 'last' && current?.panel.id !== preferred) select(preferred);
      else current?.panel.show?.({});
    } else if (previous === 'open') current?.panel.hide?.();
  });

  select(state.settings.tab);

  return {
    select,
    get current() {
      return current?.panel.id;
    },
  };
}
