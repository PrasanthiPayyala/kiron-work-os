// Auto-update — fetches https://crm.innomaxsol.com/desktop/latest.json
// on boot + every 4 hours, verifies the payload signature against the
// ed25519 pubkey baked into tauri.conf.json, and applies the update if
// one is available.
//
// On Windows: passive MSI install — the installer runs silently, the
// user sees a brief flash, the app restarts.
// On macOS: in-place bundle swap — Tauri handles the pkg/dmg copy.
//
// Failures are non-fatal: a network hiccup or malformed manifest just
// logs a warning and we try again next tick. The tracker keeps
// running throughout.

use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

/// How often we poll for updates after the boot check. 4h means an
/// updated build ships to a live machine within one work session
/// without hammering the manifest endpoint.
const CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

/// Spawn the background updater loop. Idempotent — call once from
/// `lib.rs::setup`.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Small delay so the sign-in window paints first — a modal
        // "update installing" dance during login would be jarring.
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            check_once(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn check_once(app: &AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("[updater] plugin not available: {e}");
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            log::info!(
                "[updater] update available: {} -> {}",
                update.current_version,
                update.version
            );
            // Download + install. On Windows this launches the passive
            // MSI installer; on macOS it swaps the app bundle in place.
            // Both paths restart the app when done.
            let mut downloaded_bytes = 0usize;
            let result = update
                .download_and_install(
                    |chunk_len, _content_len| {
                        downloaded_bytes += chunk_len;
                    },
                    || {
                        log::info!("[updater] download complete, applying");
                    },
                )
                .await;
            match result {
                Ok(()) => {
                    log::info!("[updater] applied — exiting to restart");
                    // Fire best-effort check-out before we die so the
                    // day's row doesn't dangle. The tracker handle
                    // lives in managed state.
                    if let Some(handle) = app.try_state::<crate::tracker::TrackerHandle>() {
                        let handle = handle.inner().clone();
                        let _ = tauri::async_runtime::block_on(handle.check_out_now());
                    }
                    app.restart();
                }
                Err(e) => log::warn!("[updater] install failed: {e}"),
            }
        }
        Ok(None) => log::debug!("[updater] no update available"),
        Err(e) => log::warn!("[updater] check failed: {e}"),
    }
}
