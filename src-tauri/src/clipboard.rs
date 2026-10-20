//! Text clipboard history. Kept in memory only, and gone when Tama quits.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use clipboard_win::raw::{is_format_avail, register_format, seq_num};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_ITEMS: usize = 30;
/// Longer copies (a whole log file, say) are skipped rather than truncated.
const MAX_CHARS: usize = 200_000;
const PREVIEW_CHARS: usize = 280;

struct Clip {
    id: u64,
    text: String,
    at: u64,
}

#[derive(Serialize)]
pub struct ClipView {
    id: u64,
    preview: String,
    at: u64,
}

#[derive(Default)]
pub struct History {
    clips: Mutex<Vec<Clip>>,
    next_id: Mutex<u64>,
}

impl History {
    fn push(&self, text: String) {
        let mut clips = self.clips.lock().unwrap();
        clips.retain(|clip| clip.text != text);
        let mut next_id = self.next_id.lock().unwrap();
        *next_id += 1;
        clips.insert(0, Clip { id: *next_id, text, at: now_ms() });
        clips.truncate(MAX_ITEMS);
    }

    fn views(&self) -> Vec<ClipView> {
        let clips = self.clips.lock().unwrap();
        clips
            .iter()
            .map(|clip| ClipView {
                id: clip.id,
                preview: clip.text.chars().take(PREVIEW_CHARS).collect(),
                at: clip.at,
            })
            .collect()
    }
}

pub fn start(app: &AppHandle) {
    let history = Arc::new(History::default());
    app.manage(history.clone());
    let app = app.clone();
    std::thread::Builder::new()
        .name("clipboard".into())
        .spawn(move || {
            // Password managers tag secrets with these formats so history tools leave them
            // out. Any of them present means skip (even "CanIncludeInClipboardHistory",
            // which is only ever set to say no in practice).
            let private: Vec<u32> = [
                "ExcludeClipboardContentFromMonitorProcessing",
                "CanIncludeInClipboardHistory",
                "Clipboard Viewer Ignore",
            ]
            .iter()
            .filter_map(|name| register_format(name))
            .map(|format| format.get())
            .collect();
            let mut seen = None;
            loop {
                let seq = seq_num();
                if seq != seen {
                    seen = seq;
                    if !private.iter().any(|&format| is_format_avail(format)) {
                        if let Ok(text) = clipboard_win::get_clipboard_string() {
                            if !text.trim().is_empty() && text.chars().count() <= MAX_CHARS {
                                history.push(text);
                                let _ = app.emit("clipboard", &history.views());
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        })
        .expect("failed to start the clipboard thread");
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[tauri::command]
pub fn clipboard_list(history: State<'_, Arc<History>>) -> Vec<ClipView> {
    history.views()
}

#[tauri::command]
pub fn clipboard_copy(id: u64, history: State<'_, Arc<History>>) -> Result<(), String> {
    let text = {
        let clips = history.clips.lock().unwrap();
        clips.iter().find(|clip| clip.id == id).map(|clip| clip.text.clone())
    };
    let text = text.ok_or("That clip is no longer in the history")?;
    clipboard_win::set_clipboard_string(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_remove(id: u64, app: AppHandle, history: State<'_, Arc<History>>) {
    history.clips.lock().unwrap().retain(|clip| clip.id != id);
    let _ = app.emit("clipboard", &history.views());
}

#[tauri::command]
pub fn clipboard_clear(app: AppHandle, history: State<'_, Arc<History>>) {
    history.clips.lock().unwrap().clear();
    let _ = app.emit("clipboard", &history.views());
}
