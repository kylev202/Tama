//! The Windows shell: installed apps (Start's "All apps"), icons, thumbnails, wallpapers,
//! Settings pages and web links.

use std::ffi::c_void;
use std::path::Path;
use std::sync::Mutex;

use base64::Engine;
use serde::Serialize;
use windows::core::{Error, Result, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_FAIL, E_INVALIDARG, SIZE};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, DesktopWallpaper, FOLDERID_AppsFolder, IDesktopWallpaper, IEnumShellItems,
    IShellItem, IShellItemImageFactory, SHCreateItemFromParsingName, SHGetKnownFolderItem,
    ShellExecuteW, KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING, SIIGBF,
    SIIGBF_ICONONLY, SIIGBF_RESIZETOFIT,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[derive(Clone, Serialize)]
pub struct App {
    id: String,
    name: String,
}

/// The last listing, so launches can be checked against what Start actually offers.
static APPS: Mutex<Vec<App>> = Mutex::new(Vec::new());

/// Everything in Start's "All apps": Win32 shortcuts and Store apps alike.
pub fn list_apps() -> Result<Vec<App>> {
    let mut apps = Vec::new();
    unsafe {
        let folder: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)?;
        let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems)?;
        loop {
            let mut batch = [None];
            let mut fetched = 0u32;
            if items.Next(&mut batch, Some(&mut fetched as *mut u32)).is_err() || fetched == 0 {
                break;
            }
            let Some(item) = batch[0].take() else { break };
            let name = take_string(item.GetDisplayName(SIGDN_NORMALDISPLAY)?);
            let id = take_string(item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING)?);
            if is_app(&name, &id) {
                apps.push(App { id, name });
            }
        }
    }
    apps.sort_by_cached_key(|app| app.name.to_lowercase());
    apps.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    APPS.lock().unwrap().clone_from(&apps);
    Ok(apps)
}

/// Start also lists uninstallers, readmes and web links; leave those out.
fn is_app(name: &str, id: &str) -> bool {
    const DOCUMENTS: [&str; 9] = [".url", ".txt", ".chm", ".htm", ".html", ".pdf", ".rtf", ".ini", ".hlp"];
    let id = id.to_ascii_lowercase();
    !name.is_empty()
        && !name.to_lowercase().contains("uninstall")
        && !id.starts_with("http")
        && !DOCUMENTS.iter().any(|ext| id.ends_with(ext))
}

pub fn launch_app(id: &str) -> Result<()> {
    let known = APPS.lock().unwrap().iter().any(|app| app.id == id);
    if !known && !list_apps()?.iter().any(|app| app.id == id) {
        return Err(E_INVALIDARG.into());
    }
    shell_open(&format!("shell:AppsFolder\\{id}"))
}

/// Opens a web link in the default browser. Only http(s): anything else could start programs.
pub fn open_url(url: &str) -> Result<()> {
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(E_INVALIDARG.into());
    }
    shell_open(url.trim())
}

pub fn open_settings(page: &str) -> Result<()> {
    let uri = match page {
        "display" => "ms-settings:display",
        "sound" => "ms-settings:sound",
        "bluetooth" => "ms-settings:bluetooth",
        "personalization" => "ms-settings:personalization",
        _ => return Err(E_INVALIDARG.into()),
    };
    shell_open(uri)
}

fn shell_open(target: &str) -> Result<()> {
    let result = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &HSTRING::from(target),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute signals success with a value above 32.
    if result.0 as usize > 32 {
        Ok(())
    } else {
        Err(Error::from_thread())
    }
}

pub fn app_icon(id: &str) -> Result<String> {
    shell_image(&format!("shell:AppsFolder\\{id}"), 64, SIIGBF_ICONONLY)
}

pub fn thumbnail(path: &str) -> Result<String> {
    if !is_image(Path::new(path)) {
        return Err(E_INVALIDARG.into());
    }
    shell_image(path, 256, SIIGBF_RESIZETOFIT)
}

