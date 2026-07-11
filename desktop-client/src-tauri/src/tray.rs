// Tray icon — sits in the system tray, gives the user a status glance
// + a menu with "Show status window" and "Sign out". We deliberately
// don't reflect live activity (green/yellow/gray) with dynamic icon
// swaps in Session 4 — that requires per-state icon assets which land
// in Session 5. For now: static icon + tooltip + menu.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Menu item IDs — kept as constants so the event handler and the
/// builder agree on strings. Any typo here is a UI bug, not a Rust
/// bug, so making them constants surfaces mismatches at compile time.
const ID_SHOW: &str = "show_status";
const ID_CHECK_OUT: &str = "check_out";
const ID_SIGN_OUT: &str = "sign_out";
const ID_QUIT: &str = "quit";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, ID_SHOW, "Show status", true, None::<&str>)?;
    let check_out = MenuItem::with_id(app, ID_CHECK_OUT, "Check out now", true, None::<&str>)?;
    let sign_out = MenuItem::with_id(app, ID_SIGN_OUT, "Sign out", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &check_out, &sign_out, &quit])?;

    TrayIconBuilder::with_id("kiron-presence")
        .tooltip("Kiron Presence — tracking your workday")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            ID_SHOW => show_status_window(app),
            ID_CHECK_OUT => request_check_out(app),
            ID_SIGN_OUT => request_sign_out(app),
            ID_QUIT => {
                // Fire-and-forget check-out on quit — best effort. The
                // backend auto-close scheduler will pick up anything
                // we miss after 45 min.
                request_check_out(app);
                app.exit(0);
            }
            other => log::warn!("[tray] unhandled menu id: {}", other),
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click on the tray icon (all platforms) opens the
            // status window. Right-click opens the menu (handled by
            // the OS automatically).
            if let TrayIconEvent::Click { .. } = event {
                show_status_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_status_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("signin") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn request_check_out(app: &AppHandle) {
    // Handled on the tokio side — pull the TrackerHandle out of app
    // state and fire `.check_out_now()`. Wired up in lib.rs once the
    // tracker is spawned.
    if let Some(handle) = app.try_state::<crate::tracker::TrackerHandle>() {
        let handle = handle.inner().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = handle.check_out_now().await {
                log::warn!("[tray] check_out_now failed: {e}");
            }
        });
    }
}

fn request_sign_out(app: &AppHandle) {
    // Fire check-out first, then wipe the keychain, then re-show the
    // sign-in window so the user knows we heard them.
    request_check_out(app);
    if let Err(e) = crate::keychain::clear() {
        log::warn!("[tray] keychain clear failed: {e}");
    }
    show_status_window(app);
}
