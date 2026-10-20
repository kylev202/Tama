// The website's stand-in for Tama's native side. It answers the same commands and sends the
// same events as the Rust app, with demo data, so the real front end runs inside the page.
// Loaded before js/main.js. control.js builds the page's handle (window.tamaDemo) on top.
(() => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const started = Date.now();
  const uid = () => crypto.randomUUID();

  /** Calls a hook on the website, if the demo is embedded in it (same origin). */
  const tell = (name, ...args) => {
    try {
      if (parent !== window) parent.tamaSite?.[name]?.(...args);
    } catch {
      // Opened on its own, or the page isn't ready yet.
    }
  };

  /* Demo data, fresh on every visit and relative to now, so "today" is always today. */

  const at = (days, hours, minutes = 0) => {
    const d = new Date(started);
    d.setDate(d.getDate() + days);
    d.setHours(hours, minutes, 0, 0);
    return d.getTime();
  };
  const today = at(0, 0);
  const inMinutes = (n) => Math.ceil((started + n * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const task = (title, list, due, extra = {}) => ({
    id: uid(),
    title,
    list,
    due,
    allDay: false,
    priority: 0,
    repeat: null,
    repeatOf: null,
    done: false,
    doneAt: null,
    createdAt: started - 2 * DAY,
    remindedFor: null,
    snoozedUntil: null,
    notes: '',
    subtasks: [],
    ...extra,
  });
  const step = (title, done = false) => ({ id: uid(), title, done });
  const doneAt = Math.max(today + MINUTE, started - 3 * HOUR);

  const soonTask = task('Send the sprint notes', 'work', inMinutes(35), { priority: 2 });
  const tasks = [
    soonTask,
    task('Review the login pull request', 'work', today, {
      allDay: true,
      priority: 1,
      subtasks: [step('Run it locally', true), step('Check the error states'), step('Leave comments')],
    }),
    task('Flashcards: week 6', 'study', today, { allDay: true, repeat: 'daily' }),
    task('Read chapter 4: graphs', 'study', inMinutes(150), { notes: 'Skip 4.3, it is not on the exam.' }),
    task('Book the team lunch', 'work', at(-1, 17)),
    task('Essay outline', 'study', at(1, 9), { priority: 3, notes: 'Three arguments and one counterpoint. 800 words at most.' }),
    task('Lab report', 'study', at(3, 0), { allDay: true, priority: 2 }),
    task('Quarterly review slides', 'work', at(4, 10, 30)),
    task('Group project check-in', 'study', at(6, 16), { repeat: 'weekly' }),
    task('Standup', 'work', at(0, 9, 30), { done: true, doneAt }),
    task('Lecture notes: recursion', 'study', today, { allDay: true, done: true, doneAt }),
  ];

  const stats = { done: { [dayKey(started)]: { work: 1, study: 1 } }, focus: {} };
  for (let i = 1; i <= 9; i++) {
    const key = dayKey(at(-i, 12));
    stats.done[key] = { work: (i % 4) + 1, study: i <= 6 ? (i % 3) + 1 : 0 };
    stats.focus[key] = { work: 25 * ((i % 3) + 1), study: i <= 6 ? 50 : 0, free: 0 };
  }

  const seed = {
    tasks,
    routines: [
      {
        id: uid(),
        name: 'Morning',
        time: '08:45',
        repeat: 'days',
        days: [1, 2, 3, 4, 5],
        date: dayKey(at(1, 0)),
        actions: [
          { type: 'app', id: 'Spotify.exe', name: 'Spotify', label: 'Spotify' },
          { type: 'url', url: 'https://calendar.google.com/', label: 'Google Calendar', iconName: 'globe' },
        ],
        enabled: true,
        lastRun: null,
      },
    ],
    focus: { length: 25, breakLength: 5, session: null },
    stats,
    settings: { sounds: false, pinnedApps: ['Spotify.exe', 'Code.exe'], tab: 'today', more: 'stats', view: 'today', list: 'work', lyrics: true },
  };
  try {
    localStorage.setItem('tama.v1', JSON.stringify(seed));
  } catch {
    // Storage blocked: the store starts empty instead.
  }

  /* Events */

  const handlers = new Map();
  const emit = (event, payload) => {
    for (const handler of handlers.get(event) ?? []) handler({ event, payload });
  };

  /* Hover. The Rust app watches the pointer and makes only the capsule clickable; here the
     page does the same for the iframe, and this side notices when the pointer leaves. */

  let rect = { x: 0, y: 0, width: 0, height: 0 };
  let inside = false;
  let pointer = null;
  const within = ({ x, y }) => x >= rect.x && x < rect.x + rect.width && y >= 0 && y < rect.y + rect.height;
  function setInside(next) {
    if (next === inside) return;
    inside = next;
    emit('island-hover', next);
    tell('hover', next);
  }
  addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    setInside(within(pointer));
  });
  // A press outside the capsule always counts as leaving, even with no hover first (touch),
  // so the island closes and the page gets the pointer back.
  addEventListener('pointerdown', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (within(pointer)) return;
    inside = true;
    setInside(false);
  });
  document.documentElement.addEventListener('pointerleave', () => {
    pointer = null;
    setInside(false);
  });

  /* Media: three made-up songs (original lyrics), played on a clock. */

  const SONGS = [
    {
      title: 'Lantern Hours',
      artist: 'Low Tide Radio',
      album: 'Night Ferry',
      duration: 136_000,
      hue: 38,
      lrc: `[00:07.50]The city hums below the window
[00:11.90]Every light is someone up late
[00:16.30]I keep a small flame on the desk
[00:20.60]So the dark has room to wait
[00:25.20]Lantern hours
[00:27.80]Slow and gold
[00:30.40]Hold the night like something you can hold
[00:36.50]
[00:43.00]Pages turning, kettle singing
[00:47.40]Half a plan and half a song
[00:51.80]Every list gets shorter somehow
[00:56.20]When the light's been on this long
[01:00.80]Lantern hours
[01:03.40]Slow and gold
[01:06.00]Keep the thread and let the rest go cold
[01:12.40]
[01:19.50]I don't need the morning yet
[01:23.90]There's one more page to turn
[01:28.30]Leave the window open wide
[01:32.60]And let the small flame burn
[01:37.20]Lantern hours
[01:39.80]Slow and gold
[01:42.40]Hold the night like something you can hold
[01:48.60]Hold the night
[01:53.00]Like something you can hold`,
    },
    {
      title: 'Paper Moths',
      artist: 'Soft Static',
      album: 'Small Rooms',
      duration: 118_000,
      hue: 300,
      lrc: `[00:05.80]We fold the day into a paper moth
[00:10.20]And let it find the lamp
[00:14.40]Everything I meant to say
[00:18.60]Is circling where it's warm
[00:23.00]Oh, paper moths
[00:25.90]Don't mind the glass
[00:28.80]It's only light, it's only light
[00:34.60]
[00:40.20]The radiator ticks in time
[00:44.40]Your coat is on my chair
[00:48.60]We never finish anything
[00:52.80]But we're always almost there
[00:57.20]Oh, paper moths
[01:00.10]Don't mind the glass
[01:03.00]It's only light, it's only light
[01:09.50]
[01:15.00]Let the whole street sleep
[01:19.20]We'll keep the small light on
[01:23.40]Oh, paper moths
[01:26.30]It's only light
[01:30.80]It's only light`,
    },
    { title: 'Kettle Weather', artist: 'Low Tide Radio', album: 'Night Ferry', duration: 100_000, hue: 165, instrumental: true },
  ];

  const player = { index: 0, active: false, playing: false, position: 42_500, updatedAt: started, artVersion: 1 };
  const art = new Map();
  let songEnd = 0;

  const position = () => {
    const p = player.playing ? player.position + (Date.now() - player.updatedAt) : player.position;
    return Math.min(p, SONGS[player.index].duration);
  };

  function nowPlaying() {
    if (!player.active) return null;
    const song = SONGS[player.index];
    return {
      title: song.title,
      artist: song.artist,
      album: song.album,
      app: 'Spotify',
      playing: player.playing,
      canPrevious: true,
      canNext: true,
      canSeek: true,
      position: Math.round(position()),
      duration: song.duration,
      updatedAt: Date.now(),
      artVersion: player.artVersion,
    };
  }

  function publish() {
    clearTimeout(songEnd);
    if (player.playing) songEnd = setTimeout(() => change(1), SONGS[player.index].duration - position() + 400);
    emit('media', nowPlaying());
    tell('media');
  }

  function settle(patch) {
    player.position = position();
    player.updatedAt = Date.now();
    Object.assign(player, patch);
    publish();
  }

  function change(step) {
    const index = (player.index + step + SONGS.length) % SONGS.length;
    settle({ index, position: 0, artVersion: player.artVersion + 1 });
  }

  /** A cover for each song: a dusk sky over water with a low light, in the song's hue. */
  function cover(song) {
    if (art.has(song)) return art.get(song);
    const size = 320;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, size);
    sky.addColorStop(0, `hsl(${song.hue + 200} 35% 12%)`);
    sky.addColorStop(0.62, `hsl(${song.hue} 55% 34%)`);
    sky.addColorStop(0.621, `hsl(${song.hue + 190} 40% 9%)`);
    sky.addColorStop(1, `hsl(${song.hue + 200} 45% 5%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, size, size);
    const glow = ctx.createRadialGradient(size * 0.5, size * 0.6, 0, size * 0.5, size * 0.6, size * 0.42);
    glow.addColorStop(0, `hsl(${song.hue} 90% 78% / 0.95)`);
    glow.addColorStop(0.18, `hsl(${song.hue} 85% 62% / 0.6)`);
    glow.addColorStop(1, `hsl(${song.hue} 80% 40% / 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = `hsl(${song.hue} 70% 80% / 0.35)`;
    for (let i = 0; i < 9; i++) {
      const y = size * 0.64 + i * i * 1.6;
      const w = size * (0.32 - i * 0.025);
      ctx.fillRect(size * 0.5 - w / 2, y, w, 1.5);
    }
    const url = canvas.toDataURL('image/png');
    art.set(song, url);
    return url;
  }

  /* System stats that wander like a real PC's. */

  const meter = { cpu: 14, gpu: 7, disk: 3, down: 180_000, up: 24_000 };
  const wander = (value, min, max, swing) => Math.min(max, Math.max(min, value + (Math.random() - 0.5) * swing));

  /* Wallpapers: gradients made on the spot, named like a real folder. */

  const FOLDER = 'C:\\Users\\you\\Pictures\\Wallpapers';
  const WALLPAPERS = [
    ['Night lake', 210, 190],
    ['Harbour fog', 225, 250],
    ['Ember field', 20, 340],
    ['Moss and stone', 140, 95],
    ['Lavender hour', 285, 320],
    ['Low tide', 195, 165],
  ].map(([name, a, b]) => ({ path: `${FOLDER}\\${name}.jpg`, a, b }));
  let wallpaper = WALLPAPERS[0].path;
  const thumbs = new Map();
  function thumb(path) {
    if (thumbs.has(path)) return thumbs.get(path);
    const paper = WALLPAPERS.find((w) => w.path === path) ?? WALLPAPERS[0];
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 320, 180);
    sky.addColorStop(0, `hsl(${paper.a} 45% 22%)`);
    sky.addColorStop(1, `hsl(${paper.b} 55% 38%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 320, 180);
    const sun = ctx.createRadialGradient(220, 70, 0, 220, 70, 150);
    sun.addColorStop(0, `hsl(${paper.b} 80% 75% / 0.7)`);
    sun.addColorStop(1, `hsl(${paper.b} 80% 60% / 0)`);
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = `hsl(${paper.a} 40% 10% / 0.75)`;
    ctx.beginPath();
    ctx.moveTo(0, 140);
    for (let x = 0; x <= 320; x += 20) ctx.lineTo(x, 128 + Math.sin(x / 37 + paper.a) * 10);
    ctx.lineTo(320, 180);
    ctx.lineTo(0, 180);
    ctx.fill();
    const url = canvas.toDataURL('image/jpeg', 0.86);
    thumbs.set(path, url);
    return url;
  }

  /* Everything else the app asks the native side for. */

  const APPS = [
    ['Spotify.exe', 'Spotify'],
    ['Code.exe', 'Visual Studio Code'],
    ['Discord.exe', 'Discord'],
    ['Notion.exe', 'Notion'],
    ['Obsidian.exe', 'Obsidian'],
    ['msedge.exe', 'Microsoft Edge'],
    ['explorer.exe', 'File Explorer'],
    ['Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', 'Calculator'],
    ['WINWORD.EXE', 'Word'],
    ['EXCEL.EXE', 'Excel'],
    ['ms-teams.exe', 'Microsoft Teams'],
    ['Figma.exe', 'Figma'],
    ['steam.exe', 'Steam'],
  ].map(([id, name]) => ({ id, name }));

  let clips = [
    { id: 3, preview: 'Moved to 15:30, same room', at: started - 4 * MINUTE },
    { id: 2, preview: 'https://lrclib.net/', at: started - 26 * MINUTE },
    { id: 1, preview: 'Chapter 4 problems: 2, 5, 7 and 11', at: started - 2 * HOUR },
  ];
  const volume = { level: 0.62, muted: false };
  let autostart = true;
  const alarms = new Map();

  /* The chatbot has no model behind it here: the three example prompts run a scripted
     conversation through the real tool loop, and anything else gets an honest reply. */

  const completion = (message) =>
    JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] });
  const callTool = (name, args) => completion({ tool_calls: [{ id: `call_${uid().slice(0, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const say = (content) => completion({ content });

  function chatReply(body) {
    const messages = body.messages;
    const lastUser = messages.findLastIndex((m) => m.role === 'user');
    const asked = messages[lastUser].content.split('\n\n').slice(1).join('\n\n').trim().toLowerCase();
    const results = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
    const tomorrow = dayKey(at(1, 0));

    if (asked.startsWith('every weekday at 9:00, open spotify')) {
      if (results.length === 0) return callTool('find_apps', { query: 'spotify' });
      if (results.length === 1)
        return callTool('save_routine', { name: 'Spotify at 9', time: '09:00', repeat: 'days', days: [1, 2, 3, 4, 5], actions: [{ type: 'app', app_id: 'Spotify.exe' }] });
      return say('Done. Spotify opens at 9:00 every weekday.');
    }
    if (asked.startsWith('tomorrow at 8:00, open youtube')) {
      if (results.length === 0)
        return callTool('save_routine', {
          name: 'YouTube',
          time: '08:00',
          repeat: 'once',
          date: tomorrow,
          actions: [{ type: 'url', url: 'https://www.youtube.com/', label: 'YouTube' }],
        });
      return say('Set. YouTube opens tomorrow at 8:00, just once.');
    }
    if (asked.startsWith('what routines do i have')) {
      if (results.length === 0) return callTool('list_routines', {});
      const list = JSON.parse(results[0].content);
      if (!list.length) return say("You don't have any routines yet. Tell me what to open and when.");
      const when = (r) => {
        if (r.repeat === 'once') return `${r.time} on ${r.date}`;
        if (r.days.length === 7) return `${r.time} every day`;
        return r.days.join() === '1,2,3,4,5' ? `${r.time} on weekdays` : `${r.time} on ${r.days.length} days a week`;
      };
      const names = list.map((r) => `${r.name || 'An unnamed one'} at ${when(r)}${r.enabled ? '' : ' (off)'}`);
      return say(`You have ${list.length === 1 ? 'one' : list.length}: ${names.join('; ')}.`);
    }
    return say(
      "This demo has no model behind it, so it can only run the three examples. In the app, gpt-oss-120b on Groq reads whatever you type and sets up the routine.",
    );
  }

  const commands = {
    island_hit_rect(next) {
      rect = next;
      tell('rect', rect);
      if (pointer) setInside(within(pointer));
    },
    island_focus() {},
    island_release() {},

    media_now: () => nowPlaying(),
    media_art: () => (player.active ? cover(SONGS[player.index]) : null),
    media_control({ action }) {
      if (action === 'toggle') settle({ playing: !player.playing });
      else if (action === 'next') change(1);
      else if (action === 'previous') {
        if (position() > 3000) settle({ position: 0 });
        else change(-1);
      }
    },
    media_seek({ position: ms }) {
      settle({ position: ms });
    },
    lyrics_get({ title }) {
      const song = SONGS.find((s) => s.title === title);
      const found = { synced: song?.lrc ?? null, plain: null, instrumental: Boolean(song?.instrumental), fetchedAt: Date.now() };
      return new Promise((resolve) => setTimeout(() => resolve(found), 280));
    },

    chat_key_status: () => true,
    chat_key_set() {},
    chat_send({ body }) {
      const reply = chatReply(JSON.parse(body));
      return new Promise((resolve) => setTimeout(() => resolve(reply), 650 + Math.random() * 400));
    },

    stats_get() {
      meter.cpu = wander(meter.cpu, 4, 42, 9);
      meter.gpu = wander(meter.gpu, 1, 30, 6);
      meter.disk = wander(meter.disk, 0, 18, 4);
      meter.down = wander(meter.down, 8_000, 2_400_000, 420_000);
      meter.up = wander(meter.up, 2_000, 400_000, 60_000);
      return {
        cpu: meter.cpu,
        cpuSpeed: 3.4 + meter.cpu / 60,
        gpu: meter.gpu,
        gpuMemory: 1.9e9 + meter.gpu * 2e7,
        memoryUsed: 13.6e9 + meter.cpu * 4e7,
        memoryTotal: 34_359_738_368,
        disk: meter.disk,
        drive: 'C:',
        driveFree: 412e9,
        driveTotal: 1_000_204_886_016,
        down: meter.down,
        up: meter.up,
        network: 'Wi-Fi',
        battery: null,
        uptime: Math.round((2 * DAY + 5 * HOUR + Date.now() - started) / 1000),
      };
    },

    clipboard_list: () => clips,
    clipboard_copy({ id }) {
      const clip = clips.find((c) => c.id === id);
      if (!clip) return;
      navigator.clipboard?.writeText(clip.preview).catch(() => {});
      clips = [{ ...clip, at: Date.now() }, ...clips.filter((c) => c !== clip)];
      emit('clipboard', clips);
    },
    clipboard_remove({ id }) {
      clips = clips.filter((c) => c.id !== id);
      emit('clipboard', clips);
    },
    clipboard_clear() {
      clips = [];
      emit('clipboard', clips);
    },

    schedule_set({ alarms: list }) {
      for (const timer of alarms.values()) clearTimeout(timer);
      alarms.clear();
      for (const alarm of list) {
        const wait = alarm.at - Date.now();
        if (wait > 2 * DAY || wait < -(alarm.grace ?? 0)) continue;
        alarms.set(alarm.id, setTimeout(() => emit('alarm', alarm.id), Math.max(0, wait)));
      }
    },

    volume_get: () => ({ ...volume }),
    volume_set({ level }) {
      volume.level = level;
    },
    volume_mute({ muted }) {
      volume.muted = muted;
    },
    theme_get: () => true,
    theme_set() {},
    settings_open() {},
    autostart_get: () => autostart,
    autostart_set({ enabled }) {
      autostart = enabled;
    },
    app_quit() {
      tell('quit');
    },

    apps_list: () => APPS,
    app_icon: () => null,
    app_launch() {},
    url_open({ url }) {
      window.open(url, '_blank', 'noopener');
    },

    wallpaper_default_folder: () => FOLDER,
    folder_pick: () => null,
    wallpapers_list: () => WALLPAPERS.map((w) => w.path),
    wallpaper_thumb: ({ path }) => thumb(path),
    wallpapers_current: () => [wallpaper],
    wallpaper_set({ path }) {
      wallpaper = path;
      tell('wallpaper', thumb(path));
    },
  };

  window.__TAURI__ = {
    core: {
      invoke(command, args = {}) {
        const run = commands[command];
        if (!run) return Promise.reject(`The demo doesn't do ${command}.`);
        try {
          return Promise.resolve(run(args));
        } catch (error) {
          return Promise.reject(String(error));
        }
      },
    },
    event: {
      listen(event, handler) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event).add(handler);
        return Promise.resolve(() => handlers.get(event).delete(handler));
      },
    },
  };

  // For control.js: the parts of the stand-in the page drives directly.
  window.__tamaBridge = {
    get rect() {
      return rect;
    },
    soonTask: soonTask.id,
    songs: SONGS,
    player,
    position,
    setInside,
    play() {
      if (!player.active) {
        player.active = true;
        player.playing = true;
        player.updatedAt = Date.now();
        publish();
      } else if (!player.playing) settle({ playing: true });
    },
    pause() {
      if (player.playing) settle({ playing: false });
    },
    remind(id) {
      emit('alarm', id);
    },
  };
})();
