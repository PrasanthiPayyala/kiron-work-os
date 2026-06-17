/**
 * Browser/OS-level desktop notifications via the Notification API.
 *
 * V1 scope (foreground only): when the user has the Kiron tab open or
 * the PWA "installed" as a desktop app and running, an incoming WS
 * `notification.new` event also triggers a small OS toast in the corner
 * of the screen. Clicking it focuses the originating tab and (if the
 * notification carries a link) routes to that page.
 *
 * V1 does NOT cover full Web Push — when the app is fully closed there
 * is no service-worker push subscription, so the notification only
 * lights up the bell on next open. That's the V2 build (VAPID keys +
 * pywebpush + service-worker push handler).
 */

export type DesktopPermission = "default" | "granted" | "denied" | "unsupported";

/** Returns the current notification permission, or "unsupported" if the
 * browser lacks the Notification API (older Safari iOS, sandboxed
 * environments). */
export function desktopPermission(): DesktopPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Ask the user to grant notification permission. Resolves with the new
 * permission state. Safe to call multiple times — the browser handles
 * the "already granted" / "already denied" cases internally. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

/** Fire a single desktop notification. No-op (returns false) when
 * permission isn't granted, when the tab is in the foreground (the user
 * is already looking — don't double-buzz), or when the browser doesn't
 * support the API. */
export function showDesktopNotification(opts: {
  title: string;
  body?: string;
  link?: string;
  tag?: string;
}): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  // If the user is actively looking at the tab, the in-app bell + toast
  // is enough — firing an OS toast on top is noisy.
  if (typeof document !== "undefined" && document.visibilityState === "visible") return false;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      // Stable tag → repeat reminders for the same task collapse into one
      // OS toast instead of stacking. Falls back to a unique key.
      tag: opts.tag ?? `kiron-${Date.now()}`,
      // Service workers can't fire notifications from this V1 path; the
      // default icon is whatever the PWA manifest declares.
    });
    if (opts.link) {
      n.onclick = () => {
        try {
          window.focus();
          if (window.location.pathname !== opts.link) {
            // Route handled by react-router via plain navigation; using
            // assign keeps it portable across SPA + installed PWA shells.
            window.location.href = opts.link!;
          }
          n.close();
        } catch {
          /* the browser blocks focus from some contexts — best-effort */
        }
      };
    }
    return true;
  } catch {
    return false;
  }
}
