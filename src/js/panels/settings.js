// Quick settings: volume, Windows theme, Tama's own switches, shortcuts into Settings, and
// Personalise, a page of its own for how Tama looks and behaves.
import { button, h } from '../dom.js';
import { icon } from '../icons.js';
import { commit, state } from '../store.js';
import { invoke } from '../tauri.js';
import { createPersonalise } from './personalise.js';

const SHORTCUTS = [
  ['display', 'Display', 'display'],
  ['sound', 'Sound', 'volume'],
  ['bluetooth', 'Bluetooth', 'bluetooth'],
];

export default function settingsPanel() {
  let visible = false;
  let poll = 0;
  let sending = 0;
  let els;

  function switchRow(iconName, label, onToggle) {
    const toggle = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': label });
    toggle.addEventListener('click', () => onToggle(toggle.getAttribute('aria-checked') !== 'true', toggle));
    return { row: h('div', { class: 'set-row' }, icon(iconName), h('span', { class: 'set-label' }, label), toggle), toggle };
  }

  const setSwitch = (toggle, on) => toggle.setAttribute('aria-checked', String(on));

  function showVolume({ level, muted }) {
    const percent = Math.round(level * 100);
    if (document.activeElement !== els.slider) els.slider.value = percent;
    els.slider.style.setProperty('--fill', `${muted ? 0 : els.slider.value}%`);
    els.percent.textContent = muted ? 'Muted' : `${els.slider.value}%`;
    els.mute.replaceChildren(icon(muted || percent === 0 ? 'mute' : 'volume'));
    els.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    els.mute.setAttribute('aria-pressed', String(muted));
  }

  async function refreshVolume() {
    try {
      showVolume(await invoke('volume_get'));
    } catch {
      els.percent.textContent = 'No output';
    }
  }

  return {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    mount(view, app) {
      const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' });
      const percent = h('span', { class: 'set-value tabular' });
      const mute = h('button', { class: 'icon-btn press', type: 'button', 'aria-label': 'Mute' });
      slider.addEventListener('input', () => {
        slider.style.setProperty('--fill', `${slider.value}%`);
        percent.textContent = `${slider.value}%`;
        clearTimeout(sending);
        sending = setTimeout(() => invoke('volume_set', { level: slider.value / 100 }).catch(() => {}), 30);
      });
      mute.addEventListener('click', async () => {
        const muted = mute.getAttribute('aria-pressed') !== 'true';
        await invoke('volume_mute', { muted }).catch(() => {});
        refreshVolume();
      });

      const theme = switchRow('moon', 'Dark mode', async (on, toggle) => {
        setSwitch(toggle, on);
        await invoke('theme_set', { dark: on }).catch(() => setSwitch(toggle, !on));
      });
      const sounds = switchRow('bell', 'Tama sounds', (on, toggle) => {
        setSwitch(toggle, on);
        state.settings.sounds = on;
        commit();
      });
      const autostart = switchRow('power', 'Start with Windows', async (on, toggle) => {
        setSwitch(toggle, on);
        await invoke('autostart_set', { enabled: on }).catch(() => setSwitch(toggle, !on));
      });
      const main = h(
        'div',
        { class: 'set-page' },
        h('div', { class: 'set-group' }, h('div', { class: 'set-row volume' }, mute, slider, percent)),
        h('div', { class: 'set-group' }, theme.row, sounds.row, autostart.row),
        h(
          'div',
          { class: 'set-shortcuts' },
          SHORTCUTS.map(([page, label, iconName]) =>
            h(
              'button',
              { class: 'shortcut press', type: 'button', title: `Open ${label} settings`, onclick: () => invoke('settings_open', { page }).catch(() => {}) },
              icon(iconName),
              label,
            ),
          ),
          h('button', { class: 'shortcut press', type: 'button', title: 'Personalise how Tama looks and behaves', onclick: () => showPage('personalise') }, icon('palette'), 'Personalise'),
        ),
        h('div', { class: 'panel-foot' }, h('span', { class: 'spacer' }), button('Quit Tama', () => invoke('app_quit'), { kind: 'ghost', iconName: 'power' })),
      );
      const personalise = createPersonalise({ back: () => showPage('main'), app });

      function showPage(name) {
        main.hidden = name !== 'main';
        personalise.el.hidden = name !== 'personalise';
        if (name === 'personalise') personalise.render();
        view.scrollTop = 0;
      }

      view.classList.add('scroll');
      view.append(main, personalise.el);
      els = { slider, percent, mute, theme: theme.toggle, sounds: sounds.toggle, autostart: autostart.toggle };
    },
    async show() {
      visible = true;
      setSwitch(els.sounds, state.settings.sounds);
      refreshVolume();
      clearInterval(poll);
      poll = setInterval(refreshVolume, 1500); // follow volume keys while open
      setSwitch(els.theme, await invoke('theme_get').catch(() => true));
      setSwitch(els.autostart, await invoke('autostart_get').catch(() => false));
    },
    hide() {
      visible = false;
      clearInterval(poll);
    },
  };
}
