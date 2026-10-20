//! Commands the panels call. Shell and COM work runs on the STA thread, off the UI thread.

use std::path::Path;

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

use crate::{audio, com, shell, system};

type Reply<T> = Result<T, String>;

async fn on_sta<T: Send + 'static>(
    job: impl FnOnce() -> windows::core::Result<T> + Send + 'static,
) -> Reply<T> {
    blocking(move || com::on_sta(job).map_err(|e| e.message())).await
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Reply<T> + Send + 'static) -> Reply<T> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn volume_get() -> Reply<audio::Volume> {
    on_sta(audio::get).await
}

#[tauri::command]
pub async fn volume_set(level: f32) -> Reply<()> {
    on_sta(move || audio::set_level(level)).await
}

#[tauri::command]
pub async fn volume_mute(muted: bool) -> Reply<()> {
    on_sta(move || audio::set_muted(muted)).await
}

#[tauri::command]
pub fn theme_get() -> bool {
    system::dark_mode()
}

#[tauri::command]
pub async fn theme_set(dark: bool) -> Reply<()> {
    blocking(move || system::set_dark_mode(dark).map_err(|e| e.message())).await
}

#[tauri::command]
pub async fn settings_open(page: String) -> Reply<()> {
    on_sta(move || shell::open_settings(&page)).await
}

#[tauri::command]
pub fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn autostart_set(enabled: bool, app: AppHandle) -> Reply<()> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    crate::sync_tray(&app);
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apps_list() -> Reply<Vec<shell::App>> {
    on_sta(shell::list_apps).await
}

#[tauri::command]
pub async fn app_icon(id: String) -> Reply<String> {
    on_sta(move || shell::app_icon(&id)).await
}

#[tauri::command]
pub async fn app_launch(id: String) -> Reply<()> {
    on_sta(move || shell::launch_app(&id)).await
}

#[tauri::command]
pub async fn url_open(url: String) -> Reply<()> {
    on_sta(move || shell::open_url(&url)).await
}

#[tauri::command]
pub async fn wallpapers_list(folder: String) -> Reply<Vec<String>> {
    blocking(move || shell::list_images(Path::new(&folder)).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn wallpaper_thumb(path: String) -> Reply<String> {
    on_sta(move || shell::thumbnail(&path)).await
}

#[tauri::command]
pub async fn wallpaper_set(path: String) -> Reply<()> {
    on_sta(move || shell::set_wallpaper(&path)).await
}

#[tauri::command]
pub async fn wallpapers_current() -> Reply<Vec<String>> {
    on_sta(shell::current_wallpapers).await
}

/// Pictures\Wallpapers, if it exists.
#[tauri::command]
pub fn wallpaper_default_folder(app: AppHandle) -> Option<String> {
    let folder = app.path().picture_dir().ok()?.join("Wallpapers");
    folder.is_dir().then(|| folder.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn folder_pick(app: AppHandle) -> Option<String> {
    let window = app.get_webview_window("island")?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_parent(&window).blocking_pick_folder()
    })
    .await
    .ok()??;
    picked.into_path().ok().map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}
