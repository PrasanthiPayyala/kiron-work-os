// The tracker — long-running background task that owns the presence
// state machine.
//
// Design: activity-poll-driven, no OS message hooks. Every SAMPLE_INTERVAL
// we read `activity::seconds_since_last_input()` and update state. State
// transitions drive the API calls. This is deliberately simpler than
// hooking WM_WTSSESSION_CHANGE + NSWorkspace notifications — polling is
// dead-reliable across sleep/wake/lock/RDP, doesn't require a hidden
// message-pump window, and the backend's auto-close scheduler is our
// safety net for edge cases we miss.
//
// State model:
//   Active  — < IDLE_THRESHOLD since last input
//   Idle    — >= IDLE_THRESHOLD but user still around (screen unlocked,
//             maybe reading). We track this to compute the idle-interval
//             end when they come back.
//
// Transitions:
//   * On the first Active tick of the day (or first Active tick after
//     >= UNLOCK_GAP of no ticks), attempt auto check-in.
//   * Idle → Active: if the gap is >= IDLE_THRESHOLD, POST an
//     idle-interval covering the away window.
//   * Every HEARTBEAT_INTERVAL while Active: POST /attendance/heartbeat.
//   * On app exit (Tauri RunEvent::ExitRequested): PATCH check-out.
//     Backend auto-close scheduler closes anything we miss after 45 min
//     of no heartbeat, so a hard crash still gets closed correctly.

use anyhow::Result;
use chrono::{DateTime, FixedOffset, Utc};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, RwLock};

use crate::activity;
use crate::api::{
    self, AttendanceLog, AuthedClient, CheckInRequest, HeartbeatRequest, IdleIntervalRequest,
};
use crate::config::{AppConfig, CLIENT_VERSION};

// ---- Timings ----

/// How often we poll the OS for last-input time. Cheap on both
/// platforms (single syscall). Smaller = tighter idle detection but
/// wastes wakeups. 30s matches the PWA's useIdleDetector cadence.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(30);

/// Idle threshold — sustained inactivity beyond this counts as "away"
/// and triggers an idle-interval POST when the user comes back. 30 min
/// matches the backend's `INSERT INTO idle_intervals` semantics and
/// keeps parity with the web PWA.
const IDLE_THRESHOLD: Duration = Duration::from_secs(30 * 60);

/// Gap between activity ticks after which we treat the next Active tick
/// as a fresh "unlock" — worth re-checking whether we need to auto-
/// check-in. 45 min lines up with the backend auto-close so we don't
/// duplicate rows if the scheduler already closed the previous one.
const UNLOCK_GAP: Duration = Duration::from_secs(45 * 60);

/// Heartbeat cadence. Backend expects ~5 min; the auto-close job fires
/// after 45 min of no heartbeat, so 5 min leaves ample slack for one
/// missed post during a network hiccup.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// IST — check-in dates are IST-anchored to match the backend + the
/// PWA. Attendance is a per-day accounting concept; UTC would put IST
/// evenings on the wrong calendar day.
fn ist() -> FixedOffset {
    // 5h30 offset. Never DST in India; hard-code.
    FixedOffset::east_opt(5 * 3600 + 30 * 60).expect("IST offset is valid")
}

/// Public snapshot of the tracker's state — surfaced via `get_status`
/// to the sign-in webview and eventually the tray popup.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Status {
    pub signed_in: bool,
    pub checked_in: bool,
    pub is_idle: bool,
    /// Local check-in time as ISO 8601 (with tz), or null.
    pub check_in_at: Option<String>,
    /// Human string like "6h 12m" — computed for the popup.
    pub active_duration_label: Option<String>,
    /// True when we've queued at least one heartbeat since check-in.
    pub last_heartbeat_at: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            signed_in: false,
            checked_in: false,
            is_idle: false,
            check_in_at: None,
            active_duration_label: None,
            last_heartbeat_at: None,
        }
    }
}

/// Handle the sign-in webview and tray hold to get read-only access to
/// the current state + request an early check-out.
#[derive(Clone)]
pub struct TrackerHandle {
    status: Arc<RwLock<Status>>,
    shutdown_tx: watch::Sender<bool>,
    client: AuthedClient,
    config: AppConfig,
    current_log: Arc<RwLock<Option<AttendanceLog>>>,
}

