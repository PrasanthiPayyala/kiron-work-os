// Thin REST client for the self-hosted FastAPI backend. Replaces the Supabase
// JS client for auth + data. Stores JWTs in localStorage and refreshes on 401.
//
// In-scope data mutations are wrapped with an offline queue (see
// src/lib/offline/mutationQueue.ts): when the network is unreachable the write
// is stored locally, an optimistic patch is applied to the IndexedDB cache,
// and the call resolves so the UI proceeds. The queue replays on reconnect.

import { enqueueMutation, registerExecutors, type MutationKind } from "@/lib/offline/mutationQueue";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";
const ACCESS_KEY = "kiron_access";
const REFRESH_KEY = "kiron_refresh";

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function tryRefresh(): Promise<boolean> {
  const refresh = tokens.refresh;
  if (!refresh) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  tokens.set(data.access_token);
  return true;
}

async function request<T>(path: string, opts: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const access = tokens.access;
  if (access) headers["Authorization"] = `Bearer ${access}`;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (res.status === 401 && retry && tokens.refresh) {
    if (await tryRefresh()) return request<T>(path, opts, false);
    tokens.clear();
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------- Auth ----------
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user_id: string;
}
export interface MeResponse {
  profile: Record<string, unknown>;
  roles: string[];
}

// ---------- Raw network mutations (no offline handling) ----------
// These hit the API directly. The offline queue replays them verbatim on
// reconnect, so they MUST throw on failure rather than swallow errors.
const raw = {
  createTask: (payload: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request("/tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateTask: (id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  addTaskActivity: (id: string, body: Record<string, unknown>): Promise<{ id: string }> =>
    request(`/tasks/${id}/activity`, { method: "POST", body: JSON.stringify(body) }),
  checkIn: (payload: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request("/attendance", { method: "POST", body: JSON.stringify(payload) }),
  updateAttendance: (id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request(`/attendance/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  applyLeave: (payload: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request("/leave", { method: "POST", body: JSON.stringify(payload) }),
  updateLeave: (id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request(`/leave/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  decideApproval: (id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request(`/approvals/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  markNotificationRead: (id: string): Promise<void> =>
    request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: (): Promise<{ updated: number }> =>
    request("/notifications/mark-all-read", { method: "POST" }),
};

// Replays use the raw network calls (no re-queueing).
registerExecutors(raw as Record<MutationKind, (...args: unknown[]) => Promise<unknown>>);

// Synthetic result returned when a write is queued offline. Cast to the
// method's nominal return type so call sites keep their existing signatures;
// at runtime, fields like `.id` are simply absent until the queue drains.
const QUEUED = { queued: true } as const;

/**
 * Wrap a raw mutation so that, when the network is unreachable, the call is
 * enqueued + optimistically cached instead of throwing. Real HTTP errors
 * (ApiError) still reject so callers can show validation/permission messages.
 */
function withOffline<A extends unknown[], R>(
  kind: MutationKind,
  rawFn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueueMutation(kind, args);
      return QUEUED as unknown as R;
    }
    try {
      return await rawFn(...args);
    } catch (err) {
      if (err instanceof ApiError) throw err; // real server response — surface it
      // Network-level failure (offline / server unreachable) — queue & proceed.
      await enqueueMutation(kind, args);
      return QUEUED as unknown as R;
    }
  };
}

export const api = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    tokens.set(data.access_token, data.refresh_token);
    return data;
  },

  async logout(): Promise<void> {
    try {
      await request<void>("/auth/logout", { method: "POST" });
    } finally {
      tokens.clear();
    }
  },

  me(): Promise<MeResponse> {
    return request<MeResponse>("/auth/me");
  },

  hasSession(): boolean {
    return !!tokens.access;
  },

  // ---------- Password reset ----------
  /** Request a password-reset email. Always succeeds (server doesn't reveal whether the email is registered). */
  forgotPassword(email: string): Promise<void> {
    return request("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  /** Consume a reset token + set a new password. On success returns a fresh
   * session so the user lands signed in. */
  async resetPassword(token: string, newPassword: string): Promise<LoginResponse> {
    const data = await request<LoginResponse>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    tokens.set(data.access_token, data.refresh_token);
    return data;
  },

  // ---------- Data ----------
  bootstrap(): Promise<BootstrapResponse> {
    return request<BootstrapResponse>("/bootstrap");
  },

  // ---------- Offline-aware mutations ----------
  createTask: withOffline("createTask", raw.createTask),
  updateTask: withOffline("updateTask", raw.updateTask),
  addTaskActivity: withOffline("addTaskActivity", raw.addTaskActivity),

  // ---------- Projects (online-only; managers don't typically create projects offline) ----------
  createProject(payload: {
    title: string;
    description?: string | null;
    company_id: string;
    department_id?: string | null;
    owner_id?: string | null;
    approver_id?: string | null;
    status?: string;
    risk_level?: string;
    visibility?: string;
    is_strategic?: boolean;
    progress?: number;
    start_date?: string | null;
    due_date?: string | null;
    tags?: string[];
    member_ids?: string[];
  }): Promise<Record<string, unknown>> {
    return request("/projects", { method: "POST", body: JSON.stringify(payload) });
  },
  updateProject(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteProject(id: string): Promise<void> {
    return request(`/projects/${id}`, { method: "DELETE" });
  },
  addProjectMember(projectId: string, userId: string, memberRole = "member"): Promise<void> {
    return request(`/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, member_role: memberRole }),
    });
  },
  removeProjectMember(projectId: string, userId: string): Promise<void> {
    return request(`/projects/${projectId}/members/${userId}`, { method: "DELETE" });
  },
  checkIn: withOffline("checkIn", raw.checkIn),
  updateAttendance: withOffline("updateAttendance", raw.updateAttendance),
  applyLeave: withOffline("applyLeave", raw.applyLeave),
  updateLeave: withOffline("updateLeave", raw.updateLeave),
  decideApproval: withOffline("decideApproval", raw.decideApproval),
  markNotificationRead: withOffline("markNotificationRead", raw.markNotificationRead),
  markAllNotificationsRead: withOffline("markAllNotificationsRead", raw.markAllNotificationsRead),

  // ---------- Chat (online-only — excluded from offline scope) ----------
  sendMessage(payload: {
    conversation_id: string;
    body: string;
    parent_message_id?: string | null;
    attachment_ids?: string[];
  }): Promise<MessagePayload> {
    return request("/messages", { method: "POST", body: JSON.stringify(payload) });
  },

  createConversation(payload: {
    channel_type: "direct" | "team_group" | "company_group" | "project_group" | "announcement";
    title?: string | null;
    member_ids: string[];
    company_id?: string | null;
    project_id?: string | null;
    task_id?: string | null;
  }): Promise<ConversationCreated> {
    return request("/conversations", { method: "POST", body: JSON.stringify(payload) });
  },

  listMessages(convId: string, opts?: { limit?: number; before?: string }): Promise<{ messages: MessagePayload[] }> {
    const q = new URLSearchParams();
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.before) q.set("before", opts.before);
    return request(`/conversations/${convId}/messages${q.toString() ? `?${q}` : ""}`);
  },

  addConversationMember(convId: string, userId: string): Promise<void> {
    return request(`/conversations/${convId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  },

  removeConversationMember(convId: string, userId: string): Promise<void> {
    return request(`/conversations/${convId}/members/${userId}`, { method: "DELETE" });
  },

  markConversationRead(convId: string): Promise<void> {
    return request(`/conversations/${convId}/read`, { method: "POST" });
  },

  // ---------- Files (multipart upload; download is a plain GET with auth) ----------
  async uploadFile(file: File, entity?: { type: string; id: string }): Promise<AttachmentRow> {
    const form = new FormData();
    form.append("file", file);
    if (entity) {
      form.append("entity_type", entity.type);
      form.append("entity_id", entity.id);
    }
    const headers: Record<string, string> = {};
    const access = tokens.access;
    if (access) headers["Authorization"] = `Bearer ${access}`;
    // NOTE: don't set Content-Type — browser sets multipart boundary.
    const res = await fetch(`${BASE}/files`, { method: "POST", headers, body: form });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch { /* */ }
      throw new ApiError(res.status, detail);
    }
    return res.json();
  },

  /** List attachments for a task/project/message. Newest first. */
  listFiles(entityType: "task" | "project" | "message", entityId: string): Promise<FileRow[]> {
    const q = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
    return request(`/files?${q.toString()}`);
  },

  /** Delete an attachment (uploader or elevated role only). */
  deleteFile(attachmentId: string): Promise<void> {
    return request(`/files/${attachmentId}`, { method: "DELETE" });
  },

  /** Build an authenticated GET URL for downloading an attachment. Browsers
   * can't set Authorization on `<a download>` links, so callers fetch + blob. */
  async downloadFile(attachmentId: string, filename?: string): Promise<void> {
    const headers: Record<string, string> = {};
    const access = tokens.access;
    if (access) headers["Authorization"] = `Bearer ${access}`;
    const res = await fetch(`${BASE}/files/${attachmentId}`, { headers });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

// ---------- shared types ----------
export interface AttachmentRow {
  id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
}

/** The full row returned by GET /files — adds metadata the AttachmentList renders. */
export interface FileRow extends AttachmentRow {
  entity_type: string | null;
  entity_id: string | null;
  file_url: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface MessagePayload {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  parent_message_id: string | null;
  created_at: string;
  attachments?: AttachmentRow[];
}

export interface ConversationCreated {
  id: string;
  channel_type: string;
  title: string | null;
  member_ids: string[];
  reused?: boolean;
}

// Raw snake_case rows, same shape the Supabase client returned.
export interface BootstrapResponse {
  companies: any[];
  departments: any[];
  profiles: any[];
  user_roles: { user_id: string; role: string }[];
  projects: any[];
  project_members: { project_id: string; user_id: string }[];
  tasks: any[];
  approvals: any[];
  attendance_logs: any[];
  leave_requests: any[];
  conversations: any[];
  conversation_members: { conversation_id: string; user_id: string }[];
  messages: any[];
  notifications: any[];
}
