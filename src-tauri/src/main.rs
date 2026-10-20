// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod chat;
mod clipboard;
mod com;
mod commands;
mod island;
mod lyrics;
mod media;
mod scheduler;
mod shell;
mod stats;
mod system;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// The tray's "Start with Windows" item, kept so the Settings panel can update its tick.
struct TrayAutostart(CheckMenuItem<Wry>);

fn main() {
    tauri::Builder::default()
        // A second launch (say, from the Start menu while autostarted) just exits.
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            island::island_hit_rect,
            island::island_focus,
            island::island_release,
            media::media_now,
            media::media_art,
            media::media_control,
            media::media_seek,
            lyrics::lyrics_get,
            chat::chat_key_status,
            chat::chat_key_set,
            chat::chat_send,
            stats::stats_get,
            clipboard::clipboard_list,
            clipboard::clipboard_copy,
            clipboard::clipboard_remove,
            clipboard::clipboard_clear,
            scheduler::schedule_set,
            commands::volume_get,
            commands::volume_set,
            commands::volume_mute,
            commands::theme_get,
            commands::theme_set,
            commands::settings_open,
            commands::autostart_get,
            commands::autostart_set,
            commands::apps_list,
            commands::app_icon,
            commands::app_launch,
            commands::url_open,
            commands::wallpapers_list,
            commands::wallpaper_thumb,
            commands::wallpaper_set,
            commands::wallpapers_current,
            commands::wallpaper_default_folder,
            commands::folder_pick,
            commands::app_quit,
        ])
        .setup(|app| {
            island::setup(app)?;
            media::start(app.handle());
            clipboard::start(app.handle());
            scheduler::start(app.handle());
            tray(app)?;
            #[cfg(not(debug_assertions))]
            first_run_autostart(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Tama");
}

fn tray(app: &tauri::App) -> tauri::Result<()> {
    let enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Tama", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&autostart, &PredefinedMenuItem::separator(app)?, &quit])?;
    TrayIconBuilder::with_id("tama")
        .icon(app.default_window_icon().cloned().expect("the bundle always has an icon"))
        .tooltip("Tama")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "autostart" => {
                let launcher = app.autolaunch();
                let _ = if launcher.is_enabled().unwrap_or(false) { launcher.disable() } else { launcher.enable() };
                sync_tray(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    app.manage(TrayAutostart(autostart));
    Ok(())
}

/// Makes the tray tick match the real autostart setting.
pub fn sync_tray(app: &AppHandle) {
    if let Some(item) = app.try_state::<TrayAutostart>() {
        let _ = item.0.set_checked(app.autolaunch().is_enabled().unwrap_or(false));
    }
}

/// Turns autostart on the first time an installed build runs. Later runs only refresh the
/// registered path (in case the app moved), and only if the user left it on.
#[cfg(not(debug_assertions))]
fn first_run_autostart(app: &tauri::App) {
    let launcher = app.autolaunch();
    let Ok(dir) = app.path().app_data_dir() else { return };
    let marker = dir.join("autostart-initialised");
    if !marker.exists() || launcher.is_enabled().unwrap_or(false) {
        let _ = launcher.enable();
        let _ = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&marker, ""));
    }
}