/// Asks the shell for an icon or thumbnail (it uses its own thumbnail cache) as a PNG data URL.
fn shell_image(parsing_name: &str, size: i32, flags: SIIGBF) -> Result<String> {
    unsafe {
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(parsing_name), None)?;
        let bitmap = factory.GetImage(SIZE { cx: size, cy: size }, flags)?;
        let pixels = read_bitmap(bitmap);
        let _ = DeleteObject(bitmap.into());
        let (width, height, rgba) = pixels.ok_or_else(|| Error::from(E_FAIL))?;
        png_data_url(width, height, &rgba).ok_or_else(|| Error::from(E_FAIL))
    }
}

unsafe fn read_bitmap(bitmap: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    let mut info = BITMAP::default();
    let read = GetObjectW(
        bitmap.into(),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut info as *mut BITMAP as *mut c_void),
    );
    if read == 0 {
        return None;
    }
    let (width, height) = (info.bmWidth, info.bmHeight.abs());
    let mut header = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // negative: rows run top to bottom
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let dc = GetDC(None);
    let rows = GetDIBits(dc, bitmap, 0, height as u32, Some(pixels.as_mut_ptr().cast()), &mut header, DIB_RGB_COLORS);
    ReleaseDC(None, dc);
    (rows == height).then(|| (width as u32, height as u32, to_straight_rgba(pixels)))
}

/// Shell bitmaps are BGRA, usually with premultiplied alpha; photo thumbnails often carry
/// no alpha at all (every pixel 0), which would otherwise come out invisible.
fn to_straight_rgba(mut pixels: Vec<u8>) -> Vec<u8> {
    let no_alpha = pixels.chunks_exact(4).all(|p| p[3] == 0);
    let premultiplied = !no_alpha && pixels.chunks_exact(4).all(|p| p[0].max(p[1]).max(p[2]) <= p[3]);
    for p in pixels.chunks_exact_mut(4) {
        let alpha = if no_alpha { 255 } else { p[3] };
        let straight = |c: u8| {
            if premultiplied && alpha != 0 {
                ((u32::from(c) * 255 + u32::from(alpha) / 2) / u32::from(alpha)).min(255) as u8
            } else {
                c
            }
        };
        let (b, g, r) = (p[0], p[1], p[2]);
        p[0] = straight(r);
        p[1] = straight(g);
        p[2] = straight(b);
        p[3] = alpha;
    }
    pixels
}

fn png_data_url(width: u32, height: u32, rgba: &[u8]) -> Option<String> {
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().ok()?.write_image_data(rgba).ok()?;
    let data = base64::engine::general_purpose::STANDARD.encode(&png);
    Some(format!("data:image/png;base64,{data}"))
}

const IMAGE_EXTENSIONS: [&str; 9] = ["jpg", "jpeg", "jfif", "png", "bmp", "gif", "webp", "tif", "tiff"];

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

pub fn list_images(folder: &Path) -> std::io::Result<Vec<String>> {
    let mut images: Vec<String> = std::fs::read_dir(folder)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| is_image(path) && path.is_file())
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect();
    images.sort_by_cached_key(|path| path.to_lowercase());
    images.truncate(500);
    Ok(images)
}

/// Sets the wallpaper on every monitor, keeping the user's fit setting.
pub fn set_wallpaper(path: &str) -> Result<()> {
    let file = Path::new(path);
    if !is_image(file) || !file.is_file() {
        return Err(E_INVALIDARG.into());
    }
    unsafe {
        let wallpaper: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL)?;
        wallpaper.SetWallpaper(PCWSTR::null(), &HSTRING::from(path))
    }
}

/// The wallpaper on each monitor.
pub fn current_wallpapers() -> Result<Vec<String>> {
    unsafe {
        let wallpaper: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL)?;
        let mut paths = Vec::new();
        for index in 0..wallpaper.GetMonitorDevicePathCount()? {
            let monitor = wallpaper.GetMonitorDevicePathAt(index)?;
            let current = wallpaper.GetWallpaper(PCWSTR(monitor.0));
            CoTaskMemFree(Some(monitor.0 as *const c_void));
            if let Ok(path) = current {
                paths.push(take_string(path));
            }
        }
        Ok(paths)
    }
}

/// Copies a shell-allocated string and frees it.
unsafe fn take_string(text: PWSTR) -> String {
    let value = text.to_string().unwrap_or_default();
    CoTaskMemFree(Some(text.0 as *const c_void));
    value
}
