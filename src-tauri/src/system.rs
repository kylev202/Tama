//! Small Win32 helpers: pointer, foreground window, fullscreen detection, theme.

use std::ffi::c_void;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::System::Registry::{
    RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect, IsWindow,
    IsZoomed, SendMessageTimeoutW, SetForegroundWindow, ShowWindowAsync, HWND_BROADCAST,
    SMTO_ABORTIFHUNG, SW_HIDE, SW_SHOWNOACTIVATE, WM_SETTINGCHANGE, WS_EX_TOOLWINDOW, WS_POPUP,
};

/// A never-shown window to own the island, which keeps the island out of the taskbar and
/// Alt+Tab. Uses the built-in STATIC class, so there is no class to register.
pub fn hidden_owner_window() -> windows::core::Result<HWND> {
    unsafe {
        CreateWindowExW(WS_EX_TOOLWINDOW, w!("STATIC"), w!("Tama"), WS_POPUP, 0, 0, 0, 0, None, None, None, None)
    }
}

pub fn cursor_pos() -> Option<(i32, i32)> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x, point.y))
}

/// The foreground window as a plain integer, so it can be stored across threads.
pub fn foreground() -> isize {
    unsafe { GetForegroundWindow() }.0 as isize
}

pub fn activate(window: isize) {
    let window = HWND(window as *mut c_void);
    unsafe {
        if IsWindow(Some(window)).as_bool() {
            let _ = SetForegroundWindow(window);
        }
    }
}

/// Shows or hides without activating. Tauri's `show()` would steal focus from whatever
/// app the user just switched to.
pub fn show_window(window: HWND, visible: bool) {
    unsafe {
        let _ = ShowWindowAsync(window, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }
}

/// Whether the foreground app covers all of `monitor`: a game, a fullscreen video, a slideshow.
pub fn fullscreen_app_on(monitor: RECT) -> bool {
    unsafe {
        let window = GetForegroundWindow();
        if window.is_invalid() || IsZoomed(window).as_bool() {
            return false;
        }
        let mut class = [0u16; 32];
        let len = GetClassNameW(window, &mut class).max(0) as usize;
        // The desktop and the taskbar span the screen too.
        if matches!(
            String::from_utf16_lossy(&class[..len]).as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd"
        ) {
            return false;
        }
        let mut rect = RECT::default();
        GetWindowRect(window, &mut rect).is_ok()
            && rect.left <= monitor.left
            && rect.top <= monitor.top
            && rect.right >= monitor.right
            && rect.bottom >= monitor.bottom
    }
}

const PERSONALIZE: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");

pub fn dark_mode() -> bool {
    let mut light = 1u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PERSONALIZE,
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut light as *mut u32 as *mut c_void),
            Some(&mut size),
        )
    };
    status.is_ok() && light == 0
}

pub fn set_dark_mode(dark: bool) -> windows::core::Result<()> {
    let light = u32::from(!dark);
    for name in [w!("AppsUseLightTheme"), w!("SystemUsesLightTheme")] {
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PERSONALIZE,
                name,
                REG_DWORD.0,
                Some(&light as *const u32 as *const c_void),
                std::mem::size_of::<u32>() as u32,
            )
        }
        .ok()?;
    }
    // Running apps and the taskbar re-read the theme when told this setting changed.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(w!("ImmersiveColorSet").as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            200,
            None,
        );
    }
    Ok(())
}
