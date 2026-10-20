// Text you copied recently. Click one to copy it again.
import { button, fill, h, iconButton } from '../dom.js';
import { icon } from '../icons.js';
import { invoke, listen } from '../tauri.js';
import { formatAgo } from '../time.js';

export default function clipboardPanel() {
  let visible = false;
  let clips = [];
  let copiedId = null;
  let els;

  function render() {
    const now = Date.now();
    els.clear.disabled = clips.length === 0;
    if (!clips.length) {
      fill(
        els.list,
        h(
          'div',
          { class: 'empty' },
          icon('clipboard'),
          h('strong', {}, 'Nothing copied yet'),
          'Copy some text anywhere in Windows and it appears here. Click it later to copy it again.',
        ),
      );
      return;
    }
    fill(
      els.list,
      clips.map((clip) =>
        h(
          'div',
          { class: `clip${clip.id === copiedId ? ' copied' : ''}` },
          h(
            'button',
            { class: 'clip-body press', type: 'button', title: 'Copy again', onclick: () => copy(clip) },
            h('span', { class: 'clip-text' }, clip.preview),
            h('span', { class: 'clip-time' }, clip.id === copiedId ? h('span', { class: 'clip-done' }, icon('check'), 'Copied') : formatAgo(clip.at, now)),
          ),
          iconButton('close', 'Remove from history', () => invoke('clipboard_remove', { id: clip.id })),
        ),
      ),
    );
  }

  async function copy(clip) {
    try {
      await invoke('clipboard_copy', { id: clip.id });
      copiedId = clip.id;
      render();
      setTimeout(() => {
        if (copiedId === clip.id) copiedId = null;
        if (visible) render();
      }, 1400);
    } catch (error) {
      console.error(error);
    }
  }

  return {
    id: 'clipboard',
    label: 'Clipboard',
    icon: 'clipboard',
    mount(view) {
      const clear = button('Clear all', () => invoke('clipboard_clear'), { kind: 'ghost' });
      const list = h('div', { class: 'clip-list scroll' });
      view.append(
        h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, 'Copied recently'), clear),
        list,
      );
      els = { clear, list };
      listen('clipboard', (next) => {
        clips = next;
        if (visible) render();
      });
    },
    async show() {
      visible = true;
      clips = await invoke('clipboard_list').catch(() => clips);
      render();
    },
    hide() {
      visible = false;
    },
  };
}
