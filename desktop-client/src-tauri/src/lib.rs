// Kiron Presence Client — library entry point.
//
// Session 3 shipped: sign-in webview + OS keychain storage.
// Session 4 adds: activity poller, idle detection, heartbeat loop,
// auto check-in / check-out, tray icon, auto-launch registration.
//
// Module layout:
//   config     — where the backend lives, device_id, minimal persistent state
//   keychain   — access + refresh token storage via OS keychain
//   api        — HTTP client + typed request/response bindings
//   activity   — cross-platform "seconds since last input" reader
//   tracker    — the state machine + tokio loops
//   tray       — system tray icon + menu
//   commands   — Tauri commands the webview invokes
//
// On startup:
//   1. Init the config store (creates a device_id on first launch).
//   2. Register autostart so the agent runs at every login.
//   3. Build the tray icon.
//   4. If the keychain already has a session, spawn the tracker — the
//      sign-in window is skipped (JS-side check on `current_session`).
//   5. On ExitRequested (user quits from tray), fire best-effort
//      check-out then exit.

mod activity;
mod api;
mod commands;
mod config;
mod keychain;
mod tracker;
mod tray;

use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            // No args — the agent doesn't accept flags. Empty vec is
            // interpreted as "run the binary as-is".
            Some(vec![]),
        ))
        .setup(|app| {
            let handle = app.handle().clone();

            if let Err(e) = config::init(&handle) {
                log::warn!("[startup] config init failed: {e} — using in-memory defaults");
            }

            // Register autostart on every launch — idempotent. If the
            // user disabled it via their OS settings, we don't force
            // it back on (the plugin respects the user's choice).
            if let Ok(autostart) = handle.plugin_manager().is_plugin_registered("autostart") {
                log::debug!("[startup] autostart plugin registered = {autostart}");
            }
            // The autostart plugin's `enable()` is available via the
            // AutoLaunchManager exposed through `handle.autolaunch()`;
            // we call it here so first-time installs opt in silently.
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            {
                use tauri_plugin_autostart::ManagerExt;
                if let Err(e) = handle.autolaunch().enable() {
                    log::warn!("[startup] autolaunch enable failed: {e}");
                }
            }

            // Tray — always present, even if the user is signed out
            // (right-click → Sign in re-shows the window).
            if let Err(e) = tray::init(&handle) {
                log::warn!("[startup] tray init failed: {e}");
            }

            // If we already have a session, spawn the tracker now so
            // we don't wait for the user to click something.
            let boot_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                commands::start_tracking_from_keychain(boot_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sign_in,
            commands::sign_out,
            commands::current_session,
            commands::get_status,
            commands::hide_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kiron Presence Client");

    app.run(|app_handle, event| {
        // On any user-driven exit, fire a best-effort check-out. The
        // backend's auto-close scheduler covers hard crashes we can't
        // hook — that's the safety net.
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(handle) = app_handle.try_state::<tracker::TrackerHandle>() {
                let handle = handle.inner().clone();
                // Block briefly so the PATCH lands before the process dies.
                let _ = tauri::async_runtime::block_on(async {
                    handle.check_out_now().await
                });
            }
        }
    });
}