impl TrackerHandle {
    pub async fn snapshot(&self) -> Status {
        self.status.read().await.clone()
    }

    /// Request an immediate check-out (e.g. user picked "Check out" from
    /// the tray menu, or the app is exiting). Idempotent.
    pub async fn check_out_now(&self) -> Result<()> {
        let log = { self.current_log.read().await.clone() };
        if let Some(l) = log {
            let now = Utc::now();
            if let Err(e) = self.client.check_out(&l.id, now).await {
                log::warn!("[tracker] check_out failed: {e}");
            } else {
                log::info!("[tracker] checked out {}", l.id);
                let mut status = self.status.write().await;
                status.checked_in = false;
            }
        }
        // Signal the loop to stop.
        let _ = self.shutdown_tx.send(true);
        Ok(())
    }
}

/// Spawn the tracker task on the tokio runtime + return a handle.
pub fn spawn(client: AuthedClient, config: AppConfig) -> TrackerHandle {
    let status = Arc::new(RwLock::new(Status {
        signed_in: true,
        ..Default::default()
    }));
    let current_log = Arc::new(RwLock::new(None));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let handle = TrackerHandle {
        status: status.clone(),
        shutdown_tx,
        client: client.clone(),
        config: config.clone(),
        current_log: current_log.clone(),
    };

    tokio::spawn(run_loop(
        client,
        config,
        status,
        current_log,
        shutdown_rx,
    ));

    handle
}

async fn run_loop(
    client: AuthedClient,
    config: AppConfig,
    status: Arc<RwLock<Status>>,
    current_log: Arc<RwLock<Option<AttendanceLog>>>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    log::info!("[tracker] loop starting");

    // Bootstrap: if we already have today's row on the server (agent
    // restarted mid-day, or PWA already checked in), pick it up so
    // we don't double-post.
    match client.get_todays_log().await {
        Ok(Some(log)) => {
            log::info!("[tracker] resuming today's row {}", log.id);
            *current_log.write().await = Some(log.clone());
            let mut s = status.write().await;
            s.checked_in = log.check_out_at.is_none();
            s.check_in_at = log.check_in_at.clone();
        }
        Ok(None) => {
            log::info!("[tracker] no row for today yet — will check in on first Active tick");
        }
        Err(e) => {
            log::warn!("[tracker] startup mine/today failed: {e}");
            if matches!(e, api::ApiError::AuthRefreshFailed) {
                // Bail — the caller needs to prompt sign-in.
                let mut s = status.write().await;
                s.signed_in = false;
                return;
            }
        }
    }

    let mut last_active: Option<DateTime<Utc>> = None;
    let mut last_heartbeat: Option<DateTime<Utc>> = None;
    let mut interval = tokio::time::interval(SAMPLE_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = interval.tick() => {}
            changed = shutdown_rx.changed() => {
                if changed.is_ok() && *shutdown_rx.borrow() {
                    log::info!("[tracker] loop stopping");
                    return;
                }
            }
        }

        let idle = activity::seconds_since_last_input();
        let now = Utc::now();
        let is_active = idle < IDLE_THRESHOLD;

        // ---- Idle-interval detection ----
        //
        // If the user just came back from a long absence, POST an idle
        // interval covering the gap. We compare the OS-reported idle
        // duration to IDLE_THRESHOLD, not to `last_active`, so that if
        // the machine was asleep (during which `last_active` didn't
        // advance either) we still capture the away window correctly.
        if is_active {
            if let Some(last) = last_active {
                let gap = now.signed_duration_since(last);
                if gap.num_seconds() >= IDLE_THRESHOLD.as_secs() as i64 {
                    let req = IdleIntervalRequest {
                        started_at: last.to_rfc3339(),
                        ended_at: now.to_rfc3339(),
                        source: "idle".to_string(),
                    };
                    if let Err(e) = client.idle_interval(req).await {
                        log::warn!("[tracker] idle_interval POST failed: {e}");
                    } else {
                        log::info!("[tracker] idle interval {}s posted", gap.num_seconds());
                    }
                }
                // Treat a very long gap as a fresh unlock — re-check
                // whether we need to auto-post a new attendance row
                // (e.g. laptop was closed overnight and we're a fresh
                // morning).
                if gap.num_seconds() >= UNLOCK_GAP.as_secs() as i64 {
                    if let Err(e) = ensure_checked_in(&client, &config, &current_log, &status).await {
                        log::warn!("[tracker] auto check-in on unlock failed: {e}");
                    }
                }
            } else {
                // First Active tick of this process lifetime — check in
                // if we don't already have a row.
                if let Err(e) = ensure_checked_in(&client, &config, &current_log, &status).await {
                    log::warn!("[tracker] initial auto check-in failed: {e}");
                }
            }
            last_active = Some(now);
        }

        // ---- Heartbeat ----
        //
        // Only heartbeat while Active. If we're Idle, skip the ping so
        // the backend auto-close scheduler eventually closes the row
        // at last_heartbeat_at + 45 min — which is what we want if the
        // employee closed the lid and left.
        let should_heartbeat = is_active
            && last_heartbeat
                .map(|last| now.signed_duration_since(last) >= chrono::Duration::from_std(HEARTBEAT_INTERVAL).unwrap_or_default())
                .unwrap_or(true);

        if should_heartbeat {
            let req = HeartbeatRequest {
                device_id: &config.device_id,
                client_version: CLIENT_VERSION,
            };
            match client.heartbeat(req).await {
                Ok(()) => {
                    last_heartbeat = Some(now);
                    let mut s = status.write().await;
                    s.last_heartbeat_at = Some(now.to_rfc3339());
                }
                Err(api::ApiError::AuthRefreshFailed) => {
                    log::warn!("[tracker] heartbeat: refresh rejected — signing out");
                    let mut s = status.write().await;
                    s.signed_in = false;
                    return;
                }
                Err(e) => log::warn!("[tracker] heartbeat failed: {e}"),
            }
        }

        // ---- Public state snapshot for the tray / webview ----
        {
            let mut s = status.write().await;
            s.is_idle = !is_active;
            if let Some(log) = current_log.read().await.as_ref() {
                if let Some(ci) = &log.check_in_at {
                    if let Ok(started) = DateTime::parse_from_rfc3339(ci) {
                        let mins = now
                            .signed_duration_since(started.with_timezone(&Utc))
                            .num_minutes()
                            .max(0);
                        s.active_duration_label = Some(format!("{}h {}m", mins / 60, mins % 60));
                    }
                }
            }
        }
    }
}

