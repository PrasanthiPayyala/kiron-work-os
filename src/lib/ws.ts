// Browser side of the realtime hub. Connects to /ws as soon as the user has a
// JWT, auto-reconnects with backoff on drops, and surfaces server events to
// subscribers via a tiny pub/sub API.
//
// Server events (see backend/app/routers/ws.py):
//   { type: "hello", user_id }
//   { type: "message.new",        data: <raw message row + attachments> }
//   { type: "message.deleted",    data: <raw message row, deleted_at set> }
//   { type: "notification.new",   data: <raw notification row> }
//   { type: "approval.changed",   data: <raw approval row> }
//   { type: "attendance.changed", data: <raw attendance_logs row> }

import { tokens } from "@/lib/api";

export type RealtimeEvent =
  | { type: "hello"; user_id: string }
  | { type: "message.new"; data: Record<string, unknown> }
  | { type: "message.deleted"; data: Record<string, unknown> }
  | { type: "notification.new"; data: Record<string, unknown> }
  | { type: "approval.changed"; data: Record<string, unknown> }
  | { type: "attendance.changed"; data: Record<string, unknown> };

type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let backoffMs = 1000;
let stopRequested = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string | null {
  const access = tokens.access;
  if (!access) return null;
  // The api BASE is something like "/api" (prod) or "http://localhost:8787" (dev).
  // We need an absolute ws:// or wss:// URL.
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";
  let absolute: string;
  if (base.startsWith("http")) {
    absolute = base.replace(/^http/, "ws");
  } else {
    // Relative (e.g. "/api"): use current origin, swap scheme.
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    absolute = `${proto}//${window.location.host}${base}`;
  }
  return `${absolute.replace(/\/$/, "")}/ws?token=${encodeURIComponent(access)}`;
}

function dispatch(ev: RealtimeEvent) {
  for (const cb of listeners) {
    try { cb(ev); } catch (err) { console.warn("[ws] listener threw", err); }
  }
}

function open() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = wsUrl();
  if (!url) return; // no token yet — start() will be called again on login

  try {
    socket = new WebSocket(url);
  } catch (err) {
    console.warn("[ws] failed to construct socket", err);
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    backoffMs = 1000;
  });

  socket.addEventListener("message", (e) => {
    try {
      const ev = JSON.parse(e.data) as RealtimeEvent;
      dispatch(ev);
    } catch {
      // ignore non-JSON frames
    }
  });

  socket.addEventListener("close", (e) => {
    socket = null;
    // 4401 = unauthorized; don't retry until a new token shows up.
    if (e.code === 4401 || stopRequested) return;
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    // Will surface as a `close` shortly after; nothing extra needed here.
  });
}

function scheduleReconnect() {
  if (stopRequested) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    open();
  }, backoffMs);
}

export function startWs(): void {
  stopRequested = false;
  open();
}

export function stopWs(): void {
  stopRequested = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
}

/** Force a reconnect — call this after a token refresh. */
export function restartWs(): void {
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
  open();
}

export function onRealtime(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
