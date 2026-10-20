// Wallpapers: a folder of images; click one to put it on every monitor.
import { button, fill, h } from '../dom.js';
import { icon } from '../icons.js';
import { commit, state } from '../store.js';
import { invoke } from '../tauri.js';

const thumbs = new Map();
const fileName = (path) => path.split(/[\\/]/).pop();
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();

export default function wallpapersPanel() {
  let app;
  let visible = false;
  let folder = null;
  let images = [];
  let current = [];
  let status = 'idle'; // idle | loading | ready | error
  let els;
  let generation = 0; // bumps on every render so stale thumbnail loops stop

  async function load() {
    folder = state.settings.wallpaperFolder ?? (await invoke('wallpaper_default_folder').catch(() => null));
    if (!folder) {
      status = 'idle';
      render();
      return;
    }
    status = 'loading';
    render();
    try {
      [images, current] = await Promise.all([
        invoke('wallpapers_list', { folder }),
        invoke('wallpapers_current').catch(() => []),
      ]);
      status = 'ready';
    } catch (error) {
      console.error(error);
      images = [];
      status = 'error';
    }
    if (visible) render();
  }

  async function chooseFolder() {
    const picked = await invoke('folder_pick').catch(() => null);
    if (!picked) return;
    state.settings.wallpaperFolder = picked;
    commit();
    load();
  }

  async function apply(path) {
    const previous = current;
    current = [path];
    render();
    try {
      await invoke('wallpaper_set', { path });
    } catch (error) {
      console.error(error);
      current = previous;
      render();
      app.toast('Windows could not use that image as a wallpaper.');
    }
  }

  function render() {
    generation++;
    els.folder.textContent = folder ? fileName(folder) : 'Wallpapers';
    els.count.textContent = status === 'ready' ? `${images.length} image${images.length === 1 ? '' : 's'}` : '';
    els.change.hidden = !folder;

    if (!folder) {
      fill(
        els.grid,
        h(
          'div',
          { class: 'empty' },
          icon('folder'),
          h('strong', {}, 'Choose a wallpaper folder'),
          'Pick a folder of images. Click any of them to set it on all your monitors.',
          button('Choose folder', chooseFolder, { kind: 'primary', iconName: 'folder' }),
        ),
      );
      return;
    }
    if (status === 'loading') {
      fill(els.grid, h('div', { class: 'wall-grid' }, Array.from({ length: 6 }, () => h('div', { class: 'wall skeleton' }))));
      return;
    }
    if (status === 'error' || !images.length) {
      fill(
        els.grid,
        h(
          'div',
          { class: 'empty' },
          h('strong', {}, status === 'error' ? 'Could not open that folder' : 'No images here'),
          status === 'error' ? 'It may have been moved or renamed.' : 'Pick a folder with JPG, PNG or WebP images.',
          button('Choose another folder', chooseFolder, { iconName: 'folder' }),
        ),
      );
      return;
    }
    const tiles = images.map((path) => {
      const on = current.some((c) => samePath(c, path));
      return h(
          'button',
          {
            class: `wall press skeleton${on ? ' current' : ''}`,
            type: 'button',
            title: fileName(path),
            'aria-label': `Set ${fileName(path)} as wallpaper`,
            'aria-pressed': String(on),
            dataset: { path },
            onclick: () => apply(path),
          },
          on ? h('span', { class: 'wall-badge' }, icon('check')) : null,
        );
    });
    fill(els.grid, h('div', { class: 'wall-grid' }, tiles));
    loadThumbs(tiles, generation);
  }

  /** One at a time, in grid order: the shell works through them serially anyway, so the
   *  first rows fill in first. A newer render stops an older loop. */
  async function loadThumbs(tiles, run) {
    for (const tile of tiles) {
      if (run !== generation) return;
      const path = tile.dataset.path;
      if (!thumbs.has(path)) thumbs.set(path, invoke('wallpaper_thumb', { path }).catch(() => null));
      const src = await thumbs.get(path);
      tile.classList.remove('skeleton');
      tile.prepend(src ? h('img', { src, alt: '' }) : h('span', { class: 'wall-missing' }, icon('wallpaper')));
    }
  }

  return {
    id: 'wallpapers',
    label: 'Wallpapers',
    icon: 'wallpaper',
    mount(view, context) {
      app = context;
      const folderName = h('div', { class: 'panel-title' });
      const count = h('div', { class: 'panel-sub' });
      const change = button('Change folder', chooseFolder, { kind: 'ghost', iconName: 'folder' });
      const grid = h('div', { class: 'wall-scroll scroll' });
      view.append(h('div', { class: 'panel-head' }, h('div', {}, folderName, count), change), grid);
      els = { folder: folderName, count, change, grid };
    },
    show() {
      visible = true;
      if (status === 'ready' && folder === state.settings.wallpaperFolder) {
        invoke('wallpapers_current')
          .then((paths) => {
            current = paths;
            if (visible) render();
          })
          .catch(() => {});
        render();
      } else load();
    },
    hide() {
      visible = false;
    },
  };
}