/// Idempotent auto check-in. If the server already knows about today's
/// row (either we just posted it or the PWA did), leaves it alone.
/// Otherwise POSTs a fresh /attendance with `source='desktop_agent'`.
async fn ensure_checked_in(
    client: &AuthedClient,
    config: &AppConfig,
    current_log: &Arc<RwLock<Option<AttendanceLog>>>,
    status: &Arc<RwLock<Status>>,
) -> Result<(), api::ApiError> {
    // Refresh from server in case another client (or the PWA) posted
    // a row while we were away.
    let server = client.get_todays_log().await?;
    if let Some(existing) = server {
        // If it's already closed, we don't reopen it — the user
        // explicitly checked out earlier. Wait for the next real
        // day (i.e. IST date-rollover-triggered UNLOCK_GAP).
        *current_log.write().await = Some(existing.clone());
        let mut s = status.write().await;
        s.checked_in = existing.check_out_at.is_none();
        s.check_in_at = existing.check_in_at.clone();
        return Ok(());
    }

    let now_utc = Utc::now();
    let now_ist = now_utc.with_timezone(&ist());
    let hostname = gethostname::gethostname().to_string_lossy().into_owned();
    let req = CheckInRequest {
        work_date: now_ist.format("%Y-%m-%d").to_string(),
        check_in_at: now_utc.to_rfc3339(),
        status: "present",
        source: "desktop_agent",
        device_id: &config.device_id,
        client_version: CLIENT_VERSION,
        hostname: &hostname,
    };
    let log = client.check_in(req).await?;
    log::info!("[tracker] auto check-in posted, log_id={}", log.id);
    {
        let mut s = status.write().await;
        s.checked_in = true;
        s.check_in_at = log.check_in_at.clone();
    }
    *current_log.write().await = Some(log);
    Ok(())
}
