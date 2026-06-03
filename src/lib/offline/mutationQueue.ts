// Offline write queue.
//
// When a mutation can't reach the server (browser offline, or fetch threw a
// network error), it's stored here and an OPTIMISTIC patch is written to the
// IndexedDB cache so the UI reflects the change immediately. On reconnect the
// queue is drained in FIFO order by replaying the original API call.
//
// Conflict policy: last-write-wins. A queued write that the server rejects
// with a real HTTP error (4xx/5xx) is marked `failed` and surfaced in the
// "Sync issues" UI rather than retried forever.

import { offlineDB, type QueuedMutation, type KeyedRow } from "./db";

export type MutationKind =
  | "createTask"
  | "updateTask"
  | "addTaskActivity"
  | "checkIn"
  | "updateAttendance"
  | "decideApproval"
  | "markNotificationRead"
  | "markAllNotificationsRead"
  | "applyLeave"
  | "updateLeave";

// ---------- current user (needed to build optimistic rows) ----------
let currentUserId: string | null = null;
export function setCurrentUserId(id: string | null) {
  currentUserId = id;
}

// ---------- change notifications (for the SyncIndicator) ----------
type Listener = () => void;
const listeners = new Set<Listener>();
export function onQueueChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() {
  for (const cb of listeners) cb();
}

export async function getQueueCounts(): Promise<{ pending: number; failed: number }> {
  const [pending, failed] = await Promise.all([
    offlineDB.mutations.where("status").equals("pending").count(),
    offlineDB.mutations.where("status").equals("failed").count(),
  ]);
  return { pending, failed };
}

export function listFailures(): Promise<QueuedMutation[]> {
  return offlineDB.mutations.where("status").equals("failed").toArray();
}

export async function discardFailure(id: string) {
  await offlineDB.mutations.delete(id);
  emit();
}

export async function discardAllFailures() {
  const ids = (await offlineDB.mutations.where("status").equals("failed").primaryKeys());
  await offlineDB.mutations.bulkDelete(ids);
  emit();
}

// ---------- id helper (no crypto.randomUUID dependency for older webviews) ----------
function tempId(prefix = "tmp"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(performance.now() * 1000).toString(36)}`;
}

// ---------- optimistic cache patches ----------
// Each handler mutates the IndexedDB cache so the next dataStore refresh (which
// reads from cache while offline) reflects the pending write.

async function patchRow(table: typeof offlineDB.tasks, id: string, patch: Record<string, unknown>) {
  const existing = await table.get(id);
  if (existing) await table.put({ ...existing, ...patch });
}

async function applyOptimistic(kind: MutationKind, args: unknown[]): Promise<void> {
  const now = new Date().toISOString();
  switch (kind) {
    case "createTask": {
      const payload = (args[0] ?? {}) as Record<string, unknown>;
      const row: KeyedRow = {
        id: tempId("task"),
        created_by: currentUserId,
        created_at: now,
        updated_at: now,
        status: "created",
        ...payload,
      };
      await offlineDB.tasks.put(row);
      break;
    }
    case "updateTask": {
      const [id, patch] = args as [string, Record<string, unknown>];
      await patchRow(offlineDB.tasks, id, { ...patch, updated_at: now });
      break;
    }
    case "checkIn": {
      const payload = (args[0] ?? {}) as Record<string, unknown>;
      const row: KeyedRow = {
        id: tempId("att"),
        user_id: currentUserId,
        created_at: now,
        ...payload,
      };
      await offlineDB.attendance_logs.put(row);
      break;
    }
    case "updateAttendance": {
      const [id, patch] = args as [string, Record<string, unknown>];
      await patchRow(offlineDB.attendance_logs, id, patch);
      break;
    }
    case "decideApproval": {
      const [id, patch] = args as [string, Record<string, unknown>];
      await patchRow(offlineDB.approvals, id, {
        ...patch,
        approver_id: currentUserId,
        decided_at: now,
      });
      break;
    }
    case "markNotificationRead": {
      const [id] = args as [string];
      await patchRow(offlineDB.notifications, id, { is_read: true });
      break;
    }
    case "markAllNotificationsRead": {
      const mine = await offlineDB.notifications
        .where("user_id").equals(currentUserId ?? "__none__").toArray();
      await offlineDB.notifications.bulkPut(mine.map((n) => ({ ...n, is_read: true })));
      break;
    }
    case "applyLeave": {
      const payload = (args[0] ?? {}) as Record<string, unknown>;
      await offlineDB.leave_requests.put({
        id: tempId("leave"),
        user_id: currentUserId,
        status: "pending",
        created_at: now,
        ...payload,
      });
      break;
    }
    case "updateLeave": {
      const [id, patch] = args as [string, Record<string, unknown>];
      await patchRow(offlineDB.leave_requests, id, patch);
      break;
    }
    case "addTaskActivity":
      // No cached projection for activity feed — nothing to patch optimistically.
      break;
  }
}

// ---------- enqueue ----------
export async function enqueueMutation(kind: MutationKind, args: unknown[]): Promise<void> {
  const item: QueuedMutation = {
    id: tempId("mut"),
    kind,
    args,
    status: "pending",
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await offlineDB.mutations.add(item);
  await applyOptimistic(kind, args);
  emit();
}

// ---------- drain ----------
// The executor map is injected (see api.ts) to avoid a circular import:
// api.ts builds the offline wrappers AND owns the raw network calls.
type Executor = (...args: unknown[]) => Promise<unknown>;
let executors: Partial<Record<MutationKind, Executor>> = {};
export function registerExecutors(map: Partial<Record<MutationKind, Executor>>) {
  executors = map;
}

let draining = false;

/** True when fetch failed because we're offline (not a real HTTP error). */
function isNetworkError(err: unknown): boolean {
  // Our ApiError carries a numeric HTTP status → it's a real server response.
  if (err && typeof err === "object" && "status" in err) return false;
  return true; // TypeError "Failed to fetch", etc.
}

/**
 * Replay queued mutations oldest-first. Stops at the first network error
 * (still offline). Server-rejected mutations are marked `failed` and skipped.
 * Returns the number successfully synced.
 */
export async function drainQueue(): Promise<number> {
  if (draining) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  draining = true;
  let synced = 0;

  try {
    // FIFO across pending items only.
    const pending = await offlineDB.mutations
      .where("status").equals("pending").sortBy("createdAt");

    for (const m of pending) {
      const exec = executors[m.kind as MutationKind];
      if (!exec) {
        await offlineDB.mutations.update(m.id, { status: "failed", lastError: "No executor registered" });
        continue;
      }
      try {
        await exec(...m.args);
        await offlineDB.mutations.delete(m.id);
        synced++;
        emit();
      } catch (err) {
        if (isNetworkError(err)) {
          // Still offline — stop; remaining items stay queued.
          break;
        }
        // Real server rejection — don't retry forever.
        await offlineDB.mutations.update(m.id, {
          status: "failed",
          attempts: (m.attempts ?? 0) + 1,
          lastError: err instanceof Error ? err.message : String(err),
        });
        emit();
      }
    }
  } finally {
    draining = false;
  }

  if (synced > 0 && typeof window !== "undefined") {
    // Tell dataStore to re-fetch authoritative server state.
    window.dispatchEvent(new CustomEvent("kiron:queue-drained", { detail: { synced } }));
  }
  return synced;
}
