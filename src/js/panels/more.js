// More: the desktop tools that aren't tasks or music, behind one tab with its own row of
// sections. Each section is an ordinary panel; it mounts the first time it's shown.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { commit, state } from '../store.js';

export default function morePanel(panels) {
  let app;
  let visible = false;
  let current = null;
  let entries = [];

  function mount(view, context) {
    app = context;
    const row = h('nav', { class: 'subtabs', role: 'tablist', 'aria-label': 'More' });
    const body = h('div', { class: 'subviews' });
    entries = panels.map((panel) => {
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
          onclick: () => pick(panel.id, { user: true }),
        },
        icon(panel.icon),
        h('span', { class: 'tab-label' }, panel.label),
      );
      const section = h('div', { class: 'subview', role: 'tabpanel', id: `view-${panel.id}`, 'aria-labelledby': `tab-${panel.id}`, hidden: true });
      row.append(tab);
      body.append(section);
      return { panel, tab, view: section, mounted: false };
    });

    // Arrow keys move between sections, like the main tabs.
    row.addEventListener('keydown', (e) => {
      const index = entries.indexOf(current);
      const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: entries.length - 1 }[e.key];
      if (target == null) return;
      e.preventDefault();
      const entry = entries[(target + entries.length) % entries.length];
      pick(entry.panel.id, { user: true });
      entry.tab.focus();
    });

    view.append(row, body);
    pick(state.settings.more);
  }

  function pick(id, options = {}) {
    const next = entries.find((entry) => entry.panel.id === id) ?? entries[0];
    if (current !== next) {
      if (current) {
        current.tab.setAttribute('aria-selected', 'false');
        current.tab.tabIndex = -1;
        current.view.hidden = true;
        if (visible) current.panel.hide?.();
      }
      current = next;
      next.tab.setAttribute('aria-selected', 'true');
      next.tab.tabIndex = 0;
      next.view.hidden = false;
      if (!next.mounted) {
        next.panel.mount(next.view, app);
        next.mounted = true;
      }
      if (state.settings.more !== next.panel.id) {
        state.settings.more = next.panel.id;
        commit();
      }
    }
    if (visible) next.panel.show?.(options);
  }

  return {
    id: 'more',
    label: 'More',
    icon: 'more',
    children: panels.map((panel) => panel.id),
    mount,
    /** Makes a section current without showing it (the island may still be closed). */
    select(id) {
      if (entries.length) pick(id);
      else state.settings.more = id;
    },
    show(options = {}) {
      visible = true;
      pick(options.sub ?? current?.panel.id ?? state.settings.more, options);
    },
    hide() {
      visible = false;
      current?.panel.hide?.();
    },
  };
}
