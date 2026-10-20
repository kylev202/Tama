// Alerts: the island opens by itself when something needs an answer. One at a time; the
// rest wait their turn.
import { button, fill, h } from './dom.js';
import { icon } from './icons.js';
import { chime } from './sound.js';

export function createAlerts({ island, soul }) {
  const layer = document.getElementById('layer-alert');
  const queue = [];
  let current = null;
  let timer = 0;

  function show(alert) {
    queue.push(alert);
    if (!current) next();
  }

  function next() {
    clearTimeout(timer);
    current = queue.shift() ?? null;
    if (!current) {
      if (island.state === 'alert') island.collapse();
      return;
    }
    const { tint = 'var(--soul)', iconName = 'bell', title, sub = '', actions = [], timeout = 30_000 } = current;
    fill(
      layer,
      h(
        'div',
        { class: 'alert', style: { '--alert-tint': tint } },
        h('div', { class: 'alert-icon' }, icon(iconName)),
        h('div', { class: 'alert-text' }, h('div', { class: 'alert-title' }, title), h('div', { class: 'alert-sub' }, sub)),
        h(
          'div',
          { class: 'alert-actions' },
          actions.map((action) =>
            button(
              action.label,
              () => {
                action.run?.();
                next();
              },
              { kind: action.primary ? 'primary' : '' },
            ),
          ),
        ),
      ),
    );
    island.set('alert');
    chime();
    timer = setTimeout(next, timeout);
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) {
      e.preventDefault();
      next();
    }
  });

  return { show };
}
