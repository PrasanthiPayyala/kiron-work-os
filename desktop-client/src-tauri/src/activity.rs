// Cross-platform "how long has this machine been idle" reader.
//
// Windows: GetLastInputInfo returns a tick-count. GetTickCount() minus
//   that is the idle time in ms. Wraps every ~49 days — we use
//   saturating_sub so a wrap around midnight of week 7 just clamps to
//   zero instead of underflowing.
//
// macOS: CGEventSource::secondsSinceLastEventType with the sentinel
//   `Null` event type = seconds since any input event.
//
// Linux fallback: 0 (never idle). We don't ship Linux — this exists
//   only so `cargo check --workspace` on a Linux dev box compiles. If
//   we ever ship Linux, add XScreenSaverQueryInfo via x11 crate.
//
// This is a synchronous, allocation-free read on both real platforms;
// the tracker calls it from a tokio timer without blocking anything.

use std::time::Duration;

/// Returns how long since the user last touched keyboard or mouse.
/// Never errors — on unexpected failure returns Duration::ZERO so the
/// caller treats the user as "just active" (safer than "away").
pub fn seconds_since_last_input() -> Duration {
    platform::seconds_since_last_input().unwrap_or(Duration::ZERO)
}

#[cfg(windows)]
mod platform {
    use std::time::Duration;
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    pub fn seconds_since_last_input() -> Option<Duration> {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // SAFETY: LASTINPUTINFO is POD, cbSize set correctly, pointer valid.
        let ok = unsafe { GetLastInputInfo(&mut lii) };
        if !ok.as_bool() {
            return None;
        }
        // SAFETY: no arguments, always succeeds.
        let now = unsafe { GetTickCount() };
        // GetTickCount wraps every 49.7 days. If dwTime is greater than
        // `now`, we've wrapped since the last input — clamp to 0 rather
        // than compute a nonsense giant duration.
        let elapsed_ms = now.saturating_sub(lii.dwTime);
        Some(Duration::from_millis(elapsed_ms as u64))
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use core_graphics::event::CGEventType;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use std::time::Duration;

    pub fn seconds_since_last_input() -> Option<Duration> {
        // `Null` = "any" event type per Apple docs. HIDSystemState is
        // the right state ID for user input across all attached HIDs
        // (mouse, keyboard, trackpad).
        let secs = CGEventSource::seconds_since_last_event_type(
            CGEventSourceStateID::HIDSystemState,
            CGEventType::Null,
        );
        if secs.is_nan() || secs.is_infinite() || secs < 0.0 {
            return None;
        }
        Some(Duration::from_secs_f64(secs))
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
mod platform {
    use std::time::Duration;
    pub fn seconds_since_last_input() -> Option<Duration> {
        // No Linux impl — the client only ships Windows + macOS. Never
        // called in production. Returning None (→ ZERO) means the
        // tracker treats the user as freshly active, harmless in dev.
        None
    }
}
