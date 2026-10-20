# Design System: Tama

## 1. Visual Theme & Atmosphere

A black lake at night with one teal lantern-flame hovering over it. The island is a true-black capsule floating 6px below the top edge of the main monitor, the same object Apple uses for the Dynamic Island. Inside it lives the soul: a small teal spirit-flame with two quiet eyes. Everything else is graphite and type. Colour appears only where it means something: the soul, a list (Work or Study), a due state, or a selected control.

## 2. Color Palette & Roles

OKLCH only. Strategy: **Restrained**, with two category colours used as data (Work, Study).

| Token | Value | Role |
|---|---|---|
| `--island` | `oklch(0 0 0)` | The capsule. True black on purpose: it is a piece of hardware-like chrome, like Apple's island |
| `--well` | `oklch(0.2 0 0)` | Inputs, rows on hover, inner wells |
| `--well-strong` | `oklch(0.26 0 0)` | Selected tab pill, pressed rows, slider track fill base |
| `--line` | `oklch(1 0 0 / 0.09)` | Hairline dividers |
| `--ink` | `oklch(0.97 0 0)` | Primary text and icons (about 19:1 on black) |
| `--ink-2` | `oklch(0.74 0 0)` | Secondary text (about 9:1 on black, 7:1 on `--well`) |
| `--ink-3` | `oklch(0.64 0 0)` | Placeholders, tertiary metadata (4.8:1 or better on `--well`) |
| `--soul` | `oklch(0.84 0.105 200)` | Brand primary: soul light, primary buttons, focus rings, done checks |
| `--soul-deep` | `oklch(0.45 0.074 200)` | Palette seed: soul edge glow, progress tracks |
| `--on-soul` | `oklch(0.2 0.03 215)` | Text on soul fills |
| `--work` | `oklch(0.7 0.13 52)` | Work list (copper) |
| `--study` | `oklch(0.7 0.14 295)` | Study list (violet) |
| `--danger` | `oklch(0.7 0.18 25)` | Overdue, destructive |

Text on `--work` / `--study` fills is `--ink` (white), per the mid-luminance saturated-fill rule.

## 3. Typography Rules

One family: **Segoe UI Variable** (system font on Windows 11; Display optical size for numerals and headings, Text for everything else). Fixed rem scale, ratio about 1.2. Light-on-dark compensation: body weight 450, line-height +0.05, tracking +0.01em.

| Token | Size | Weight | Use |
|---|---|---|---|
| `--text-xs` | 0.75rem | 500 | Captions, counts, timestamps |
| `--text-sm` | 0.875rem | 450 | Secondary lines, labels, buttons |
| `--text-base` | 1rem | 450 | Task titles, list items, body |
| `--text-lg` | 1.25rem | 600 | Panel titles, song title |
| `--text-xl` | 1.75rem | 650 | Clock, routine times |
| `--text-display` | 3rem | 600 | Focus countdown |
| `--text-lyric` | 1.375rem | 700 | Lyric lines, Display optical size. The one weight above 650: lyrics are read at a glance while they move |

Numbers that tick (timers, clock, counts) use `font-variant-numeric: tabular-nums`. Sentence case everywhere; no tracked uppercase eyebrows.

## 4. Component Stylings

- **Island:** capsule (radius = height / 2) at rest; 34px tall. Peek 96px tall, radius 30. Open 480 × 468, radius 32. No border. Soft shadow only when peeking or open.
- **Tabs:** five labelled tabs (Tasks, Focus, Music, Chatbot, More); the active one sits on a `--well-strong` pill. More has its own row of compact icon pills where only the active section shows its label.
- **Calendar:** a month (weeks start Monday) beside the chosen day's tasks. Up to three 4px dots per day in the list colour, `--danger` for days already past. Today's number is `--soul`; the chosen day sits on `--well-strong`, or a `--soul` fill when it's today. Editing a task hides the month so the editor gets the full width.
- **Lyrics:** the sung line at full opacity and size; other lines at 50% opacity (about 4.8:1) and 97% size; lines two or more away softly blurred. The area fades out at top and bottom with a mask.
- **Buttons:** primary = `--soul` fill, `--on-soul` text, radius 999. Secondary = `--well` fill, `--ink` text. Icon buttons are 32px circles. All press to `scale(0.96)`.
- **Rows:** 44px minimum height, radius 12, `--well` on hover. Checkboxes are 20px rings in the list colour that fill and draw a check when done.
- **Inputs:** `--well` fill, radius 12, 40px tall, visible label or icon, focus ring 2px `--soul` offset 2px.
- **Toggles:** 36 × 22 track, thumb slides on a spring; on = `--soul`.
- **Stats:** one card of rows, Settings-style: name and a detail on the left, a 30px graph of the last minute (a `--soul` line over a 16% fill, on a `--line` baseline), the value on the right in `--text-lg`. Network draws upload as a second `--ink-3` line. Graphs step once a second with no animation.
- **Empty states:** one sentence that says what to do, plus the action.

