// How hard the PC is working right now, with the last minute drawn beside each number.
// Samples are asked for once a second while the section is open, and never otherwise.
import { h } from '../dom.js';
import { invoke } from '../tauri.js';
import { formatDuration } from '../time.js';

const POINTS = 60; // a minute of history
const GB = 2 ** 30;

const gb = (bytes) => (bytes / GB).toFixed(bytes >= 100 * GB ? 0 : 1);
const percent = (value) => (value == null ? '–' : `${Math.round(value)}%`);
const speed = (bytes) => (bytes == null ? '–' : bytes < 1e6 ? `${Math.round(bytes / 1e3)} KB/s` : `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB/s`);
const uptime = (s) => (s >= 86_400 ? `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h` : formatDuration(s * 1000));

// The percentage rows: each one's value and the detail under its name.
const GAUGES = [
  { label: 'CPU', value: (s) => s.cpu, detail: (s) => s.cpuSpeed && `${s.cpuSpeed.toFixed(2)} GHz` },
  { label: 'GPU', value: (s) => s.gpu, detail: (s) => s.gpuMemory && `${gb(s.gpuMemory)} GB memory` },
  { label: 'Memory', value: (s) => (s.memoryUsed / s.memoryTotal) * 100, detail: (s) => `${gb(s.memoryUsed)} of ${gb(s.memoryTotal)} GB` },
  { label: 'Disk', value: (s) => s.disk, detail: () => 'Active time' },
];

function svg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** A line through the history, newest on the right, scaled so `max` is the top. */
function line(values, max) {
  if (values.every((v) => v == null)) return '';
  const start = POINTS - values.length;
  return values.map((v, i) => `${i ? 'L' : 'M'}${start + i} ${(100 - (Math.min(v ?? 0, max) / max) * 100).toFixed(1)}`).join('');
}

/** A graph of one or more lines; only the first is filled. */
function graph(names) {
  const el = svg('svg', { class: 'stat-graph', viewBox: `0 0 ${POINTS - 1} 100`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const base = svg('path', { class: 'stat-base', d: `M0 100H${POINTS - 1}` });
  const area = svg('path', { class: 'stat-area' });
  const lines = names.map((name) => svg('path', { class: `stat-line ${name}` }));
  el.append(base, area, ...lines);
  return {
    el,
    draw(histories, max) {
      histories.forEach((values, i) => lines[i].setAttribute('d', line(values, max)));
      const first = line(histories[0], max);
      area.setAttribute('d', first && `${first}L${POINTS - 1} 100L${POINTS - histories[0].length} 100Z`);
    },
  };
}

/** A row: name and detail on the left, the graph, then the value. */
function row(label, graphEl, valueEl) {
  const detail = h('span', { class: 'stat-detail' });
  const el = h(
    'div',
    { class: 'stat-row', role: 'group', 'aria-label': label },
    h('div', { class: 'stat-name' }, h('span', { class: 'stat-label' }, label), detail),
    graphEl,
    valueEl,
  );
  return { el, detail };
}

const push = (history, value) => {
  history.push(value);
  if (history.length > POINTS) history.shift();
};

export default function statsPanel() {
  let visible = false;
  let run = 0;
  let timer = 0;
  let gauges;
  let net;
  let foot;

  function render(stats) {
    for (const gauge of gauges) {
      const value = gauge.value(stats);
      push(gauge.history, value);
      gauge.valueEl.textContent = percent(value);
      gauge.detail.textContent = value == null ? 'Not available' : gauge.text(stats) || '';
      gauge.graph.draw([gauge.history], 100);
    }

    push(net.down, stats.down);
    push(net.up, stats.up);
    net.downEl.textContent = `↓ ${speed(stats.down)}`;
    net.upEl.textContent = `↑ ${speed(stats.up)}`;
    net.detail.textContent = stats.network ?? 'Not connected';
    // A floor of 100 KB/s keeps background chatter near the bottom.
    net.graph.draw([net.down, net.up], Math.max(100e3, ...net.down, ...net.up));

    const { battery } = stats;
    foot.system.textContent = `Up for ${uptime(stats.uptime)} · ${stats.drive} ${gb(stats.driveFree)} GB free`;
    foot.battery.textContent = battery ? `Battery ${battery.percent}%${battery.pluggedIn ? ', plugged in' : ''}` : '';
  }

  async function loop(id) {
    const started = Date.now();
    const stats = await invoke('stats_get').catch(() => null);
    if (id !== run) return; // hidden meanwhile
    if (stats) render(stats);
    timer = setTimeout(() => loop(id), Math.max(200, 1000 - (Date.now() - started)));
  }

  return {
    id: 'stats',
    label: 'Stats',
    icon: 'stats',
    mount(view) {
      gauges = GAUGES.map(({ label, value, detail }) => {
        const valueEl = h('span', { class: 'stat-value tabular' }, '–');
        const g = graph(['main']);
        return { ...row(label, g.el, valueEl), value, text: detail, valueEl, graph: g, history: [] };
      });
      const downEl = h('span', { class: 'down' }, '↓ –');
      const upEl = h('span', { class: 'up' }, '↑ –');
      const g = graph(['down', 'up']);
      const network = row('Network', g.el, h('span', { class: 'stat-value pair tabular' }, downEl, upEl));
      net = { ...network, downEl, upEl, graph: g, down: [], up: [] };
      foot = { system: h('span', {}), battery: h('span', {}) };
      view.append(
        h('div', { class: 'set-group' }, gauges.map((gauge) => gauge.el), network.el),
        h('div', { class: 'panel-foot panel-note tabular' }, foot.system, h('span', { class: 'spacer' }), foot.battery),
      );
    },
    show() {
      if (visible) return;
      visible = true;
      // A fresh minute each time: joining across the gap would draw a line that never happened.
      for (const gauge of gauges) {
        gauge.history.length = 0;
        gauge.graph.draw([gauge.history], 100);
      }
      net.down.length = net.up.length = 0;
      net.graph.draw([net.down, net.up], 1);
      loop(++run);
    },
    hide() {
      visible = false;
      run++;
      clearTimeout(timer);
    },
  };
}
