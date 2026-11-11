//! Transparent monitoring indicator (Windows, user session).
//!
//! This is the on-screen counterpart to the honest naming: a persistent
//! system-tray icon that tells the logged-in user, plainly and at all times,
//! that the device is monitored. There is deliberately NO setting, menu item,
//! or config flag to hide or disable it — transparency is not optional.
//!
//! It runs inside the user-session screenshot-helper process (services in
//! session 0 cannot draw on the user's desktop), on its own thread with a Win32
//! message loop. On first run per user it also shows a one-time disclosure
//! notice describing what is monitored.
//!
//! `set_viewing(true/false)` is the hook for Part 5 (live screen view): when an
//! admin is actively viewing the screen, the tooltip changes to say so. Until
//! that feature ships it simply stays in the default "monitored" state.

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};
use tracing::{info, warn};

use winapi::shared::minwindef::{LPARAM, LRESULT, UINT, WPARAM};
use winapi::shared::windef::{HWND, POINT};
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::shellapi::{
    Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NIM_MODIFY,
    NOTIFYICONDATAW,
};
use winapi::um::winuser::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DispatchMessageW,
    GetCursorPos, GetMessageW, LoadIconW, MessageBoxW, PostQuitMessage, RegisterClassExW,
    SetForegroundWindow, TrackPopupMenu, TranslateMessage, IDI_SHIELD,
    MB_ICONINFORMATION, MB_OK, MB_SYSTEMMODAL, MF_STRING, TPM_BOTTOMALIGN, TPM_RIGHTBUTTON, MSG,
    WM_APP, WM_COMMAND, WM_DESTROY, WM_LBUTTONUP, WM_RBUTTONUP, WNDCLASSEXW,
};

const WM_TRAYICON: UINT = WM_APP + 1;
const ID_TRAY_ABOUT: u16 = 1001;
const TRAY_UID: UINT = 1;

const TIP_DEFAULT: &str = "This device is monitored by your employer (RAV Monitoring Agent).";
const TIP_VIEWING: &str = "Your screen is being viewed live by an administrator (RAV Monitoring).";

const ABOUT_TITLE: &str = "This computer is monitored";
const ABOUT_BODY: &str = "This is a company-managed computer.\n\n\
Activity on it — including screenshots of the screen, websites visited, USB device \
use, and applications run — is monitored and recorded by your employer for security \
purposes. When live screen viewing is in use, this tray icon's tooltip will say so.\n\n\
By using this computer you acknowledge this monitoring. Contact your IT administrator \
with any questions.";

const FIRST_RUN_TITLE: &str = "Notice: this device is monitored";
const FIRST_RUN_BODY: &str = "This company-managed computer is monitored by the RAV \
Monitoring Agent.\n\n\
Your employer records activity on it (screenshots, websites, USB devices, and \
applications) for security. A shield icon in the notification area (system tray) \
shows that monitoring is active at all times.\n\n\
By continuing to use this computer you acknowledge this monitoring. Questions? \
Contact your IT administrator.";

/// True while an admin is actively viewing the screen (Part 5). The message loop
/// repaints the tooltip when this changes.
static VIEWING: AtomicBool = AtomicBool::new(false);
static HWND_PTR: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Hook for the (future) live-view feature: set the indicator to the
/// "being viewed" state or back. Safe to call from any thread.
pub fn set_viewing(active: bool) {
    let was = VIEWING.swap(active, Ordering::SeqCst);
    if was != active {
        let hwnd = HWND_PTR.load(Ordering::SeqCst);
        if hwnd != 0 {
            unsafe { update_tooltip(hwnd as HWND, active) };
        }
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn fill_tip(nid: &mut NOTIFYICONDATAW, text: &str) {
    let wide: Vec<u16> = text.encode_utf16().take(nid.szTip.len() - 1).collect();
    for (i, slot) in nid.szTip.iter_mut().enumerate() {
        *slot = if i < wide.len() { wide[i] } else { 0 };
    }
}

fn base_nid(hwnd: HWND) -> NOTIFYICONDATAW {
    let mut nid: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd;
    nid.uID = TRAY_UID;
    nid
}

unsafe fn update_tooltip(hwnd: HWND, viewing: bool) {
    let mut nid = base_nid(hwnd);
    nid.uFlags = NIF_TIP;
    fill_tip(&mut nid, if viewing { TIP_VIEWING } else { TIP_DEFAULT });
    Shell_NotifyIconW(NIM_MODIFY, &mut nid);
}

fn message_box(title: &str, body: &str) {
    let wtitle = to_wide(title);
    let wbody = to_wide(body);
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            wbody.as_ptr(),
            wtitle.as_ptr(),
            MB_OK | MB_ICONINFORMATION | MB_SYSTEMMODAL,
        );
    }
}