## 5. Layout Principles

4pt spacing scale: 4, 8, 12, 16, 20, 24, 32. Tight 8px gaps inside a group, 16 to 20px between groups. The open island has a fixed 36px top bar (time, soul, next alarm), a 40px tab row, and a 374px content area with 16px side padding. Nothing escapes the capsule: menus, pickers and editors open inline, because clicks outside the island fall through to the desktop.

## 6. Depth & Elevation

Flat. Separation comes from black against graphite wells, not from shadows. The only shadow is the island's own ambient shadow when expanded (`0 18px 48px oklch(0 0 0 / 0.38)`), so it reads on bright wallpapers.

## 7. Motion

- **Island morph (the signature):** a real spring on width, height and radius, duration 0.5s, bounce 0.22. Interruptible: a new target keeps the current velocity, so hover-in/hover-out never snaps.
- **Content in:** 200ms `cubic-bezier(0.22, 1, 0.36, 1)` with opacity 0 to 1, blur 6px to 0, scale 0.96 to 1, delayed 60ms behind the shape. **Content out:** 120ms, no delay.
- **Feedback:** press scale 0.96 over 120ms; checkbox fill plus check draw 220ms.
- **List changes:** rows enter and leave by `grid-template-rows` 0fr/1fr, 220ms ease-out.
- **Lyrics (the second signature):** each line glides with `translate` on a nearly critically damped spring (`--ease-spring`: 900ms, under 1% overshoot), sampled into CSS `linear()` so it runs on the compositor. Each line below the sung one starts 42ms after the one above, so the block ripples into place. A JS clock wakes only when the next line is due; there's no per-frame script. Scrolling by hand sharpens every line and pauses following for 2.6s. Instrumental breaks show three dots that fill across the pause and breathe. The hover peek swaps lines with a short rise and blur.
- **Soul:** idle drift and blink, eyes follow the cursor through a spring, closed eyes during focus, squint on completion, a short spark burst when today's list is cleared. Never more than about 1s for any moment.
- **Reduced motion:** the capsule changes size instantly with a 150ms crossfade of its content; the soul keeps blinking but stops drifting and sparking; lyrics jump to the sung line with a 150ms crossfade and no blur, scaling or cascade.

## 8. Do's and Don'ts

- Do keep colour for meaning: soul, list, due state, selection.
- Do write button labels as verb plus object ("Add task", "Snooze 10 min", "Start focus").
- Don't use side-stripe borders, gradient text, decorative glass, or uppercase eyebrows.
- Don't let any overlay leave the capsule.
- Don't animate anything triggered from the keyboard beyond the island's own state change.

## 9. Personalise

Everything above is the default look; Settings → Personalise lets the user change it. The system stays token-driven so every choice reaches every component:

- **Accent:** one `--accent` (ten presets, all OKLCH L 0.78–0.88 so `--on-soul` dark text still reads on a filled button). `--soul`, `--soul-hover`, `--on-soul`, `--focus-ring` and the soul canvas all derive from it, using relative colour syntax.
- **Themes:** Black (default), Graphite and Midnight only change the four surface tokens and `--line`. Light also flips the inks, darkens `--soul`, `--work`, `--study` and `--danger` so text and thin strokes keep 4.5:1, and puts white text on filled soul buttons.
- **Styles:** Island floats 6px below the top edge. Notch sits at the top edge with square top corners, smaller lower radii, and two 10px concave "ears" (radial-gradient quarter circles) that island.js keeps beside the capsule as it springs. Soul rests as the bare soul with a drop shadow; the capsule's background fades in as it grows on hover.
- **Size:** a `scale` on the capsule (90%, 100%, 110%) from its top centre; the native hit area is scaled to match.
- **Backgrounds:** static layers behind the expanded island only (never at rest), defined once as `--deco-*` variables so the Personalise tiles preview the real thing. Album art is the cover blurred 42px at 42% (30% on Light).
- **Fonts:** Windows 11 system families only, as `--font-*` stacks, so nothing is downloaded.
- **Controls on the Personalise page** reuse the settings vocabulary (grouped rows, switches, segmented choices, chips) one step lighter than the card, and the island itself is the preview: every change applies at once.
