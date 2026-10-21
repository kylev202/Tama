// Now playing, from whatever app owns the Windows media session, with synced lyrics that
// move the way Apple Music's do: the sung line lights up and the others follow it on a
// spring, one after another. Tap a line to jump there; scroll to read ahead.
import { fill, h, iconButton } from '../dom.js';
import { icon } from '../icons.js';
import { lyrics, onLine, onLyrics, retry } from '../lyrics.js';
import { control, media, onMedia, seek } from '../media.js';
import { commit, state } from '../store.js';

/** The sung line sits this far down the lyrics area. */
const ANCHOR = 0.3;
/** After scrolling the lyrics by hand, they follow the song again this long after. */
const BROWSE_IDLE = 2600;
/** Each line below the sung one starts moving this much later than the one above it. */
const CASCADE = 42;

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function musicPanel() {
  let visible = false;
  let timer = 0;
  let root;
  let shape = '';
  let lyricsVersion = 0;
  let els = null; // the live parts of what's on screen
  let browsing = false;
  let browseY = 0;
  let browseTimer = 0;

  /** 'lyrics' (header, bar and lyrics), 'art' (big artwork) or 'empty'. */
  function layout() {
    if (!media.now) return 'empty';
    return ['loading', 'synced', 'plain'].includes(lyrics.status) ? 'lyrics' : 'art';
  }

  function render() {
    const now = media.now;
    const kind = layout();
    // Rebuilt only when what's on screen changes shape; play state and position are patched.
    const key = [kind, now?.title, now?.artist, now?.app, now?.artVersion, media.tint, now?.canSeek, lyrics.status, lyricsVersion, state.settings.lyrics].join('\u001f');
    if (key !== shape) {
      shape = key;
      build(kind);
    }
    patch();
  }

  function build(kind) {
    stopBrowsing();
    if (kind === 'empty') {
      els = null;
      fill(
        root,
        h(
          'div',
          { class: 'empty' },
          icon('music'),
          h('strong', {}, 'Nothing playing'),
          'Play something in Spotify, a browser tab or any media app and it shows up here.',
        ),
      );
      return;
    }
    const now = media.now;
    const art = h('div', { class: 'music-art' }, media.art ? h('img', { src: media.art, alt: '' }) : icon('music'));
    const play = iconButton('play', 'Play', () => control('toggle'), kind === 'art' ? 'solid big' : 'solid');
    const previous = iconButton('previous', 'Previous track', () => control('previous'));
    const next = iconButton('next', 'Next track', () => control('next'));
    const toggle = iconButton('lyrics', state.settings.lyrics ? 'Hide lyrics' : 'Show lyrics', toggleLyrics, 'toggle');
    toggle.setAttribute('aria-pressed', String(state.settings.lyrics));
    const progress = progressBar();
    els = { play, previous, next, progress };

    if (kind === 'lyrics') {
      const box = h('div', { class: 'lyrics' });
      els.music = h(
        'div',
        { class: 'music with-lyrics', style: { '--tint': media.tint ?? 'var(--brand)' } },
        h(
          'div',
          { class: 'np' },
          art,
          h(
            'div',
            { class: 'np-text' },
            h('div', { class: 'np-title' }, now.title || 'Unknown track'),
            h('div', { class: 'np-artist' }, [now.artist, now.app].filter(Boolean).join(' · ')),
          ),
          h('div', { class: 'np-controls' }, previous, play, next),
        ),
        h('div', { class: 'np-bar' }, progress.el, toggle),
        box,
      );
      fill(root, els.music);
      buildLyrics(box);
      return;
    }

    els.music = h(
      'div',
      { class: 'music', style: { '--tint': media.tint ?? 'var(--brand)' } },
      art,
      h(
        'div',
        { class: 'music-info' },
        now.app ? h('div', { class: 'music-app' }, now.app) : null,
        h('div', { class: 'music-title' }, now.title || 'Unknown track'),
        h('div', { class: 'music-artist' }, now.artist || ''),
        progress.el,
        h('div', { class: 'music-controls' }, previous, play, next, h('span', { class: 'spacer' }), toggle),
        lyricsNote(),
      ),
    );
    fill(root, els.music);
  }

  /** Why there are no lyrics on screen, when they're switched on. */
  function lyricsNote() {
    if (!state.settings.lyrics) return null;
    if (lyrics.status === 'missing') return h('div', { class: 'music-note' }, 'No lyrics found for this song');
    if (lyrics.status === 'instrumental') return h('div', { class: 'music-note' }, 'Instrumental');
    if (lyrics.status === 'error') {
      return h(
        'div',
        { class: 'music-note' },
        'Couldn’t reach LRCLIB for lyrics.',
        h('button', { class: 'link press', type: 'button', onclick: retry }, 'Try again'),
      );
    }
    return null;
  }

  function toggleLyrics() {
    state.settings.lyrics = !state.settings.lyrics;
    commit();
  }

  function buildLyrics(box) {
    if (lyrics.status === 'loading') {
      fill(box, h('div', { class: 'lyrics-loading', 'aria-label': 'Loading lyrics' }, [72, 54, 80, 46].map((w) => h('div', { class: 'skeleton', style: { width: `${w}%` } }))));
      return;
    }
    if (lyrics.status === 'plain') {
      box.classList.add('plain');
      fill(
        box,
        h(
          'div',
          { class: 'lyrics-plain scroll' },
          h('p', { class: 'lyrics-note' }, 'These lyrics aren’t time-synced.'),
          h('p', { class: 'lyrics-text' }, lyrics.plain),
          h('p', { class: 'lyrics-credit' }, 'Lyrics from LRCLIB'),
        ),
      );
      return;
    }
    const seekable = Boolean(media.now?.canSeek);
    const lines = lyrics.lines.map((line) => {
      const words = line.text || h('span', { class: 'dots' }, h('i'), h('i'), h('i'));
      const props = { class: line.text ? 'lyric' : 'lyric interlude' };
      if (!seekable) return h('div', { ...props, 'aria-hidden': line.text ? null : 'true' }, words);
      return h('button', { ...props, type: 'button', 'aria-label': line.text ? null : 'Instrumental break', onclick: () => jump(line) }, words);
    });
    const credit = h('div', { class: 'lyrics-credit' }, 'Lyrics from LRCLIB');
    const list = h('div', { class: 'lyrics-lines' }, lines, credit);
    fill(box, list);
    box.addEventListener('wheel', browse, { passive: true });
    Object.assign(els, { box, list, lines: [...lines, credit] });
    follow(lyrics.index, { instant: true });
  }

  /** Puts the sung line at the anchor. Lines below it start a beat later each, so the block
   *  ripples into place instead of sliding as one slab. */
  function follow(index, { instant = false } = {}) {
    if (!els?.lines) return;
    const { box, lines } = els;
    const sung = lines[Math.max(0, index)];
    const y = browsing ? browseY : sung.offsetTop - box.clientHeight * ANCHOR;
    if (instant) box.classList.add('instant');
    for (const [i, el] of lines.entries()) {
      const distance = i - index;
      el.classList.toggle('active', distance === 0);
      el.dataset.distance = String(Math.min(Math.abs(distance), 4));
      el.style.transitionDelay = instant || browsing ? '0ms' : `${Math.min(Math.max(distance + 1, 0), 7) * CASCADE}ms`;
      el.style.translate = `0 ${-y}px`;
    }
    const line = lyrics.lines[index];
    if (line && !line.text) startInterlude(lines[index], line);
    if (instant) {
      void box.offsetHeight; // commit the jump before transitions come back
      box.classList.remove('instant');
    }
  }

  /** The three dots fill up one by one across the pause, in time with the song. */
  function startInterlude(el, line) {
    const third = (line.end - line.time) / 3;
    el.style.setProperty('--third', `${third}ms`);
    el.style.setProperty('--elapsed', `${Math.max(0, media.position() - line.time)}ms`);
    el.classList.remove('counting');
    void el.offsetWidth; // restart the fill
    el.classList.add('counting');
  }

  /** Scrolling reads ahead (or back) by hand; the lyrics drift back to the song when idle. */
  function browse(e) {
    e.stopPropagation(); // the island would read an upward scroll as "close"
    if (!els?.lines) return;
    const { box, lines } = els;
    const anchor = box.clientHeight * ANCHOR;
    if (!browsing) {
      browsing = true;
      browseY = lines[Math.max(0, lyrics.index)].offsetTop - anchor;
      box.classList.add('browsing');
    }
    const step = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    browseY = Math.min(Math.max(browseY + step, lines[0].offsetTop - anchor), lines.at(-1).offsetTop - anchor);
    follow(lyrics.index);
    clearTimeout(browseTimer);
    browseTimer = setTimeout(() => {
      stopBrowsing();
      follow(lyrics.index);
    }, BROWSE_IDLE);
  }

  function stopBrowsing() {
    clearTimeout(browseTimer);
    browsing = false;
    els?.box?.classList.remove('browsing');
  }

  function jump(line) {
    stopBrowsing();
    seek(line.time);
  }

  /** Elapsed, a bar you can drag to seek (when the player allows it), and the length. */
  function progressBar() {
    const elapsed = h('span', { class: 'tabular' });
    const total = h('span', { class: 'tabular' });
    const bar = h('i');
    // A 16px hit area around a 4px rail, so the bar is easy to grab.
    const track = h('div', { class: 'music-track' }, h('div', { class: 'music-rail' }, bar));
    const el = h('div', { class: 'music-progress' }, elapsed, track, total);
    let preview = null; // 0..1 while dragging
    let last = null;

    function update() {
      const now = media.now;
      el.hidden = !now?.duration;
      if (!now?.duration) return;
      const position = preview != null ? preview * now.duration : media.position();
      // Normal playback glides between ticks; a seek or a new track jumps.
      const expected = last ? last.position + (now.playing ? Date.now() - last.at : 0) : position;
      bar.style.transition = preview != null || Math.abs(position - expected) > 1500 ? 'none' : '';
      last = { position, at: Date.now() };
      elapsed.textContent = clock(position);
      total.textContent = clock(now.duration);
      bar.style.width = `${(position / now.duration) * 100}%`;
      track.setAttribute('aria-valuenow', String(Math.round(position / 1000)));
      track.setAttribute('aria-valuetext', `${clock(position)} of ${clock(now.duration)}`);
      track.setAttribute('aria-valuemax', String(Math.round(now.duration / 1000)));
    }

    if (media.now?.canSeek) {
      track.tabIndex = 0;
      track.classList.add('seekable');
      track.setAttribute('role', 'slider');
      track.setAttribute('aria-label', 'Position');
      track.setAttribute('aria-valuemin', '0');
      const at = (e) => {
        const rect = track.getBoundingClientRect();
        return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      };
      track.addEventListener('pointerdown', (e) => {
        track.setPointerCapture(e.pointerId);
        el.classList.add('scrubbing');
        preview = at(e);
        update();
      });
      track.addEventListener('pointermove', (e) => {
        if (preview == null) return;
        preview = at(e);
        update();
      });
      const release = (commitSeek) => () => {
        if (preview == null) return;
        const target = preview * (media.now?.duration ?? 0);
        preview = null;
        el.classList.remove('scrubbing');
        if (commitSeek) seek(target);
        update();
      };
      track.addEventListener('pointerup', release(true));
      track.addEventListener('pointercancel', release(false));
      track.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: -5000, ArrowRight: 5000 }[e.key];
        if (!step) return;
        e.preventDefault();
        seek(media.position() + step);
      });
    }
    return { el, update };
  }

  function patch() {
    if (!els) return;
    const now = media.now;
    const name = now.playing ? 'pause' : 'play';
    if (els.play.dataset.icon !== name) {
      els.play.dataset.icon = name;
      els.play.replaceChildren(icon(name));
      els.play.setAttribute('aria-label', now.playing ? 'Pause' : 'Play');
      els.play.title = now.playing ? 'Pause' : 'Play';
    }
    els.previous.disabled = !now.canPrevious;
    els.next.disabled = !now.canNext;
    els.music.classList.toggle('paused', !now.playing);
    els.progress.update();
  }

  return {
    id: 'music',
    label: 'Music',
    icon: 'music',
    mount(view) {
      root = view;
      onMedia(() => visible && render());
      onLyrics(() => {
        lyricsVersion++;
        if (visible) render();
      });
      onLine((index) => visible && follow(index));
    },
    show() {
      visible = true;
      render();
      follow(lyrics.index, { instant: true }); // the song moved on while the panel was away
      clearInterval(timer);
      timer = setInterval(() => els?.progress.update(), 1000);
    },
    hide() {
      visible = false;
      stopBrowsing();
      clearInterval(timer);
    },
  };
}
