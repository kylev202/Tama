//! The island window: centred on the top edge of the primary monitor, click-through
//! everywhere except the capsule, and hidden while a fullscreen app has focus.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows::Win32::Foundation::RECT;

use crate::system;

/// Logical size of the island window; the open panel has to fit inside it.
const WINDOW: (f64, f64) = (600.0, 600.0);
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

#[derive(Default)]
pub struct Island {
    frame: Mutex<Frame>,
    /// The capsule's bounds in CSS pixels, relative to the window: x, y, width, height.
    capsule: Mutex<(f64, f64, f64, f64)>,
    focusable: AtomicBool,
    hidden: AtomicBool,
    /// The window that had keyboard focus before a text field in the island took it.
    previous_focus: Mutex<isize>,
}

#[derive(Clone, Copy, Default, PartialEq)]
struct Frame {
    monitor: RECT,
    origin: (i32, i32),
    scale: f64,
}

impl Island {
    /// Whether a screen point (physical pixels) is over the capsule. The strip above the
    /// capsule counts too, so flinging the pointer at the top edge of the screen reaches it.
    fn hit(&self, (x, y): (i32, i32)) -> bool {
        let frame = *self.frame.lock().unwrap();
        let (left, top, width, height) = *self.capsule.lock().unwrap();
        let px = |v: f64| (v * frame.scale).round() as i32;
        let x0 = frame.origin.0 + px(left);
        let bottom = frame.origin.1 + px(top + height);
        x >= x0 && x < x0 + px(width) && y >= frame.monitor.top && y < bottom
    }
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Island::default());
    // Unowned windows always get a taskbar button and an Alt+Tab entry; an owned one doesn't.
    // The owner is a hidden helper window that is never shown.
    let owner = system::hidden_owner_window()?;
    let window = WebviewWindowBuilder::new(app, "island", WebviewUrl::default())
        .title("Tama")
        .inner_size(WINDOW.0, WINDOW.1)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .visible(false)
        .focused(false)
        .focusable(false)
        // Form suggestions open a dropdown that can spill outside the capsule.
        .general_autofill_enabled(false)
        .additional_browser_args(BROWSER_ARGS)
        .owner_raw(owner)
        .build()?;
    place(&window, &app.state::<Island>());
    window.set_ignore_cursor_events(true)?;
    window.show()?;
    let handle = app.handle().clone();
    std::thread::Builder::new()
        .name("island".into())
        .spawn(move || watch(handle))?;
    Ok(())
}

/// Centres the window on the top edge of the primary monitor, if the layout changed.
fn place(window: &WebviewWindow, island: &Island) {
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let (pos, size, scale) = (*monitor.position(), *monitor.size(), monitor.scale_factor());
    let rect = RECT {
        left: pos.x,
        top: pos.y,
        right: pos.x + size.width as i32,
        bottom: pos.y + size.height as i32,
    };
    let mut frame = island.frame.lock().unwrap();
    if frame.monitor == rect && frame.scale == scale {
        return;
    }
    let width = (WINDOW.0 * scale).round() as i32;
    let height = (WINDOW.1 * scale).round() as i32;
    let origin = (pos.x + (size.width as i32 - width) / 2, pos.y);
    let _ = window.set_position(PhysicalPosition::new(origin.0, origin.1));
    let _ = window.set_size(PhysicalSize::new(width as u32, height as u32));
    *frame = Frame { monitor: rect, origin, scale };
}

/// Polls the pointer (cheap, and no hooks) to make the capsule clickable only while it is
/// under the pointer, and checks for fullscreen apps and display changes every 1.5 s.
fn watch(app: AppHandle) {
    let window = app.get_webview_window("island").expect("island window");
    let Ok(hwnd) = window.hwnd() else { return };
    let island = app.state::<Island>();
    let mut hovered = false;
    for tick in 0u64.. {
        std::thread::sleep(Duration::from_millis(25));
        if tick % 60 == 0 {
            place(&window, &island);
            let monitor = island.frame.lock().unwrap().monitor;
            let fullscreen = system::fullscreen_app_on(monitor);
            if fullscreen != island.hidden.load(Ordering::SeqCst) {
                if fullscreen {
                    release_focus(&window, &island);
                    if hovered {
                        hovered = false;
                        let _ = window.set_ignore_cursor_events(true);
                    }
                }
                island.hidden.store(fullscreen, Ordering::SeqCst);
                system::show_window(hwnd, !fullscreen);
                let _ = app.emit("island-visible", !fullscreen);
            }
        }
        if island.hidden.load(Ordering::SeqCst) {
            continue;
        }
        let inside = system::cursor_pos().is_some_and(|point| island.hit(point));
        if inside != hovered {
            hovered = inside;
            let _ = window.set_ignore_cursor_events(!inside);
            let _ = app.emit("island-hover", inside);
        }
    }
}

/// The frontend reports the capsule's target bounds whenever its state changes.
#[tauri::command]
pub fn island_hit_rect(x: f64, y: f64, width: f64, height: f64, island: State<'_, Island>) {
    *island.capsule.lock().unwrap() = (x, y, width, height);
}

/// Lets a text field in the island take keyboard focus. The island is otherwise
/// non-activating, so clicking it never pulls focus away from the app you're in.
#[tauri::command]
pub fn island_focus(window: WebviewWindow, island: State<'_, Island>) -> Result<(), String> {
    if island.focusable.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    *island.previous_focus.lock().unwrap() = system::foreground();
    window.set_focusable(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Hands keyboard focus back to the app that had it before.
#[tauri::command]
pub fn island_release(window: WebviewWindow, island: State<'_, Island>) {
    release_focus(&window, &island);
}

fn release_focus(window: &WebviewWindow, island: &Island) {
    if !island.focusable.swap(false, Ordering::SeqCst) {
        return;
    }
    let _ = window.set_focusable(false);
    let previous = std::mem::take(&mut *island.previous_focus.lock().unwrap());
    // Only if the island still has focus: the user may have clicked into another app.
    if let Ok(ours) = window.hwnd() {
        if previous != 0 && system::foreground() == ours.0 as isize {
            system::activate(previous);
        }
    }
}
