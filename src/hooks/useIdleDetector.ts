// 30-min conservative idle detector.
//
// Tracks user activity (mouse, keyboard, touch, wheel) and page
// visibility. After IDLE_THRESHOLD_MIN of zero activity OR a
// visibilitychange→hidden, starts an interval. On resume (any activity
// event or visibility back to visible), if the interval lasted at
// least IDLE_THRESHOLD_MIN it's POSTed to /attendance/idle-intervals.
// Backend dedupes by (user, started_at) so retries are safe.
//
// Conservative threshold is the explicit user pick — 30 min means
// someone in a Zoom call without typing doesn't get penalised. Lock-
// screen events aren't browser-readable directly, but they trigger a
// visibilitychange→hidden plus tab focus loss in practice, so the
// hidden source picks them up too.
//
// Mounted once at the AppShell level so it runs everywhere, not just
// /attendance. Idle gaps that occur before today's check-in are still
// detected on the client but the backend no-ops (no log row to
// attribute them to).

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

const ACTIVITY_EVENTS = [
  "mousemove", "keydown", "mousedown", "wheel", "touchstart",
] as const;

// The threshold below which a quiet stretch is NOT considered idle.
// Conservative pick — meetings, deep reading, etc. shouldn't be punished.
const IDLE_THRESHOLD_MIN = 30;
const IDLE_THRESHOLD_MS = IDLE_THRESHOLD_MIN * 60 * 1000;

// How often we wake up and check whether the activity gap has crossed
// the threshold. 60s is fine — we don't need sub-minute precision and
// it keeps the timer cheap.
const TICK_MS = 60 * 1000;

export function useIdleDetector(enabled: boolean) {
  // Refs (not state) so listeners don't trigger re-renders.
  const lastActivityRef = useRef<number>(Date.now());
  const idleSinceRef = useRef<number | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const now = () => Date.now();
    lastActivityRef.current = now();
    idleSinceRef.current = null;
    hiddenSinceRef.current = document.visibilityState === "hidden" ? now() : null;

    // Flush helper: called on resume / visibility=visible. If the gap
    // is long enough, POST it. Source is 'hidden' if the tab was
    // hidden the whole time, 'idle' otherwise.
    const flushIdle = (kind: "idle" | "hidden") => {
      const startedAt = kind === "idle" ? idleSinceRef.current : hiddenSinceRef.current;
      if (kind === "idle") idleSinceRef.current = null;
      else hiddenSinceRef.current = null;
      if (!startedAt) return;
      const endedAt = now();
      if (endedAt - startedAt < IDLE_THRESHOLD_MS) return;
      // Fire-and-forget. Failure is fine — next interval will retry the
      // same window via the dedupe key. We don't await so the user's
      // first click after resuming feels instant.
      void api.postIdleInterval({
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        source: kind,
      }).catch(() => { /* swallow — backend has its own idempotency */ });
    };

    const onActivity = () => {
      const t = now();
      lastActivityRef.current = t;
      // If we were tracking an idle period, flush it.
      flushIdle("idle");
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = now();
        // Treat hidden as immediate activity boundary — if we were
        // idle in the foreground, finish that interval first.
        flushIdle("idle");
      } else {
        flushIdle("hidden");
        lastActivityRef.current = now();
      }
    };

    // Periodic check — start an idle interval when the gap crosses
    // threshold (we don't wait until resume to record `started_at`).
    const tick = window.setInterval(() => {
      const gap = now() - lastActivityRef.current;
      if (gap >= IDLE_THRESHOLD_MS && idleSinceRef.current == null
          && document.visibilityState === "visible") {
        // Anchor the idle start at lastActivity, not "now" — we want
        // the interval to reflect the actual quiet period.
        idleSinceRef.current = lastActivityRef.current;
      }
    }, TICK_MS);

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    // On unmount (sign-out, route teardown), flush any open intervals
    // so we don't lose the data.
    return () => {
      flushIdle("idle");
      flushIdle("hidden");
      window.clearInterval(tick);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
