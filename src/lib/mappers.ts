// Maps DB rows (snake_case + DB enums) to the camelCase shapes used by the UI.
// Lets us swap the data source without rewriting every component prop.

import type {
  Company, Department, User, Project, Task, Approval,
  AttendanceLog, LeaveRequest, Conversation, Message, Notification, Role,
  TaskStatus, AttendanceStatus, LeaveStatus, ApprovalState, ApprovalKind,
  Visibility, Priority,
} from "@/types";

type DbProfile = any;
type DbCompany = any;
type DbDept = any;
type DbProject = any;
type DbProjectMember = any;
type DbTask = any;
type DbApproval = any;
type DbAttendance = any;
type DbLeave = any;
type DbConversation = any;
type DbConvMember = any;
type DbMessage = any;
type DbNotif = any;

// ---------- Visibility ----------
export const visIn = (v?: string | null): Visibility => {
  if (v === "founder_office_only") return "founder_office";
  return (v ?? "team") as Visibility;
};
export const visOut = (v: Visibility): string =>
  v === "founder_office" ? "founder_office_only" : v;

// ---------- Task status ----------
export const taskStatusIn = (s?: string | null): TaskStatus => {
  if (s === "waiting_for_review") return "waiting_review";
  if (s === "waiting_for_manager_approval") return "waiting_approval";
  if (s === "rework_required") return "rework";
  return (s ?? "created") as TaskStatus;
};
export const taskStatusOut = (s: TaskStatus): string => {
  if (s === "waiting_review") return "waiting_for_review";
  if (s === "waiting_approval") return "waiting_for_manager_approval";
  if (s === "rework") return "rework_required";
  return s;
};

// ---------- Attendance ----------
export const attStatusIn = (s?: string | null): AttendanceStatus => {
  if (s === "work_from_home") return "wfh";
  return (s ?? "present") as AttendanceStatus;
};

// ---------- Leave type ----------
export const leaveTypeIn = (t?: string | null): any => {
  if (t === "casual_leave") return "casual";
  if (t === "sick_leave") return "sick";
  if (t === "work_from_home") return "wfh";
  return t ?? "casual";
};

// ---------- Role from user_roles aggregation ----------
const ROLE_PRIORITY: Role[] = [
  "super_admin", "founder", "founder_office_coordinator",
  "founder_office_support", "manager", "hr_admin", "employee", "intern",
];
export const pickPrimaryRole = (roles: Role[]): Role => {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return "employee";
};

// ---------- Mappers ----------
export function mapCompany(r: DbCompany): Company {
  return {
    id: r.id,
    name: r.name,
    shortName: r.short_name ?? r.name,
    initials: r.initials ?? r.name.slice(0, 2).toUpperCase(),
    color: r.color ?? "210 50% 50%",
    domain: r.domain ?? undefined,
  };
}

export function mapDepartment(r: DbDept): Department {
  return { id: r.id, name: r.name, companyId: r.company_id ?? "" };
}

export function mapProfile(r: DbProfile, role: Role = "employee"): User {
  const status = r.status === "on_leave" ? "on_leave"
    : r.status === "exited" || r.status === "inactive" ? "inactive"
    : "active";
  return {
    id: r.id,
    name: r.full_name,
    email: r.email ?? "",
    role,
    homeCompanyId: r.home_company_id ?? "",
    departmentId: r.department_id ?? undefined,
    designation: r.designation ?? "",
    reportingManagerId: r.reporting_manager_id ?? undefined,
    reviewerId: r.reviewer_id ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
    initials: r.initials ?? r.full_name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase(),
    skills: r.skills ?? [],
    status,
    productivityScore: r.productivity_score ?? undefined,
    joinedAt: r.doj ?? r.created_at?.slice(0, 10) ?? "2024-01-01",
  };
}

export function mapProject(r: DbProject, memberIds: string[] = []): Project {
  const statusMap: Record<string, Project["status"]> = {
    draft: "planning", active: "active", on_hold: "on_hold",
    completed: "completed", at_risk: "at_risk", planning: "planning",
  };
  return {
    id: r.id,
    name: r.title,
    description: r.description ?? undefined,
    companyId: r.company_id,
    departmentId: r.department_id ?? undefined,
    ownerId: r.owner_id ?? r.created_by ?? "",
    memberIds,
    status: statusMap[r.status] ?? "active",
    risk: (r.risk_level ?? "medium") as any,
    progress: r.progress ?? 0,
    startDate: r.start_date ?? r.created_at?.slice(0, 10) ?? "",
    dueDate: r.due_date ?? "",
    visibility: visIn(r.visibility),
    isStrategic: r.is_strategic ?? false,
    tags: r.tags ?? [],
  };
}

