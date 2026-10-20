//! Now playing, read from the Windows media session that Spotify, browsers and most
//! players publish (the same source as the media flyout in Quick Settings).

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::core::Result;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;

#[derive(Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    album: String,
    app: String,
    playing: bool,
    can_previous: bool,
    can_next: bool,
    can_seek: bool,
    /// Position in ms at `updated_at`; the frontend extrapolates while playing.
    position: u64,
    duration: u64,
    /// Unix time in ms when the player last reported its position.
    updated_at: u64,
    /// Bumped whenever the artwork changes; fetch it with `media_art`.
    art_version: u32,
}

enum Command {
    TogglePlay,
    Next,
    Previous,
    /// Position in ms from the start of the track.
    Seek(u64),
}

pub struct Media {
    now: Mutex<Option<NowPlaying>>,
    art: Mutex<Option<String>>,
    commands: Sender<Command>,
}

pub fn start(app: &AppHandle) {
    let (tx, rx) = mpsc::channel();
    let media = Arc::new(Media { now: Mutex::new(None), art: Mutex::new(None), commands: tx });
    app.manage(media.clone());
    let app = app.clone();
    std::thread::Builder::new()
        .name("media".into())
        .spawn(move || run(app, media, rx))
        .expect("failed to start the media thread");
}

fn run(app: AppHandle, media: Arc<Media>, commands: Receiver<Command>) {
    crate::com::init_mta();
    let manager = loop {
        match SessionManager::RequestAsync().and_then(|op| op.join()) {
            Ok(manager) => break manager,
            Err(_) => std::thread::sleep(Duration::from_secs(5)),
        }
    };
    let mut track = String::new();
    // Players often publish artwork a moment after the title, so look a few times.
    let mut art_checks = 0;
    let mut art_version = 0u32;
    loop {
        match commands.recv_timeout(Duration::from_secs(1)) {
            Ok(command) => {
                if let Ok(session) = manager.GetCurrentSession() {
                    let _ = send(&session, command);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let snapshot = match manager.GetCurrentSession().and_then(|s| read(&s)) {
            Ok((mut info, props)) => {
                let key = format!("{}\u{1f}{}\u{1f}{}", info.title, info.artist, info.app);
                if key != track {
                    track = key;
                    art_checks = 3;
                }
                if art_checks > 0 {
                    art_checks -= 1;
                    let art = read_art(&props);
                    let mut current = media.art.lock().unwrap();
                    if *current != art {
                        *current = art;
                        art_version += 1;
                    }
                }
                info.art_version = art_version;
                Some(info)
            }
            Err(_) => {
                track.clear();
                if media.art.lock().unwrap().take().is_some() {
                    art_version += 1;
                }
                None
            }
        };
        let mut now = media.now.lock().unwrap();
        if changed(now.as_ref(), snapshot.as_ref()) {
            now.clone_from(&snapshot);
            drop(now);
            let _ = app.emit("media", snapshot);
        }
    }
}

/// Whether `next` tells the frontend anything new, compared with the last snapshot sent.
/// A position that simply moved on with playback isn't news (the frontend extrapolates it);
/// players like Chrome re-report it every few seconds. A seek, pause or new track is, and
/// so is drift of more than a beat, which synced lyrics would show.
fn changed(last: Option<&NowPlaying>, next: Option<&NowPlaying>) -> bool {
    let (Some(a), Some(b)) = (last, next) else {
        return last.is_some() != next.is_some();
    };
    let same_story = a.title == b.title
        && a.artist == b.artist
        && a.album == b.album
        && a.app == b.app
        && a.playing == b.playing
        && a.can_previous == b.can_previous
        && a.can_next == b.can_next
        && a.can_seek == b.can_seek
        && a.duration == b.duration
        && a.art_version == b.art_version;
    if !same_story {
        return true;
    }
    if b.duration == 0 {
        return false;
    }
    let expected = if a.playing { a.position + b.updated_at.saturating_sub(a.updated_at) } else { a.position };
    expected.abs_diff(b.position) > 750
}

fn read(session: &Session) -> Result<(NowPlaying, MediaProperties)> {
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let playback = session.GetPlaybackInfo()?;
    let controls = playback.Controls()?;
    let timeline = session.GetTimelineProperties()?;
    let start = timeline.StartTime()?.Duration;
    let ticks_to_ms = |ticks: i64| (ticks.max(0) / 10_000) as u64;
    let info = NowPlaying {
        title: props.Title()?.to_string(),
        artist: props.Artist()?.to_string(),
        album: props.AlbumTitle()?.to_string(),
        app: app_name(&session.SourceAppUserModelId()?.to_string()),
        playing: playback.PlaybackStatus()? == PlaybackStatus::Playing,
        can_previous: controls.IsPreviousEnabled()?,
        can_next: controls.IsNextEnabled()?,
        can_seek: controls.IsPlaybackPositionEnabled()?,
        position: ticks_to_ms(timeline.Position()?.Duration - start),
        duration: ticks_to_ms(timeline.EndTime()?.Duration - start),
        updated_at: unix_ms(timeline.LastUpdatedTime()?.UniversalTime),
        art_version: 0,
    };
    Ok((info, props))
}

fn send(session: &Session, command: Command) -> Result<bool> {
    match command {
        Command::TogglePlay => session.TryTogglePlayPauseAsync()?.join(),
        Command::Next => session.TrySkipNextAsync()?.join(),
        Command::Previous => session.TrySkipPreviousAsync()?.join(),
        Command::Seek(ms) => {
            let start = session.GetTimelineProperties()?.StartTime()?.Duration;
            session.TryChangePlaybackPositionAsync(start + ms as i64 * 10_000)?.join()
        }
    }
}

/// The artwork as a data URL. Only PNG and JPEG are passed through.
fn read_art(props: &MediaProperties) -> Option<String> {
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = u32::try_from(stream.Size().ok()?).ok().filter(|&s| s > 0 && s < 8_000_000)?;
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let mime = if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else {
        return None;
    };
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{data}"))
}

/// "Spotify.exe" → "Spotify"; "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → "Spotify".
/// Opaque ids (Firefox registers a hash) come back empty.
fn app_name(id: &str) -> String {
    let name = id.rsplit('!').next().unwrap_or(id);
    let name = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name);
    if name.len() >= 12 && name.chars().all(|c| c.is_ascii_hexdigit()) {
        return String::new();
    }
    let mut chars = name.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// WinRT time (100 ns ticks since 1601) to Unix ms; players that never set it get "now".
fn unix_ms(universal_time: i64) -> u64 {
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;
    if universal_time > EPOCH_DIFF {
        ((universal_time - EPOCH_DIFF) / 10_000) as u64
    } else {
        SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
    }
}

#[tauri::command]
pub fn media_now(media: State<'_, Arc<Media>>) -> Option<NowPlaying> {
    media.now.lock().unwrap().clone()
}

#[tauri::command]
pub fn media_art(media: State<'_, Arc<Media>>) -> Option<String> {
    media.art.lock().unwrap().clone()
}

#[tauri::command]
pub fn media_control(action: &str, media: State<'_, Arc<Media>>) -> std::result::Result<(), String> {
    let command = match action {
        "toggle" => Command::TogglePlay,
        "next" => Command::Next,
        "previous" => Command::Previous,
        _ => return Err(format!("unknown media action: {action}")),
    };
    media.commands.send(command).map_err(|e| e.to_string())
}

/// Jumps to a position (ms), for scrubbing and tapping a lyric line.
#[tauri::command]
pub fn media_seek(position: u64, media: State<'_, Arc<Media>>) -> std::result::Result<(), String> {
    media.commands.send(Command::Seek(position)).map_err(|e| e.to_string())
}
