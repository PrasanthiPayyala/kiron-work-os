// Tauri commands invoked from the sign-in webview via
// `@tauri-apps/api/core`'s `invoke()`. Each returns a Result whose Err
// branch surfaces to the JS side as a rejected Promise with a
// plain-string error message.
//
// Session 3 defines three:
//   sign_in         — POST /auth/login, persist tokens to keychain
//   sign_out        — clear keychain
//   current_session — is anyone signed in? used to auto-skip the
//                      sign-in form on subsequent launches
//
// Session 4 will add commands for check_in / heartbeat / status.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::api;
use crate::config;
use crate::keychain;

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
            api::ApiError::Network(msg) => format!("Can't reach Kiron Work OS: {msg}"),
            api::ApiError::Backend { status, message } => {
                format!("Server error {status}: {message}")
            }
        })?;

    keychain::store(&keychain::Session {
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        user_id: res.user_id.clone(),
    })
    .map_err(|e| format!("Signed in but couldn't save to keychain: {e}"))?;

    log::info!(
        "[sign_in] user_id={} via {}",
        res.user_id,
        cfg.api_base
    );

    Ok(SignInResult {
        user_id: res.user_id,
        email: payload.email,
    })
}

// ---------- sign_out ----------

#[tauri::command]
pub async fn sign_out() -> Result<(), String> {
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
