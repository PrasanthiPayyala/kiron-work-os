// Kiron Presence Client — library entry point.
//
// This crate is intentionally thin at Session 3: sign-in webview,
// POST /auth/login against the Kiron backend, tokens land in the OS
// keychain. NO activity polling, NO tray icon, NO auto check-in yet —
// those arrive in Session 4.
//
// Module layout mirrors the plan file:
//   config     — where the backend lives, device_id, minimal persistent state
//   keychain   — access + refresh token storage via OS keychain
//   api        — HTTP client + typed request/response bindings
//   commands   — Tauri commands the sign-in webview invokes
//
// Session 4 will add `activity`, `session`, `tray` modules alongside these.

mod api;
mod commands;
mod config;
mod keychain;

use tauri::Manager;

/// Bootstraps the Tauri app.
///
/// Called from `main.rs`. Kept public + separate so integration tests
/// (Session 5+) can spin the app up without going through `main`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Ensure the config store exists on disk so subsequent
            // reads never panic on a fresh install. Non-fatal if the
            // OS refuses (e.g. locked-down user profile) — the app
            // falls back to in-memory defaults and warns.
            if let Err(e) = config::init(app.handle()) {
                log::warn!("[startup] config init failed: {e} — using in-memory defaults");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sign_in,
            commands::sign_out,
            commands::current_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kiron Presence Client");
}