export function mapTask(r: DbTask): Task {
  return {
    id: r.id,
    key: r.task_key ?? r.id.slice(0, 6).toUpperCase(),
    title: r.title,
    description: r.description ?? undefined,
    projectId: r.project_id ?? undefined,
    companyId: r.company_id,
    departmentId: r.department_id ?? undefined,
    assigneeId: r.assignee_id ?? undefined,
    reviewerId: r.reviewer_id ?? undefined,
    reportingManagerId: r.reporting_manager_id ?? undefined,
    createdById: r.created_by ?? "",
    priority: (r.priority ?? "medium") as Priority,
    status: taskStatusIn(r.status),
    visibility: visIn(r.visibility),
    labels: r.labels ?? [],
    dueDate: r.due_at ? r.due_at.slice(0, 10) : undefined,
    slaHours: r.sla_hours ?? undefined,
    createdAt: r.created_at?.slice(0, 10) ?? "",
    updatedAt: r.updated_at?.slice(0, 10) ?? "",
    recurrence: r.is_recurring ? { cadence: "monthly" as const, interval: 1 } : undefined,
    parentTaskId: r.parent_task_id ?? undefined,
    noUpdateDays: r.no_update_days ?? 0,
  };
}

export function mapApproval(r: DbApproval): Approval {
  const stateMap: Record<string, ApprovalState> = {
    pending: "pending", approved: "approved", rejected: "rejected", returned: "returned",
  };
  const kindMap: Record<string, ApprovalKind> = {
    task_completion: "task_completion", project_creation: "project",
    content: "content", leave: "leave",
  };
  return {
    id: r.id,
    kind: kindMap[r.approval_type] ?? "task_completion",
    refId: r.target_id,
    refLabel: r.target_label ?? r.target_id,
    requestedById: r.requested_by ?? "",
    approverId: r.approver_id ?? "",
    route: (r.approval_route ?? undefined) as any,
    state: stateMap[r.status] ?? "pending",
    note: r.comments ?? undefined,
    createdAt: r.created_at?.slice(0, 10) ?? "",
    decidedAt: r.decided_at ? r.decided_at.slice(0, 10) : undefined,
  };
}

export function mapAttendance(r: DbAttendance): AttendanceLog {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.work_date,
    checkIn: r.check_in_at ? new Date(r.check_in_at).toTimeString().slice(0, 5) : undefined,
    checkOut: r.check_out_at ? new Date(r.check_out_at).toTimeString().slice(0, 5) : undefined,
    status: attStatusIn(r.status),
    workedHours: r.worked_hours ?? undefined,
    source: (r.source === "biometric" ? "biometric" : r.source === "system" ? "system" : "self"),
  };
}

export function mapLeave(r: DbLeave): LeaveRequest {
  return {
    id: r.id,
    userId: r.user_id,
    type: leaveTypeIn(r.leave_type),
    fromDate: r.start_date,
    toDate: r.end_date,
    days: Number(r.days ?? 1),
    reason: r.reason ?? "",
    status: r.status as LeaveStatus,
    decidedById: r.hr_approver_id ?? undefined,
    createdAt: r.created_at?.slice(0, 10) ?? "",
  };
}

export function mapConversation(
  r: DbConversation,
  memberIds: string[] = [],
  lastReadAt?: string | null,
): Conversation {
  const kindMap: Record<string, Conversation["kind"]> = {
    direct: "dm", company_group: "company_group", team_group: "team_group",
    project_group: "project_group", announcement: "announcement",
  };
  return {
    id: r.id,
    kind: kindMap[r.channel_type] ?? "dm",
    name: r.title ?? "Conversation",
    companyId: r.company_id ?? undefined,
    projectId: r.project_id ?? undefined,
    memberIds,
    lastMessageAt: r.last_message_at ?? undefined,
    lastMessagePreview: r.last_message_preview ?? undefined,
    lastReadAt: lastReadAt ?? undefined,
    unreadCount: 0, // recomputed client-side from messages vs lastReadAt
    pinned: r.pinned ?? false,
  };
}

export function mapMessage(r: DbMessage): Message {
  const attachments = Array.isArray(r.attachments)
    ? r.attachments.map((a: any) => ({
        id: a.id,
        fileName: a.file_name,
        fileSize: a.file_size ?? null,
        mimeType: a.mime_type ?? null,
      }))
    : undefined;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    createdAt: r.created_at ?? "",
    mentions: r.mentions ?? [],
    taskRefId: r.task_ref_id ?? undefined,
    attachments,
  };
}

export function mapNotification(r: DbNotif): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: (r.notification_type ?? "general") as any,
    title: r.title,
    body: r.body ?? undefined,
    link: r.link ?? undefined,
    read: r.is_read ?? false,
    createdAt: r.created_at ?? "",
  };
}
