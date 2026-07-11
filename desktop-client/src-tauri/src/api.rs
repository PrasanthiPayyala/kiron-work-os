// HTTP client + typed wire bindings for the Kiron backend.
//
// Session 3 shipped /auth/login. Session 4 adds the endpoints the
// tracker needs: /auth/refresh, /attendance (POST + PATCH),
// /attendance/heartbeat, /attendance/idle-intervals, and a small
// helper to look up "did I already check in today?" so the auto
// check-in doesn't double-post.
//
// All authenticated calls go through `AuthedClient` which owns the
// bearer + refresh tokens and transparently retries once on a 401 by
// asking the backend for a fresh access token. On persistent 401 (bad
// refresh) the caller gets `ApiError::AuthRefreshFailed` and should
// prompt the user to sign in again.

use anyhow::Context;
use chrono::{DateTime, Utc};
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::keychain;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad credentials")]
    Unauthorized,
    #[error("refresh token rejected — sign-in required")]
    AuthRefreshFailed,
    #[error("network error: {0}")]
    Network(String),
    #[error("backend error {status}: {message}")]
    Backend { status: u16, message: String },
}

impl From<reqwest::Error> for ApiError {
    fn from(e: reqwest::Error) -> Self {
        ApiError::Network(e.to_string())
    }
}

// ---------- Login (unauth) ----------

#[derive(Debug, Serialize)]
pub struct LoginRequest<'a> {
    pub email: &'a str,
    pub password: &'a str,
}

#[derive(Debug, Deserialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: String,
}

pub async fn login(api_base: &str, req: LoginRequest<'_>) -> Result<LoginResponse, ApiError> {
    let url = format!("{}/auth/login", api_base.trim_end_matches('/'));
    let client = base_client()?;
    let res = client.post(&url).json(&req).send().await?;
    handle_json_response(res).await
}

// ---------- Refresh (unauth per request but uses refresh token) ----------

#[derive(Debug, Serialize)]
struct RefreshRequest<'a> {
    refresh_token: &'a str,
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: String,
}

/// Called by `AuthedClient` on 401. Not part of the public API.
async fn refresh(api_base: &str, refresh_token: &str) -> Result<String, ApiError> {
    let url = format!("{}/auth/refresh", api_base.trim_end_matches('/'));
    let client = base_client()?;
    let res = client
        .post(&url)
        .json(&RefreshRequest { refresh_token })
        .send()
        .await?;
    if res.status() == StatusCode::UNAUTHORIZED {
        return Err(ApiError::AuthRefreshFailed);
    }
    let out: RefreshResponse = handle_json_response(res).await?;
    Ok(out.access_token)
}

// ---------- Attendance ----------

/// Payload for POST /attendance. Only the fields the desktop agent
/// needs — the backend's Pydantic model accepts many more but we set
/// what's relevant to auto-check-in and let the rest default.
#[derive(Debug, Serialize)]
pub struct CheckInRequest<'a> {
    pub work_date: String,     // YYYY-MM-DD (IST)
    pub check_in_at: String,   // ISO 8601 with tz
    pub status: &'a str,       // "present" — always for desktop agent
    pub source: &'a str,       // "desktop_agent"
    pub device_id: &'a str,
    pub client_version: &'a str,
    pub hostname: &'a str,
}

/// Response fields we actually use from POST /attendance and
/// GET /attendance/logs. Backend returns many more columns; we ignore.
#[derive(Debug, Deserialize, Clone)]
pub struct AttendanceLog {
    pub id: String,
    pub work_date: String,
    pub source: Option<String>,
    pub check_in_at: Option<String>,
    pub check_out_at: Option<String>,
    pub last_heartbeat_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CheckOutPatch {
    pub check_out_at: String,
}

#[derive(Debug, Serialize)]
pub struct HeartbeatRequest<'a> {
    pub device_id: &'a str,
    pub client_version: &'a str,
}

#[derive(Debug, Serialize)]
pub struct IdleIntervalRequest {
    pub started_at: String, // ISO 8601 UTC
    pub ended_at: String,   // ISO 8601 UTC
    pub source: String,     // always "idle" from the desktop agent
}

// ---------- Authed client ----------

/// A reqwest client wired to a set of tokens. Owns the refresh
/// contract with the backend + persists updated access tokens back to
/// the OS keychain so a restart picks up where we left off.
#[derive(Clone)]
pub struct AuthedClient {
    api_base: String,
    client: Client,
    // Refresh may race with a heartbeat happening concurrently. Wrap
    // tokens in a Mutex so only one refresh runs at a time.
    tokens: Arc<Mutex<Tokens>>,
}

struct Tokens {
    access: String,
    refresh: String,
    user_id: String,
}

impl AuthedClient {
    pub fn from_session(api_base: String, session: keychain::Session) -> anyhow::Result<Self> {
        Ok(Self {
            api_base,
            client: base_client()?,
            tokens: Arc::new(Mutex::new(Tokens {
                access: session.access_token,
                refresh: session.refresh_token,
                user_id: session.user_id,
            })),
        })
    }

