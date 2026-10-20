# Product

## Register

product

## Users

One person on their own Windows 11 desktop (three monitors, 1080p primary) who juggles work tasks and study. Tama sits at the top of the main screen all day. They glance at it, hover it for quick controls, and open it to plan, focus and tidy their desktop. Sessions are a few seconds long and happen many times a day.

## Product Purpose

Tama is a Dynamic Island for Windows, modelled on the island in Hitodama: a black capsule with a small soul inside that shows live activities (focus countdown, now playing, next due task) and opens into panels for tasks and focus, music with synced lyrics, a chatbot that sets up routines, and (under More) clipboard, apps and web search, wallpapers, PC stats and quick settings. Tasks and music come first because they're what the user opens it for many times a day; the Chatbot sits beside them on the main row (moved there from More at the user's request, 2026-10-20). Everything runs offline except lyrics lookups and the Chatbot.

Success: the user plans work and study in it every day, trusts its reminders, and the desktop feels calmer and more personal than stock Windows.

## Brand Personality

Playful, alive, precise. The soul is a character with small moments of personality: it watches the cursor, blinks, closes its eyes during focus, and lights up when the day's tasks are done. The surface around it stays as disciplined as an Apple control. Copy is short, warm and specific.

## Anti-references

- Gamer RGB or neon glow aesthetics.
- Childish mascot styling: cartoon faces, outlines, blush, everything bouncing.
- Busy dashboards: walls of numbers, charts and badges.
- Glass blur used as decoration; gradient text.

## Design Principles

1. **One living object.** Every state change is the same capsule morphing on a spring, never a new window popping up.
2. **Glanceable first.** The collapsed island answers "what's happening now" (focus left, current song, next task) without opening anything.
3. **Personality lives in the soul and in moments** (completion, streaks, alerts), not in decoration.
4. **Never steal the desktop.** Clicks pass through around it, it hides for fullscreen apps, and it only takes keyboard focus when the user types into it.
5. **Offline and private.** Nothing leaves the PC except two things. A lyrics lookup: the song's title, artist, album and length go to LRCLIB once per song and the answer is cached. Lyrics are on by default; the lyrics button in Music turns them off. And the Chatbot (added 2026-10-20 at the user's request; routines are now set up by chatting, and the Routines editor is hidden). It started on Claude and moved the same day to a free model, gpt-oss-120b on Groq's free tier, which the user chose over a local Ollama model: what the user types, their routines and matching app names go to Groq, only after they add their own free API key. The key lives in Windows Credential Manager and never reaches the webview. Clipboard history and the chat live in memory only.

## Accessibility & Inclusion

- WCAG 2.2 AA contrast for all text, placeholders included (4.5:1 or better).
- Visible keyboard focus on every control; tabs move with arrow keys; Esc closes the island.
- Follows Windows "Animation effects" (prefers-reduced-motion): springs become short crossfades and the soul stops drifting.
- Work and Study are told apart by label and icon as well as colour.
