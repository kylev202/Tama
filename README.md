# Tama

A Dynamic Island for Windows, modelled on the island in [Hitodama](https://hitodama.in/): a black capsule at the top of your main screen with a small soul inside. Hover it for quick controls; scroll down or click it to open the panels. Everything runs offline except song lyrics, which come from [LRCLIB](https://lrclib.net/) (the lyrics button in Music turns that off), and the Chatbot, which only goes online once you add a free Groq API key.

**[Website and live demo](https://kylev202.github.io/Tama/)** · **[Download Tama 1.0.0](https://github.com/kylev202/Tama/releases/latest)** (1.5 MB, Windows 11, 64-bit)

## Install

1. Download `Tama_1.0.0_x64-setup.exe` from [Releases](https://github.com/kylev202/Tama/releases/latest).
2. Run it. It installs for your account only, so it doesn't ask for admin rights.
3. If Windows SmartScreen says it protected your PC, choose **More info**, then **Run anyway**. Tama isn't code-signed yet, so Windows doesn't recognise it.
4. Look at the top of your main screen. Tama starts with Windows; turn that off in Settings or from the tray icon.

It needs the WebView2 runtime, which Windows 11 already has.

| Panel | What it does |
|---|---|
| Tasks | Today, Upcoming (the next 7 days, by day) and a month Calendar of deadlines, plus Work and Study lists. Tasks can have steps, notes and a repeat (daily, weekdays, weekly, monthly). Overdue tasks move to today in one click. Progress ring, study streak, reminders |
| Focus | Pomodoro-style timer tied to a task; counts down live in the closed island |
| Music | Now playing from any app (Spotify, browser tabs, …) with play/pause/skip and a seek bar. Time-synced lyrics scroll with the song; tap a line to jump to it, scroll to read ahead. Hovering the island shows the line being sung |
| Chatbot | Chat with gpt-oss-120b (free, on Groq), which sets up your routines: at a time (some weekdays, or once), open apps and web pages. "Every weekday at 9:00, open Spotify", "move it to 8:30", "what routines do I have?", "run my morning routine now". Needs a free API key from [console.groq.com](https://console.groq.com/keys) |
| More | The desktop tools below, one section each |

Under More:

| Section | What it does |
|---|---|
| Clipboard | Recent text copies, in memory only; password-manager copies are skipped |
| Launch | Search your Start-menu apps or the web; pin favourites |
| Wallpapers | Pick a folder; click an image to set it on every monitor |
| Stats | Live CPU, GPU, memory, disk and network use, each with the last minute graphed, plus uptime, free space and battery. Sampled once a second only while it's open |
| Settings | Volume, dark mode, sounds, start with Windows, shortcuts into Windows Settings, and Personalise |

## Personalise

Settings → Personalise changes how Tama looks and behaves, and the island updates as you go:

- **Style:** Island (floats below the top edge), Notch (joined to the top edge) or Soul (only the soul until you hover). Three sizes. The soul can be hidden in the first two.
- **Colour:** ten accents (the soul takes the colour too), four themes (Black, Graphite, Midnight, Light) and a background (Glow, Aurora, Stars, Grain or the blurred album art).
- **Text:** Segoe UI, Bahnschrift, Sitka, Georgia or Cascadia, and the lyrics size.
- **Time and date:** 24 or 12-hour clock, seconds, a clock in the resting island, five date formats, and whether weeks start on Monday or Sunday.
- **Behaviour:** quick controls on hover, the lyric line on hover, and which tab the island opens to.

## Quick add

Type a task and the details are picked out as you go:

| You type | Meaning |
|---|---|
| `#work` `#study` (`#w` `#s`) | Which list |
| `!` `!!` `!!!` or `!low` `!med` `!high` | Priority |
| `today` `tonight` `tomorrow` `fri` `next week` | Day |
| `9am` `3:30pm` `15:00` `15h30` `at 3` | Time (sets a reminder) |
| `in 30 min` `in 2 h` `in 3 days` | Relative |
| `daily` `every weekday` `weekly` `every fri` `monthly` | Repeat (finishing one schedules the next) |

Examples: `Essay draft fri 9am #study !high`, `Standup every weekday 9:30 #work`.

## Develop

Needs Node, Rust (MSVC toolchain) and the WebView2 runtime (built into Windows 11).

```sh
npm install
npm run dev     # debug build with a console window
npm run build   # release build + installer in src-tauri/target/release/bundle/nsis
```

The front end is plain HTML/CSS/JS in `src/` (no bundler); the Rust side is in `src-tauri/src/`. Design intent lives in `PRODUCT.md` and `DESIGN.md`.

### Website

The website is in `site/`. Its live demo is the app's own front end, run against `site/demo/bridge.js`, a stand-in for the Rust side that answers every command with demo data (the songs and lyrics are made up).

```sh
npm run site        # preview at http://localhost:5180/, straight from site/ and src/
npm run site:build  # the published version, in _site/
```

Opening `site/` with a plain static server (like Live Server) won't work: the demo is put together from `src/`. Pushing to `main` publishes the site to GitHub Pages (`.github/workflows/pages.yml`). If you add a native command, add it to `bridge.js` too, or the demo rejects it.

## Where things live

- Your tasks, routines, stats and settings: the app's WebView2 storage in `%LOCALAPPDATA%\dev.tama.island`.
- Clipboard history: memory only; gone when Tama quits.
- Lyrics: looked up on LRCLIB with only the song's title, artist, album and length, then cached in `%LOCALAPPDATA%\dev.tama.island\lyrics`, so each song goes online once. Lyrics are on by default; the lyrics button in Music turns them off.
- Chatbot: your Groq API key is in Windows Credential Manager as `Tama/Groq API key` (the key button in the chat changes or removes it). What you type in the chat, your routines and the names of matching apps go to Groq's API (model `openai/gpt-oss-120b`); the conversation itself is kept in memory only and is gone when Tama quits. Without a key nothing is sent. Groq's free tier has per-minute and per-day limits; when one is reached the chat says how long to wait.
- Start with Windows: a `Tama` entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Turn it off from Settings in the island or the tray icon.
- Uninstall: Windows Settings → Apps → Installed apps → Tama.

## Licence

© 2026 kylev202. All rights reserved. The source is public so you can read it and build it for yourself; it is not licensed for reuse or redistribution.
