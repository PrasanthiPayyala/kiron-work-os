// HTTP client + typed wire bindings for the Kiron backend.
//
// Session 3 scope: /auth/login only. Sessions 4+ add /attendance,
// /attendance/heartbeat, /attendance/idle-intervals, /auth/refresh.
//
// The shared reqwest client is per-call for now — a lazy_static one
// would save handshake cost, but presence traffic is 1 heartbeat every
// 5 minutes so the saving is meaningless. Simpler wins.

use anyhow::{Context, Result};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad credentials")]
    Unauthorized,
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

// --- Login ---

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

/// POST /auth/login. Returns the tokens on 200, `Unauthorized` on 401,
/// `Backend { status, message }` on any other non-2xx.
pub async fn login(api_base: &str, req: LoginRequest<'_>) -> Result<LoginResponse, ApiError> {
    let url = format!("{}/auth/login", api_base.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(ApiError::from)?;
    let res = client.post(&url).json(&req).send().await?;
    let status = res.status();

    if status.is_success() {
        return res
            .json::<LoginResponse>()
            .await
            .map_err(|e| ApiError::Backend {
                status: status.as_u16(),
                message: format!("malformed 200 response: {e}"),
            });
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

/// FastAPI's HTTPException serializes as `{"detail": "…"}` — pull that
/// out for a friendlier surface message.
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

// --- Wire helpers Session 4 will build on ---

/// Compose the standard Bearer auth header value. Kept here so all
/// tokens are formatted identically; callers in later sessions
/// (heartbeat, check-in, idle-intervals) reuse this.
pub fn bearer(access_token: &str) -> String {
    format!("Bearer {}", access_token)
}

/// Placeholder result type reserved for the async callers Session 4
/// will introduce. Kept alongside `ApiError` here so no other module
/// needs to reach for `anyhow` in HTTP paths.
pub type ApiResult<T> = std::result::Result<T, ApiError>;

// Re-export `Context` so command modules can attach human strings
// without pulling anyhow directly.
pub use anyhow::Context as AnyhowContext;