    pub async fn user_id(&self) -> String {
        self.tokens.lock().await.user_id.clone()
    }

    /// GET /attendance/mine/today — returns the caller's own today
    /// row (or null). Backend endpoint dedicated to the desktop
    /// agent's start-up check: "did I already check in today, or do I
    /// need to auto-post?"
    pub async fn get_todays_log(&self) -> Result<Option<AttendanceLog>, ApiError> {
        let res = self
            .send_json(Method::GET, "/attendance/mine/today", None::<&()>)
            .await?;
        // Server returns null when there's no row — reqwest json()
        // parses that into Option::None cleanly.
        res.json::<Option<AttendanceLog>>()
            .await
            .map_err(|e| ApiError::Backend {
                status: 200,
                message: format!("malformed today response: {e}"),
            })
    }

    /// POST /attendance — auto check-in for the desktop agent.
    pub async fn check_in(&self, req: CheckInRequest<'_>) -> Result<AttendanceLog, ApiError> {
        let res = self.send_json(Method::POST, "/attendance", Some(&req)).await?;
        res.json().await.map_err(|e| ApiError::Backend {
            status: 200,
            message: format!("malformed check-in response: {e}"),
        })
    }

    /// PATCH /attendance/{id} — set check_out_at.
    pub async fn check_out(
        &self,
        log_id: &str,
        checked_out_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        let path = format!("/attendance/{}", log_id);
        let body = CheckOutPatch {
            check_out_at: checked_out_at.to_rfc3339(),
        };
        self.send_json(Method::PATCH, &path, Some(&body)).await?;
        Ok(())
    }

    /// POST /attendance/heartbeat — 204, no body.
    pub async fn heartbeat(&self, req: HeartbeatRequest<'_>) -> Result<(), ApiError> {
        self.send_json(Method::POST, "/attendance/heartbeat", Some(&req))
            .await?;
        Ok(())
    }

    /// POST /attendance/idle-intervals — logs a detected idle window.
    /// Server dedups by (user_id, started_at); safe to retry.
    pub async fn idle_interval(&self, req: IdleIntervalRequest) -> Result<(), ApiError> {
        self.send_json(Method::POST, "/attendance/idle-intervals", Some(&req))
            .await?;
        Ok(())
    }

    // ---- internals ----

    /// Sends a JSON request. On 401, attempts one refresh + retry.
    /// On refresh failure surfaces `AuthRefreshFailed` so the caller
    /// can prompt sign-in.
    async fn send_json<T: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        body: Option<&T>,
    ) -> Result<Response, ApiError> {
        let attempt = |access: String| {
            let url = format!("{}{}", self.api_base.trim_end_matches('/'), path);
            let mut req: RequestBuilder = self
                .client
                .request(method.clone(), &url)
                .bearer_auth(&access);
            if let Some(b) = body {
                req = req.json(b);
            }
            async move { req.send().await }
        };

        // 1st attempt with current access token.
        let access1 = self.tokens.lock().await.access.clone();
        let res = attempt(access1).await?;
        if res.status() != StatusCode::UNAUTHORIZED {
            return check_ok(res).await;
        }

        // 401 — refresh + retry once.
        let refresh_token = self.tokens.lock().await.refresh.clone();
        let new_access = refresh(&self.api_base, &refresh_token).await?;
        {
            let mut guard = self.tokens.lock().await;
            guard.access = new_access.clone();
            // Persist the new access token so a restart doesn't have to
            // refresh again. Refresh token itself doesn't change.
            let _ = keychain::store(&keychain::Session {
                access_token: new_access.clone(),
                refresh_token: guard.refresh.clone(),
                user_id: guard.user_id.clone(),
            });
        }
        let res = attempt(new_access).await?;
        check_ok(res).await
    }
}

// ---------- helpers ----------

fn base_client() -> Result<Client, ApiError> {
    Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(format!(
            "KironPresence/{} ({})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS
        ))
        .build()
        .map_err(ApiError::from)
}

async fn check_ok(res: Response) -> Result<Response, ApiError> {
    let status = res.status();
    if status.is_success() {
        return Ok(res);
    }
    if status == StatusCode::UNAUTHORIZED {
        return Err(ApiError::Unauthorized);
    }
    let body = res.text().await.unwrap_or_default();
    Err(ApiError::Backend {
        status: status.as_u16(),
        message: extract_detail(&body).unwrap_or_else(|| body.chars().take(200).collect()),
    })
}

async fn handle_json_response<T: for<'de> Deserialize<'de>>(res: Response) -> Result<T, ApiError> {
    let res = check_ok(res).await?;
    let status = res.status().as_u16();
    res.json::<T>().await.map_err(|e| ApiError::Backend {
        status,
        message: format!("malformed response: {e}"),
    })
}

fn extract_detail(body: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct D {
        detail: serde_json::Value,
    }
    serde_json::from_str::<D>(body).ok().and_then(|d| match d.detail {
        serde_json::Value::String(s) => Some(s),
        other => Some(other.to_string()),
    })
}

pub use anyhow::Context as AnyhowContext;
