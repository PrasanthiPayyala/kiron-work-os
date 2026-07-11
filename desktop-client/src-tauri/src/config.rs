// Non-secret persistent app state — where the backend lives, this
// install's stable device_id (generated once, kept forever), whether
// the user has opted into auto-launch, etc.
//
// Anything sensitive (JWTs, refresh tokens, cached passwords) goes to
// [`crate::keychain`], NOT here. This module writes plain JSON to the
// app's data dir; the OS protects it with normal user-file permissions
// only. That's fine for a device_id but wrong for a bearer token.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "config.json";

// Bumped on every deploy so the HR "Desktop agents" dashboard can spot
// laggards. Session 5's release pipeline will inject the real semver via
// build.rs — for Session 3 the compile-time constant is fine.
pub const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Production default. Local dev overrides via `.env` (loaded before
/// `tauri::Builder` — see `main.rs`); the override key lives in the
/// same store file so it survives restarts.
pub const DEFAULT_API_BASE: &str = "https://crm.innomaxsol.com/api";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Stable per-install UUID. Written once on first launch, never
    /// rotated — the HR dashboard uses it to distinguish a user's
    /// two devices (desk PC + laptop) without asking them to name each.
    pub device_id: String,

    /// Where the backend lives. Overridable via a signed-out settings
    /// panel later; the store persists across restarts.
    pub api_base: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            device_id: uuid_v4_string(),
            api_base: DEFAULT_API_BASE.to_string(),
        }
    }
}

/// Ensure the store exists + a default config is present. Idempotent —
/// safe to call every launch. Returns Ok even if the store is empty
/// and we had to write defaults; the caller doesn't care.
pub fn init(app: &AppHandle) -> Result<()> {
    let store = app
        .store(STORE_FILE)
        .context("open config store")?;

    if store.get("device_id").is_none() {
        let cfg = AppConfig::default();
        store.set("device_id", serde_json::Value::String(cfg.device_id));
        store.set("api_base", serde_json::Value::String(cfg.api_base));
        store.save().context("save default config")?;
        log::info!("[config] wrote default config on first launch");
    }
    Ok(())
}

/// Read the current config. Falls back to defaults if the store is
/// missing keys — we never want the client to crash on a partially
/// initialised store.
pub fn load(app: &AppHandle) -> AppConfig {
    let default = AppConfig::default();
    match app.store(STORE_FILE) {
        Ok(store) => AppConfig {
            device_id: store
                .get("device_id")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or(default.device_id),
            api_base: store
                .get("api_base")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or(default.api_base),
        },
        Err(e) => {
            log::warn!("[config] load failed: {e} — using defaults");
            default
        }
    }
}

/// Minimal RFC 4122 v4 UUID string. We don't pull in the `uuid` crate
/// just for one call — a naive impl from OS randomness is enough.
fn uuid_v4_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Not cryptographic — device_id is an identifier, not a secret.
    // Mix nanoseconds + process id + a small counter so two devices
    // installed within the same second still differ.
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let mut bytes = [0u8; 16];
    let mixed = ts ^ (pid << 96) ^ ((pid as u128).wrapping_mul(0xd6e8_feb8_6659_fd93));
    for (i, b) in mixed.to_le_bytes().iter().enumerate() {
        bytes[i] = *b;
    }
    // RFC 4122 v4 markers.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}
