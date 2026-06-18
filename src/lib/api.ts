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
  /** Structured detail payload (e.g. `{message, blockers}` from
   * /companies DELETE). Callers can narrow on `error.detail.blockers`. */
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
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
    let message: string = res.statusText;
    let rawDetail: unknown = undefined;
    try {
      const body = await res.json();
      rawDetail = body.detail;
      // FastAPI lets handlers pass either a string or a structured dict
      // as `detail`. Surface the string form for `.message`, keep the
      // full payload on `.detail` so callers can pull out e.g. blockers.
      if (typeof rawDetail === "string") message = rawDetail;
      else if (rawDetail && typeof rawDetail === "object" && "message" in rawDetail) {
        message = String((rawDetail as { message: unknown }).message);
      }
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, message, rawDetail);
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

  /** Authenticated password change. Used for the regular "change my password"
   * action and the forced first-login flow (when profile.mustChangePassword is true). */
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
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
  listTaskActivity(id: string): Promise<Array<{
    id: string;
    task_id: string;
    actor_user_id: string | null;
    activity_type: string;
    message: string | null;
    note: string | null;
    old_value: unknown;
    new_value: unknown;
    created_at: string;
  }>> {
    return request(`/tasks/${id}/activity`);
  },

  // ---------- Task calls (scheduled meetings on a task) ----------
  listTaskCalls(taskId: string): Promise<TaskCallRow[]> {
    return request(`/tasks/${taskId}/calls`);
  },
  createTaskCall(taskId: string, payload: {
    scheduled_at: string;
    duration_mins: number;
    kind: TaskCallKind;
    contact?: string | null;
    meeting_link?: string | null;
    notes?: string | null;
    participant_ids: string[];
  }): Promise<TaskCallRow> {
    return request(`/tasks/${taskId}/calls`, { method: "POST", body: JSON.stringify(payload) });
  },
  updateTaskCall(callId: string, patch: Partial<{
    scheduled_at: string;
    duration_mins: number;
    kind: TaskCallKind;
    contact: string | null;
    meeting_link: string | null;
    notes: string | null;
    participant_ids: string[];
  }>): Promise<TaskCallRow> {
    return request(`/calls/${callId}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  cancelTaskCall(callId: string): Promise<TaskCallRow> {
    return request(`/calls/${callId}/cancel`, { method: "POST" });
  },

  // ---------- Teams ----------
  listTeams(): Promise<TeamRow[]> {
    return request("/teams");
  },
  getTeam(id: string): Promise<TeamRow> {
    return request(`/teams/${id}`);
  },
  createTeam(payload: {
    name: string;
    kind: string;
    description?: string | null;
    company_id?: string | null;
    client_org_id?: string | null;
    member_ids: string[];
  }): Promise<TeamRow> {
    return request("/teams", { method: "POST", body: JSON.stringify(payload) });
  },
  updateTeam(id: string, patch: Partial<{
    name: string;
    kind: string;
    description: string | null;
    company_id: string | null;
    client_org_id: string | null;
    is_active: boolean;
  }>): Promise<TeamRow> {
    return request(`/teams/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteTeam(id: string): Promise<void> {
    return request(`/teams/${id}`, { method: "DELETE" });
  },
  addTeamMember(teamId: string, userId: string, memberRole: "owner" | "admin" | "member" = "member"): Promise<void> {
    return request(`/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, member_role: memberRole }),
    });
  },
  removeTeamMember(teamId: string, userId: string): Promise<void> {
    return request(`/teams/${teamId}/members/${userId}`, { method: "DELETE" });
  },

  // ---------- Credentials vault ----------
  listVault(): Promise<VaultRow[]> {
    return request("/vault");
  },
  getVault(id: string): Promise<VaultRow> {
    return request(`/vault/${id}`);
  },
  createVault(payload: {
    label: string;
    category: string;
    identifier?: string | null;
    url?: string | null;
    notes?: string | null;
    secret: string;
    rotate_every_days?: number | null;
  }): Promise<VaultRow> {
    return request("/vault", { method: "POST", body: JSON.stringify(payload) });
  },
  updateVault(id: string, patch: Partial<{
    label: string;
    category: string;
    identifier: string | null;
    url: string | null;
    notes: string | null;
    secret: string;
    rotate_every_days: number | null;
    is_active: boolean;
  }>): Promise<VaultRow> {
    return request(`/vault/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteVault(id: string): Promise<void> {
    return request(`/vault/${id}`, { method: "DELETE" });
  },
  revealVault(id: string): Promise<{ secret: string }> {
    return request(`/vault/${id}/reveal`, { method: "POST" });
  },
  logVaultCopy(id: string): Promise<void> {
    return request(`/vault/${id}/copy`, { method: "POST" });
  },
  listVaultAccess(id: string): Promise<VaultAccessRow[]> {
    return request(`/vault/${id}/access`);
  },
  grantVaultAccess(id: string, kind: "user" | "role", principalId: string): Promise<void> {
    return request(`/vault/${id}/access`, {
      method: "POST",
      body: JSON.stringify({ kind, principal_id: principalId }),
    });
  },
  revokeVaultAccess(id: string, kind: "user" | "role", principalId: string): Promise<void> {
    return request(`/vault/${id}/access/${kind}/${principalId}`, { method: "DELETE" });
  },
  getVaultAudit(id: string): Promise<VaultAuditRow[]> {
    return request(`/vault/${id}/audit`);
  },

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
    kind?: string;
    tech_stack?: string[];
    team_id?: string | null;
    progress_mode?: "manual" | "auto";
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
  recomputeProjectProgress(projectId: string): Promise<Record<string, unknown>> {
    return request(`/projects/${projectId}/recompute-progress`, { method: "POST" });
  },

  // ---------- Leave policies + balances ----------
  listLeavePolicies(): Promise<LeavePolicyRow[]> {
    return request("/leave/policies");
  },
  upsertLeavePolicy(companyId: string, leaveType: string, body: {
    annual_quota: number;
    carry_forward_max: number;
    accrual_kind: "upfront" | "monthly";
    is_paid: boolean;
    notes?: string | null;
  }): Promise<LeavePolicyRow> {
    return request(`/leave/policies/${companyId}/${leaveType}`, {
      method: "PUT", body: JSON.stringify(body),
    });
  },
  deleteLeavePolicy(companyId: string, leaveType: string): Promise<void> {
    return request(`/leave/policies/${companyId}/${leaveType}`, { method: "DELETE" });
  },
  listLeaveBalances(opts?: { user_id?: string; year?: number }): Promise<LeaveBalanceRow[]> {
    const q = new URLSearchParams();
    if (opts?.user_id) q.set("user_id", opts.user_id);
    if (opts?.year) q.set("year", String(opts.year));
    const s = q.toString();
    return request(`/leave/balances${s ? `?${s}` : ""}`);
  },
  adjustLeaveBalance(balanceId: string, adjustment: number): Promise<LeaveBalanceRow> {
    return request(`/leave/balances/${balanceId}`, {
      method: "PATCH", body: JSON.stringify({ adjustment }),
    });
  },
  initializeLeaveBalances(): Promise<{ year: number; created: number }> {
    return request("/leave/balances/initialize", { method: "POST" });
  },

  // ---------- Documents / Knowledge base ----------
  listDocuments(): Promise<DocumentRow[]> {
    return request("/documents");
  },
  getDocument(id: string): Promise<DocumentDetailRow> {
    return request(`/documents/${id}`);
  },
  createDocument(payload: {
    title: string;
    body?: string;
    category?: string;
    company_id?: string | null;
    visibility?: "company" | "group_wide" | "private";
    tags?: string[];
  }): Promise<DocumentDetailRow> {
    return request("/documents", { method: "POST", body: JSON.stringify(payload) });
  },
  updateDocument(id: string, patch: Partial<{
    title: string;
    body: string;
    category: string;
    company_id: string | null;
    visibility: "company" | "group_wide" | "private";
    tags: string[];
    is_active: boolean;
    change_note: string;
  }>): Promise<DocumentDetailRow> {
    return request(`/documents/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteDocument(id: string): Promise<void> {
    return request(`/documents/${id}`, { method: "DELETE" });
  },
  listDocumentVersions(id: string): Promise<DocumentVersionRow[]> {
    return request(`/documents/${id}/versions`);
  },
  listDocumentAccess(id: string): Promise<DocumentAccessRow[]> {
    return request(`/documents/${id}/access`);
  },
  grantDocumentAccess(id: string, kind: "user" | "role", principalId: string, accessLevel: "view" | "edit" = "view"): Promise<void> {
    return request(`/documents/${id}/access`, {
      method: "POST",
      body: JSON.stringify({ kind, principal_id: principalId, access_level: accessLevel }),
    });
  },
  revokeDocumentAccess(id: string, kind: "user" | "role", principalId: string): Promise<void> {
    return request(`/documents/${id}/access/${kind}/${principalId}`, { method: "DELETE" });
  },

  // ---------- Assets ----------
  listAssets(): Promise<AssetRow[]> {
    return request("/assets");
  },
  getAsset(id: string): Promise<AssetRow> {
    return request(`/assets/${id}`);
  },
  createAsset(payload: {
    asset_tag?: string | null;
    category: string;
    brand?: string | null;
    model?: string | null;
    serial_number?: string | null;
    company_id?: string | null;
    purchase_date?: string | null;
    purchase_cost?: number | null;
    supplier?: string | null;
    condition?: "new" | "good" | "fair" | "poor";
    notes?: string | null;
  }): Promise<AssetRow> {
    return request("/assets", { method: "POST", body: JSON.stringify(payload) });
  },
  updateAsset(id: string, patch: Partial<{
    asset_tag: string | null;
    category: string;
    brand: string | null;
    model: string | null;
    serial_number: string | null;
    company_id: string | null;
    purchase_date: string | null;
    purchase_cost: number | null;
    supplier: string | null;
    status: "in_stock" | "issued" | "in_repair" | "retired" | "lost";
    condition: "new" | "good" | "fair" | "poor";
    notes: string | null;
    is_active: boolean;
  }>): Promise<AssetRow> {
    return request(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteAsset(id: string): Promise<void> {
    return request(`/assets/${id}`, { method: "DELETE" });
  },
  issueAsset(id: string, payload: { user_id: string; issue_note?: string; condition_at_issue?: string }): Promise<AssetRow> {
    return request(`/assets/${id}/issue`, { method: "POST", body: JSON.stringify(payload) });
  },
  returnAsset(id: string, payload: { return_note?: string; condition_at_return?: string }): Promise<AssetRow> {
    return request(`/assets/${id}/return`, { method: "POST", body: JSON.stringify(payload) });
  },
  listAssetHistory(id: string): Promise<AssetAssignmentRow[]> {
    return request(`/assets/${id}/history`);
  },

  // ---------- Vendors ----------
  listVendors(): Promise<VendorRow[]> {
    return request("/vendors");
  },
  getVendor(id: string): Promise<VendorDetailRow> {
    return request(`/vendors/${id}`);
  },
  createVendor(payload: Partial<VendorRow> & { name: string; category?: string }): Promise<VendorRow> {
    return request("/vendors", { method: "POST", body: JSON.stringify(payload) });
  },
  updateVendor(id: string, patch: Partial<VendorRow>): Promise<VendorRow> {
    return request(`/vendors/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteVendor(id: string): Promise<void> {
    return request(`/vendors/${id}`, { method: "DELETE" });
  },
  createVendorContract(vendorId: string, payload: {
    title: string;
    contract_type?: string;
    amount?: number | null;
    currency?: string;
    billing_cadence?: string;
    start_date?: string | null;
    end_date?: string | null;
    auto_renews?: boolean;
    reminder_days_before?: number;
    status?: string;
    notes?: string | null;
  }): Promise<VendorContractRow> {
    return request(`/vendors/${vendorId}/contracts`, { method: "POST", body: JSON.stringify(payload) });
  },
  updateVendorContract(contractId: string, patch: Partial<VendorContractRow>): Promise<VendorContractRow> {
    return request(`/vendors/contracts/${contractId}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteVendorContract(contractId: string): Promise<void> {
    return request(`/vendors/contracts/${contractId}`, { method: "DELETE" });
  },
  createVendorPayment(vendorId: string, payload: {
    amount: number;
    currency?: string;
    paid_at: string;
    contract_id?: string | null;
    mode?: string | null;
    reference?: string | null;
    notes?: string | null;
  }): Promise<VendorPaymentRow> {
    return request(`/vendors/${vendorId}/payments`, { method: "POST", body: JSON.stringify(payload) });
  },
  deleteVendorPayment(paymentId: string): Promise<void> {
    return request(`/vendors/payments/${paymentId}`, { method: "DELETE" });
  },

  // ---------- Project milestones ----------
  listMilestones(projectId: string): Promise<MilestoneRow[]> {
    return request(`/projects/${projectId}/milestones`);
  },
  createMilestone(projectId: string, payload: {
    title: string;
    description?: string | null;
    due_date?: string | null;
    status?: "planned" | "in_progress" | "done" | "skipped";
    position?: number;
  }): Promise<MilestoneRow> {
    return request(`/projects/${projectId}/milestones`, { method: "POST", body: JSON.stringify(payload) });
  },
  updateMilestone(milestoneId: string, patch: Partial<{
    title: string;
    description: string | null;
    due_date: string | null;
    status: "planned" | "in_progress" | "done" | "skipped";
    position: number;
  }>): Promise<MilestoneRow> {
    return request(`/projects/milestones/${milestoneId}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteMilestone(milestoneId: string): Promise<void> {
    return request(`/projects/milestones/${milestoneId}`, { method: "DELETE" });
  },

  // ---------- Users (admin: super_admin / hr_admin) ----------
  createUser(payload: {
    full_name: string;
    email: string;
    password: string;
    home_company_id: string;
    department_id?: string | null;
    designation?: string;
    employment_type: string;
    role: string;
    reporting_manager_id?: string | null;
    reviewer_id?: string | null;
    doj?: string | null;
  }): Promise<Record<string, unknown>> {
    return request("/users", { method: "POST", body: JSON.stringify(payload) });
  },
  updateUser(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  setUserRoles(id: string, roles: string[]): Promise<{ user_id: string; roles: string[] }> {
    return request(`/users/${id}/roles`, { method: "PUT", body: JSON.stringify({ roles }) });
  },
  deactivateUser(id: string): Promise<Record<string, unknown>> {
    return request(`/users/${id}/deactivate`, { method: "POST" });
  },
  reactivateUser(id: string): Promise<Record<string, unknown>> {
    return request(`/users/${id}/reactivate`, { method: "POST" });
  },

  // ---------- Companies (full profile + schedule) ----------
  /** Create a new group entity. Requires founder / founder_office_coordinator
   * / hr_admin / super_admin. Returns the inserted row with every field
   * (including the new profile columns) so the client can splice it into
   * the data store without a re-fetch. */
  createCompany(payload: { name: string } & Record<string, unknown>): Promise<Record<string, unknown>> {
    return request("/companies", { method: "POST", body: JSON.stringify(payload) });
  },
  /** Patch a company. Same authz as create. Every field is optional — pass
   * only the keys you actually want to change. */
  updateCompany(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  /** Hard delete a company. 409 with `{detail:{message, blockers}}` if the
   * company still has profiles / projects / tasks / conversations linked —
   * the caller renders the blocker counts and offers Mark inactive. */
  deleteCompany(id: string): Promise<Record<string, unknown>> {
    return request(`/companies/${id}`, { method: "DELETE" });
  },

  // ---------- Attendance follow-up (Team Attendance page) ----------
  /** Buckets the day's roster for HR / TA follow-up. Server enforces
   * who can call (403 if not allowed). `need_followup` is the only
   * actionable list — late check-in or early checkout without a half-
   * day / WFH excuse. `not_yet_arrived` is shown as info, not as a
   * todo, so HR isn't pulled into the office at 9 a.m. */
  attendanceFollowup(date?: string): Promise<{
    date: string;
    iso_weekday: number;
    now: string;
    totals: { need_followup: number; present: number; not_yet_arrived: number; on_leave: number; off_today: number };
    need_followup: Record<string, unknown>[];
    present: Record<string, unknown>[];
    not_yet_arrived: Record<string, unknown>[];
    on_leave: Record<string, unknown>[];
    off_today: Record<string, unknown>[];
  }> {
    const q = date ? `?date=${encodeURIComponent(date)}` : "";
    return request(`/attendance/followup${q}`);
  },

  // ---------- Bank accounts (finance-scoped — HR can't see/edit) ----------
  listBankAccounts(companyId: string): Promise<Record<string, unknown>[]> {
    return request(`/companies/${companyId}/bank-accounts`);
  },
  createBankAccount(companyId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/companies/${companyId}/bank-accounts`, {
      method: "POST", body: JSON.stringify(payload),
    });
  },
  updateBankAccount(accountId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/bank-accounts/${accountId}`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
  },
  deleteBankAccount(accountId: string): Promise<void> {
    return request(`/bank-accounts/${accountId}`, { method: "DELETE" });
  },

  // ---------- Contacts + Organizations ----------
  listOrganizations(): Promise<Record<string, unknown>[]> {
    return request("/organizations");
  },
  createOrganization(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request("/organizations", { method: "POST", body: JSON.stringify(payload) });
  },
  updateOrganization(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/organizations/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteOrganization(id: string): Promise<void> {
    return request(`/organizations/${id}`, { method: "DELETE" });
  },
  listContacts(opts?: { category?: string; companyId?: string; search?: string }): Promise<Record<string, unknown>[]> {
    const q = new URLSearchParams();
    if (opts?.category) q.set("category", opts.category);
    if (opts?.companyId) q.set("company_id", opts.companyId);
    if (opts?.search) q.set("search", opts.search);
    return request(`/contacts${q.toString() ? `?${q}` : ""}`);
  },
  getContact(id: string): Promise<Record<string, unknown>> {
    return request(`/contacts/${id}`);
  },
  createContact(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request("/contacts", { method: "POST", body: JSON.stringify(payload) });
  },
  updateContact(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteContact(id: string): Promise<void> {
    return request(`/contacts/${id}`, { method: "DELETE" });
  },
  linkContactCompany(contactId: string, companyId: string, relationship?: string | null): Promise<Record<string, unknown>> {
    return request(`/contacts/${contactId}/companies`, {
      method: "POST",
      body: JSON.stringify({ company_id: companyId, relationship: relationship ?? null }),
    });
  },
  unlinkContactCompany(contactId: string, companyId: string): Promise<void> {
    return request(`/contacts/${contactId}/companies/${companyId}`, { method: "DELETE" });
  },

  // ---------- Holidays (HR/super_admin manages; everyone reads via /bootstrap) ----------
  listHolidays(opts?: { year?: number; companyId?: string }): Promise<Record<string, unknown>[]> {
    const q = new URLSearchParams();
    if (opts?.year) q.set("year", String(opts.year));
    if (opts?.companyId) q.set("company_id", opts.companyId);
    return request(`/holidays${q.toString() ? `?${q}` : ""}`);
  },
  createHoliday(payload: {
    date: string;
    name: string;
    type: "gazetted" | "optional" | "informational";
    company_id?: string | null;
    notes?: string | null;
  }): Promise<Record<string, unknown>> {
    return request("/holidays", { method: "POST", body: JSON.stringify(payload) });
  },
  updateHoliday(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`/holidays/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteHoliday(id: string): Promise<void> {
    return request(`/holidays/${id}`, { method: "DELETE" });
  },
  /** Bulk import a year's list. `replace=true` updates type/notes of any
   * pre-existing rows for the same (company, date, name) instead of skipping. */
  bulkImportHolidays(payload: {
    holidays: Array<{
      date: string;
      name: string;
      type: "gazetted" | "optional" | "informational";
      company_id?: string | null;
      notes?: string | null;
    }>;
    replace?: boolean;
  }): Promise<{ inserted: number; updated: number; skipped: number }> {
    return request("/holidays/bulk", { method: "POST", body: JSON.stringify(payload) });
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
  /** Soft-delete a chat message. Returns the updated row with deleted_at set,
   * or `{already_deleted:true}` if it had already been deleted (idempotent).
   * Sender of the message OR super_admin/founder is allowed. */
  deleteMessage(messageId: string): Promise<MessagePayload | { id: string; already_deleted: boolean }> {
    return request(`/messages/${messageId}`, { method: "DELETE" });
  },
  /** Per-viewer message hide (the employee-facing "Delete" action). The
   * message stays in the DB and is still visible to other employees in the
   * same chat AND to founder + super_admin (with an audit marker). Calling
   * twice is a no-op. */
  hideMessage(messageId: string): Promise<void> {
    return request(`/messages/${messageId}/hide`, { method: "POST" });
  },
  unhideMessage(messageId: string): Promise<void> {
    return request(`/messages/${messageId}/hide`, { method: "DELETE" });
  },
  /** Per-viewer conversation hide (the "Delete chat from my view"). The
   * conversation reappears automatically when a new message lands. */
  hideConversation(conversationId: string): Promise<void> {
    return request(`/conversations/${conversationId}/hide`, { method: "POST" });
  },
  unhideConversation(conversationId: string): Promise<void> {
    return request(`/conversations/${conversationId}/hide`, { method: "DELETE" });
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
  async uploadFile(file: File, entity?: { type: string; id?: string }): Promise<AttachmentRow> {
    const form = new FormData();
    form.append("file", file);
    if (entity) {
      form.append("entity_type", entity.type);
      if (entity.id) form.append("entity_id", entity.id);
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

  /** Build a public, unauthenticated URL for a company logo (entity_type='company').
   * The backend only serves entity_type='company' + image/* via /files/public/,
   * so this is safe for direct <img src=...> use without token plumbing. */
  companyLogoSrc(fileUrl: string | null | undefined): string | null {
    if (!fileUrl) return null;
    const id = fileUrl.replace(/^.*\/files\//, "");
    if (!id) return null;
    return `${BASE}/files/public/${id}`;
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

export interface VendorRow {
  id: string;
  name: string;
  category: string;
  website: string | null;
  gstin: string | null;
  address: string | null;
  primary_contact: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  notes: string | null;
  organization_id: string | null;
  owner_id: string | null;
  company_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface VendorContractRow {
  id: string;
  vendor_id: string;
  title: string;
  contract_type: string;
  amount: number | null;
  currency: string;
  billing_cadence: string;
  start_date: string | null;
  end_date: string | null;
  auto_renews: boolean;
  reminder_days_before: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorPaymentRow {
  id: string;
  vendor_id: string;
  contract_id: string | null;
  amount: number;
  currency: string;
  paid_at: string;
  mode: string | null;
  reference: string | null;
  notes: string | null;
  paid_by: string | null;
  created_at: string;
}

export interface VendorDetailRow extends VendorRow {
  contracts: VendorContractRow[];
  payments: VendorPaymentRow[];
}

export interface AssetRow {
  id: string;
  asset_tag: string | null;
  category: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  company_id: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  supplier: string | null;
  current_holder_id: string | null;
  status: "in_stock" | "issued" | "in_repair" | "retired" | "lost";
  condition: "new" | "good" | "fair" | "poor";
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface AssetAssignmentRow {
  id: string;
  asset_id: string;
  user_id: string;
  issued_at: string;
  issued_by: string | null;
  issue_note: string | null;
  condition_at_issue: string | null;
  returned_at: string | null;
  returned_by: string | null;
  return_note: string | null;
  condition_at_return: string | null;
}

export interface DocumentRow {
  id: string;
  title: string;
  slug: string;
  category: string;
  owner_id: string | null;
  company_id: string | null;
  visibility: "company" | "group_wide" | "private";
  tags: string[] | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface DocumentDetailRow extends DocumentRow {
  body: string;
  can_edit?: boolean;
}

export interface DocumentVersionRow {
  id: string;
  version: number;
  title: string;
  change_note: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface DocumentAccessRow {
  principal_kind: "user" | "role";
  principal_id: string;
  access_level: "view" | "edit";
  granted_at: string;
  granted_by: string | null;
}

export interface LeavePolicyRow {
  id: string;
  company_id: string;
  leave_type: string;
  annual_quota: number;
  carry_forward_max: number;
  accrual_kind: "upfront" | "monthly";
  is_paid: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveBalanceRow {
  id: string;
  user_id: string;
  year: number;
  leave_type: string;
  opening: number;
  accrued: number;
  used: number;
  adjustment: number;
  available: number;
  created_at: string;
  updated_at: string;
}

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "planned" | "in_progress" | "done" | "skipped";
  position: number;
  created_at: string;
  created_by: string | null;
  completed_at: string | null;
}

export interface VaultRow {
  id: string;
  label: string;
  category: string;
  identifier: string | null;
  url: string | null;
  notes: string | null;
  rotate_every_days: number | null;
  last_rotated_at: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface VaultAccessRow {
  principal_kind: "user" | "role";
  principal_id: string;
  granted_at: string;
  granted_by: string | null;
}

export interface VaultAuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  meta: unknown;
  at: string;
}

export interface TeamRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  description: string | null;
  owner_id: string | null;
  company_id: string | null;
  client_org_id: string | null;
  conversation_id: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  member_ids: string[];
}

export type TaskCallKind = "phone_call" | "in_person" | "other";

export interface TaskCallRow {
  id: string;
  task_id: string;
  scheduled_at: string;
  duration_mins: number;
  kind: TaskCallKind;
  contact: string | null;
  meeting_link: string | null;
  notes: string | null;
  status: "scheduled" | "cancelled" | "done";
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  participant_ids: string[];
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
  holidays: any[];
  teams?: any[];
  team_members?: { team_id: string; user_id: string; member_role: string }[];
}