/// Show the one-time disclosure notice (once per Windows user account).
fn show_first_run_notice() {
    let marker = match std::env::var("LOCALAPPDATA") {
        Ok(p) => std::path::PathBuf::from(p)
            .join("RAV")
            .join(".monitoring_notice_shown"),
        Err(_) => return,
    };
    if marker.exists() {
        return;
    }
    message_box(FIRST_RUN_TITLE, FIRST_RUN_BODY);
    if let Some(parent) = marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&marker, b"shown");
}

unsafe extern "system" fn wndproc(
    hwnd: HWND,
    msg: UINT,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_TRAYICON => {
            let event = (lparam & 0xFFFF) as UINT;
            if event == WM_RBUTTONUP || event == WM_LBUTTONUP {
                show_tray_menu(hwnd);
            }
            0
        }
        WM_COMMAND => {
            let id = (wparam & 0xFFFF) as u16;
            if id == ID_TRAY_ABOUT {
                message_box(ABOUT_TITLE, ABOUT_BODY);
            }
            0
        }
        WM_DESTROY => {
            let mut nid = base_nid(hwnd);
            Shell_NotifyIconW(NIM_DELETE, &mut nid);
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe fn show_tray_menu(hwnd: HWND) {
    let menu = CreatePopupMenu();
    if menu.is_null() {
        return;
    }
    // Only an informational item — there is intentionally no "hide"/"disable".
    let label = to_wide("About this monitoring...");
    AppendMenuW(menu, MF_STRING, ID_TRAY_ABOUT as usize, label.as_ptr());

    let mut pt = POINT { x: 0, y: 0 };
    GetCursorPos(&mut pt);
    // Required so the menu dismisses correctly when the user clicks elsewhere.
    SetForegroundWindow(hwnd);
    TrackPopupMenu(
        menu,
        TPM_RIGHTBUTTON | TPM_BOTTOMALIGN,
        pt.x,
        pt.y,
        0,
        hwnd,
        std::ptr::null_mut(),
    );
    DestroyMenu(menu);
}

/// Create the tray indicator and run its message loop. Blocks the calling
/// thread, so call it on a dedicated thread.
pub fn run_indicator() {
    unsafe {
        let hinstance = GetModuleHandleW(std::ptr::null());
        let class_name = to_wide("RavMonitoringIndicator");

        let mut wc: WNDCLASSEXW = std::mem::zeroed();
        wc.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
        wc.lpfnWndProc = Some(wndproc);
        wc.hInstance = hinstance;
        wc.lpszClassName = class_name.as_ptr();
        if RegisterClassExW(&wc) == 0 {
            warn!("Indicator: RegisterClassExW failed; monitoring tray icon not shown");
            return;
        }

        let window_name = to_wide("RAV Monitoring Indicator");
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            window_name.as_ptr(),
            0, // not visible; hosts the tray icon + message loop only
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null_mut(),
        );
        if hwnd.is_null() {
            warn!("Indicator: CreateWindowExW failed; monitoring tray icon not shown");
            return;
        }
        HWND_PTR.store(hwnd as usize, Ordering::SeqCst);

        // Add the tray icon: a shield (signifies security/monitoring) + tooltip.
        let mut nid = base_nid(hwnd);
        nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
        nid.uCallbackMessage = WM_TRAYICON;
        nid.hIcon = LoadIconW(std::ptr::null_mut(), IDI_SHIELD);
        fill_tip(&mut nid, TIP_DEFAULT);
        if Shell_NotifyIconW(NIM_ADD, &mut nid) == 0 {
            warn!("Indicator: Shell_NotifyIcon NIM_ADD failed; monitoring tray icon not shown");
            // Keep going anyway — the first-run notice below still discloses monitoring.
        } else {
            info!("Indicator: monitoring tray icon active in user session");
        }

        // One-time disclosure notice for this user.
        show_first_run_notice();

        // Message loop.
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
