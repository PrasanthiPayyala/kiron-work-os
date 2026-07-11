// Tauri commands invoked from the sign-in webview via
// `@tauri-apps/api/core`'s `invoke()`. Each returns a Result whose Err
// branch surfaces to the JS side as a rejected Promise with a
// plain-string error message.
//
// Session 3 defined sign_in / sign_out / current_session (identity).
// Session 4 adds get_status (tracker snapshot) + start_tracking (wires
// the tokio loops after a fresh sign-in) + a small hide_window helper
// so the JS can drop the sign-in window into the tray after login.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::api;
use crate::config;
use crate::keychain;
use crate::tracker::{self, Status, TrackerHandle};

// ---------- sign_in ----------

#[derive(Debug, Deserialize)]
pub struct SignInPayload {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct SignInResult {
    pub user_id: String,
    pub email: String,
}

#[tauri::command]
pub async fn sign_in(
    app: AppHandle,
    payload: SignInPayload,
) -> Result<SignInResult, String> {
    let cfg = config::load(&app);
    let req = api::LoginRequest {
        email: payload.email.trim(),
        password: &payload.password,
    };
    let res = api::login(&cfg.api_base, req)
        .await
        .map_err(|e| match e {
            api::ApiError::Unauthorized => "Invalid email or password".to_string(),
            api::ApiError::AuthRefreshFailed => "Session expired — try again".to_string(),
            api::ApiError::Network(msg) => format!("Can't reach Kiron Work OS: {msg}"),
            api::ApiError::Backend { status, message } => {
                format!("Server error {status}: {message}")
            }
        })?;

    let session = keychain::Session {
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        user_id: res.user_id.clone(),
    };
    keychain::store(&session)
        .map_err(|e| format!("Signed in but couldn't save to keychain: {e}"))?;

    log::info!(
        "[sign_in] user_id={} via {}",
        res.user_id,
        cfg.api_base
    );

    // Fresh sign-in → spin up the tracker. Any existing handle from a
    // previous sign-in gets replaced; the old loop will die on the
    // next 401 or when we swap the state entry below.
    start_tracking_inner(app.clone(), session, cfg).await;

    Ok(SignInResult {
        user_id: res.user_id,
        email: payload.email,
    })
}

// ---------- sign_out ----------

#[tauri::command]
pub async fn sign_out(app: AppHandle) -> Result<(), String> {
    // Best-effort check-out first so the day's row doesn't linger open.
    if let Some(handle) = app.try_state::<TrackerHandle>() {
        let handle = handle.inner().clone();
        if let Err(e) = handle.check_out_now().await {
            log::warn!("[sign_out] check_out_now failed: {e}");
        }
    }
    keychain::clear().map_err(|e| format!("Couldn't clear keychain: {e}"))?;
    log::info!("[sign_out] keychain cleared");
    Ok(())
}

// ---------- current_session ----------

#[derive(Debug, Serialize)]
pub struct CurrentSessionResult {
    pub signed_in: bool,
    pub user_id: Option<String>,
}

#[tauri::command]
pub async fn current_session() -> Result<CurrentSessionResult, String> {
    match keychain::load() {
        Ok(Some(s)) => Ok(CurrentSessionResult {
            signed_in: true,
            user_id: Some(s.user_id),
        }),
        Ok(None) => Ok(CurrentSessionResult {
            signed_in: false,
            user_id: None,
        }),
        Err(e) => {
            log::warn!("[current_session] keychain read failed: {e}");
            Ok(CurrentSessionResult {
                signed_in: false,
                user_id: None,
            })
        }
    }
}

// ---------- get_status ----------

#[tauri::command]
pub async fn get_status(app: AppHandle) -> Result<Status, String> {
    if let Some(handle) = app.try_state::<TrackerHandle>() {
        Ok(handle.inner().snapshot().await)
    } else {
        Ok(Status::default())
    }
}

// ---------- hide_window ----------

/// Called by the sign-in JS a moment after successful sign-in so the
/// window drops out of the way and the user only sees the tray icon
/// from then on.
#[tauri::command]
pub fn hide_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("signin") {
        let _ = w.hide();
    }
}

// ---------- start_tracking (called on boot if already signed in) ----------

/// Idempotent — called from lib.rs on app startup if the keychain
/// already has a session. Safe to call again; overwrites the handle in
/// managed state so the old loop dies naturally on the next 401.
pub async fn start_tracking_from_keychain(app: AppHandle) {
    let session = match keychain::load() {
        Ok(Some(s)) => s,
        _ => return, // no session — sign-in flow drives everything
    };
    let cfg = config::load(&app);
    start_tracking_inner(app, session, cfg).await;
}

async fn start_tracking_inner(app: AppHandle, session: keychain::Session, cfg: config::AppConfig) {
    match api::AuthedClient::from_session(cfg.api_base.clone(), session) {
        Ok(client) => {
            let handle = tracker::spawn(client, cfg);
            app.manage(handle);
            log::info!("[commands] tracker started");
        }
        Err(e) => {
            log::warn!("[commands] AuthedClient build failed: {e}");
        }
    }
}
