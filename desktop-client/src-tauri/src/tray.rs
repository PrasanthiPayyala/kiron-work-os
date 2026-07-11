// Tray icon — sits in the system tray, gives the user a status glance
// + a menu with "Show status", "Check out now", "Sign out", "Quit".
//
// Session 5 additions:
//   - Per-state icons (green/amber/grey) loaded via include_bytes! at
//     compile time. Source: src-tauri/icons/tray-{active,idle,offline}.png
//     generated from icons/svg/tray-*.svg (see icons/README.md).
//   - A background task in `spawn_status_updater` reads the tracker
//     status every 15s and swaps the tray icon accordingly.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const ID_SHOW: &str = "show_status";
const ID_CHECK_OUT: &str = "check_out";
const ID_SIGN_OUT: &str = "sign_out";
const ID_QUIT: &str = "quit";

const TRAY_ID: &str = "kiron-presence";

// Baked-in icon bytes. Fails to build if the PNGs are missing — that's
// intentional; distribution without icons is a bug.
#[cfg(not(debug_assertions))]
const ICON_ACTIVE: &[u8] = include_bytes!("../icons/tray-active.png");
#[cfg(not(debug_assertions))]
const ICON_IDLE: &[u8] = include_bytes!("../icons/tray-idle.png");
#[cfg(not(debug_assertions))]
const ICON_OFFLINE: &[u8] = include_bytes!("../icons/tray-offline.png");

// In dev builds, the tray icons may not have been rasterized yet — fall
// back to include_bytes!() with the option_env approach guarded on file
// existence via optional inclusion. Simpler: reuse the app icon in dev.
#[cfg(debug_assertions)]
const ICON_ACTIVE: &[u8] = include_bytes!("../icons/icon.ico");
#[cfg(debug_assertions)]
const ICON_IDLE: &[u8] = include_bytes!("../icons/icon.ico");
#[cfg(debug_assertions)]
const ICON_OFFLINE: &[u8] = include_bytes!("../icons/icon.ico");

/// Visual state the tray icon reflects. Not the same enum as the
/// tracker's internal state — it's derived from `Status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Active,
    Idle,
    Offline,
}

impl TrayState {
    fn image(self) -> tauri::Result<Image<'static>> {
        let bytes = match self {
            TrayState::Active => ICON_ACTIVE,
            TrayState::Idle => ICON_IDLE,
            TrayState::Offline => ICON_OFFLINE,
        };
        Image::from_bytes(bytes)
    }

    fn tooltip(self) -> &'static str {
        match self {
            TrayState::Active => "Kiron Presence — tracking",
            TrayState::Idle => "Kiron Presence — idle",
            TrayState::Offline => "Kiron Presence — signed out",
        }
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, ID_SHOW, "Show status", true, None::<&str>)?;
    let check_out = MenuItem::with_id(app, ID_CHECK_OUT, "Check out now", true, None::<&str>)?;
    let sign_out = MenuItem::with_id(app, ID_SIGN_OUT, "Sign out", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &check_out, &sign_out, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(TrayState::Offline.image()?)
        .tooltip(TrayState::Offline.tooltip())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            ID_SHOW => show_status_window(app),
            ID_CHECK_OUT => request_check_out(app),
            ID_SIGN_OUT => request_sign_out(app),
            ID_QUIT => {
                request_check_out(app);
                app.exit(0);
            }
            other => log::warn!("[tray] unhandled menu id: {}", other),
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                show_status_window(tray.app_handle());
            }
        })
        .build(app)?;

    // Background updater — polls the tracker every 15s and swaps the
    // icon if the state changed.
    spawn_status_updater(app.clone());

    Ok(())
}

fn spawn_status_updater(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut current = TrayState::Offline;
        loop {
            let next = derive_state(&app).await;
            if next != current {
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    apply(&tray, next);
                }
                current = next;
            }
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });
}

async fn derive_state(app: &AppHandle) -> TrayState {
    let Some(handle) = app.try_state::<crate::tracker::TrackerHandle>() else {
        return TrayState::Offline;
    };
    let snap = handle.inner().snapshot().await;
    if !snap.signed_in {
        return TrayState::Offline;
    }
    if snap.is_idle {
        return TrayState::Idle;
    }
    TrayState::Active
}

fn apply(tray: &TrayIcon, state: TrayState) {
    match state.image() {
        Ok(img) => {
            if let Err(e) = tray.set_icon(Some(img)) {
                log::warn!("[tray] set_icon failed: {e}");
            }
        }
        Err(e) => log::warn!("[tray] loading icon for {state:?} failed: {e}"),
    }
    if let Err(e) = tray.set_tooltip(Some(state.tooltip())) {
        log::warn!("[tray] set_tooltip failed: {e}");
    }
}

fn show_status_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("signin") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn request_check_out(app: &AppHandle) {
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
    request_check_out(app);
    if let Err(e) = crate::keychain::clear() {
        log::warn!("[tray] keychain clear failed: {e}");
    }
    show_status_window(app);
}
