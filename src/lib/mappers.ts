// Maps DB rows (snake_case + DB enums) to the camelCase shapes used by the UI.
// Lets us swap the data source without rewriting every component prop.

import type {
  Company, Department, User, Project, Task, Approval,
  AttendanceLog, LeaveRequest, Conversation, Message, Notification, Role,
  TaskStatus, AttendanceStatus, LeaveStatus, ApprovalState, ApprovalKind,
  Visibility, Priority, EmploymentType, Holiday, HolidayType, Schedule,
  Director,
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
// Time columns come back from Postgres as "HH:MM:SS"; strip the seconds so
// the UI can use a plain <input type="time" /> against the value.
const hhmm = (t?: string | null): string => (t ? t.slice(0, 5) : "");

/** Coerce a value into a defaulted string[] — text[] columns come back as
 * either an array (data) or null/undefined (column never set). */
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Postgres date columns serialise as ISO "YYYY-MM-DD"; slice defensively in
 * case a timestamp slipped through. */
const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  return null;
};

const directorsIn = (v: unknown): Director[] => {
  if (!Array.isArray(v)) return [];
  return v
    .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
    .map((d) => ({
      name: String(d.name ?? ""),
      designation: String(d.designation ?? ""),
      din: d.din != null ? String(d.din) : null,
    }));
};

const leadershipIn = (v: unknown): import("@/types").LeadershipMember[] => {
  if (!Array.isArray(v)) return [];
  return v
    .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
    .map((d) => ({
      name: String(d.name ?? ""),
      designation: String(d.designation ?? ""),
    }));
};

const industryLicencesIn = (v: unknown): import("@/types").IndustryLicence[] => {
  if (!Array.isArray(v)) return [];
  return v
    .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
    .map((d) => ({
      licence_type: String(d.licence_type ?? d.license_type ?? ""),
      number: String(d.number ?? ""),
      issued_at: d.issued_at != null ? String(d.issued_at).slice(0, 10) : null,
      expires_at: d.expires_at != null ? String(d.expires_at).slice(0, 10) : null,
    }));
};

export function mapCompany(r: DbCompany): Company {
  return {
    id: r.id,
    name: r.name,
    shortName: r.short_name ?? r.name,
    initials: r.initials ?? r.name.slice(0, 2).toUpperCase(),
    color: r.color ?? "210 50% 50%",
    domain: r.domain ?? undefined,
    code: r.code ?? null,
    logoUrl: r.logo_url ?? null,
    isActive: r.is_active !== false,
    schedule: {
      workDays: Array.isArray(r.work_days) && r.work_days.length ? r.work_days : [1,2,3,4,5,6],
      workStart: hhmm(r.work_start) || "09:30",
      workEnd: hhmm(r.work_end) || "18:30",
      saturdayWeeksWorking: Array.isArray(r.saturday_weeks_working) && r.saturday_weeks_working.length
        ? r.saturday_weeks_working
        : null,
    },
    profile: {
      websiteUrls: arr(r.website_urls),
      websiteTechnologies: r.website_technologies ?? null,
      natureOfBusiness: r.nature_of_business ?? null,
      dateOfIncorporation: isoDate(r.date_of_incorporation),
      isStartup: r.is_startup === true,
      cin: r.cin ?? null,
      gst: r.gst ?? null,
      pan: r.pan ?? null,
      tan: r.tan ?? null,
      tin: r.tin ?? null,
      msmeUdyamNumber: r.msme_udyam_number ?? null,
      msmeUdyamMobile: r.msme_udyam_mobile ?? null,
      msmeUdyamEmail: r.msme_udyam_email ?? null,
      dpiitStartupNumber: r.dpiit_startup_number ?? null,
      registeredAddress: r.registered_address ?? null,
      corporateAddresses: arr(r.corporate_addresses),
      operationsAddresses: arr(r.operations_addresses),
      phoneNumbers: arr(r.phone_numbers),
      directors: directorsIn(r.directors),
      leadership: leadershipIn((r as any).leadership),
      kiranDesignation: r.kiran_designation ?? null,
      prashantiDesignation: r.prashanti_designation ?? null,
      certificates: arr(r.certificates),
      caDocumentsHeld: arr(r.ca_documents_held),
      esiNumber: (r as any).esi_number ?? null,
      epfNumber: (r as any).epf_number ?? null,
      professionalTaxNumber: (r as any).professional_tax_number ?? null,
      shopsEstablishmentNumber: (r as any).shops_establishment_number ?? null,
      shopsEstablishmentExpiresAt: isoDate((r as any).shops_establishment_expires_at),
      iecNumber: (r as any).iec_number ?? null,
      industryLicences: industryLicencesIn((r as any).industry_licenses),
      ptState: (r as any).pt_state ?? null,
    },
  };
}

export function mapDepartment(r: DbDept): Department {
  return { id: r.id, name: r.name, companyId: r.company_id ?? "" };
}

const VALID_EMPLOYMENT: EmploymentType[] = ["intern", "contract", "full_time", "temporary", "part_time"];

export function mapProfile(r: DbProfile, role: Role = "employee"): User {
  const status = r.status === "on_leave" ? "on_leave"
    : r.status === "exited" || r.status === "inactive" ? "inactive"
    : "active";
  // Fall back to full_time for legacy rows that pre-date the migration; this
  // matches the DB-side DEFAULT and keeps the UI rendering clean.
  const employmentType: EmploymentType = VALID_EMPLOYMENT.includes(r.employment_type)
    ? r.employment_type
    : "full_time";
  return {
    id: r.id,
    name: r.full_name,
    email: r.email ?? "",
    role,
    homeCompanyId: r.home_company_id ?? "",
    officeId: r.office_id ?? undefined,
    departmentId: r.department_id ?? undefined,
    designation: r.designation ?? "",
    reportingManagerId: r.reporting_manager_id ?? undefined,
    reviewerId: r.reviewer_id ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
    initials: r.initials ?? r.full_name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase(),
    skills: r.skills ?? [],
    status,
    employmentType,
    isActive: r.is_active !== false,
    mustChangePassword: r.must_change_password === true,
    attendanceFollowupAccess: (r as any).attendance_followup_access === true,
    // Pass through the raw nullable override columns. The effective schedule
    // is computed via getEffectiveSchedule() so callers stay declarative.
    scheduleOverride: {
      workDays: Array.isArray(r.work_days) ? r.work_days : null,
      workStart: r.work_start ? hhmm(r.work_start) : null,
      workEnd: r.work_end ? hhmm(r.work_end) : null,
      saturdayWeeksWorking: Array.isArray(r.saturday_weeks_working) ? r.saturday_weeks_working : null,
    },
    productivityScore: r.productivity_score ?? undefined,
    joinedAt: r.doj ?? r.created_at?.slice(0, 10) ?? "2024-01-01",
  };
}

/** Merge a user's override on top of their company's default. Per-field
 * inheritance: a null override falls back to the company value. */
export function getEffectiveSchedule(user: User, company?: Company): Schedule {
  const base: Schedule = company?.schedule ?? {
    workDays: [1,2,3,4,5,6], workStart: "09:30", workEnd: "18:30",
    saturdayWeeksWorking: null,
  };
  const o = user.scheduleOverride;
  return {
    workDays: o?.workDays && o.workDays.length ? o.workDays : base.workDays,
    workStart: o?.workStart || base.workStart,
    workEnd: o?.workEnd || base.workEnd,
    // saturdayWeeksWorking: null means "inherit" at profile level, but at the
    // effective level we want a single source of truth — fall through to the
    // company value, which itself may be null ("all Saturdays work").
    saturdayWeeksWorking: o?.saturdayWeeksWorking && o.saturdayWeeksWorking.length
      ? o.saturdayWeeksWorking
      : base.saturdayWeeksWorking,
  };
}

/** Which Saturday-of-month is `d`? Returns 1..5 based on date-of-month, so
 * the 1st Saturday (date 1–7) is week 1, the 2nd (date 8–14) is week 2, etc.
 * Matches the standard Indian-corporate reading of "2nd Saturday off". */
export function saturdayWeekOfMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

/** Decide whether a given calendar date is a non-working day under the given
 * schedule. Handles:
 *   1. Day-of-week not in workDays
 *   2. Day-of-week is Saturday AND saturdayWeeksWorking restricts the
 *      Saturday-of-month positions that are working
 * Used by Attendance grid shading and downstream by Leave-day counting. */
export function isNonWorkingDate(d: Date, schedule: Schedule): boolean {
  const js = d.getDay();           // 0=Sun..6=Sat
  const iso = js === 0 ? 7 : js;   // 1=Mon..7=Sun
  if (!schedule.workDays.includes(iso)) return true;
  if (iso === 6 && schedule.saturdayWeeksWorking) {
    return !schedule.saturdayWeeksWorking.includes(saturdayWeekOfMonth(d));
  }
  return false;
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
    kind: ((r as any).kind ?? "internal") as Project["kind"],
    techStack: Array.isArray((r as any).tech_stack) ? (r as any).tech_stack : [],
    teamId: (r as any).team_id ?? null,
    progressMode: ((r as any).progress_mode ?? "manual") as Project["progressMode"],
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

export function mapOffice(r: any): import("@/types").Office {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    address: r.address ?? undefined,
    latitude: r.latitude != null ? Number(r.latitude) : undefined,
    longitude: r.longitude != null ? Number(r.longitude) : undefined,
    radiusM: Number(r.radius_m ?? 200),
    isActive: r.is_active !== false,
  };
}

export function mapAttendancePermission(r: any): import("@/types").AttendancePermission {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    kind: r.kind,
    minutes: Number(r.minutes ?? 0),
    reason: r.reason ?? undefined,
    status: r.status,
    requestedById: r.requested_by,
    decidedById: r.decided_by ?? undefined,
    decidedAt: r.decided_at ?? undefined,
    decisionNote: r.decision_note ?? undefined,
    createdAt: r.created_at ?? "",
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
    // Pass through the raw source string — the UI switches on the
    // known values ("desktop_agent", "self_checkin", etc.) and the
    // AttendanceSource type is union-with-string for forward-compat.
    source: r.source ?? "self_checkin",
    compOffEarned: r.comp_off_earned != null ? Number(r.comp_off_earned) : undefined,
    compOffStatus: r.comp_off_status ?? undefined,
    compOffDecidedById: r.comp_off_decided_by ?? undefined,
    deviceId: r.device_id ?? undefined,
    clientVersion: r.client_version ?? undefined,
    hostname: r.hostname ?? undefined,
    lastHeartbeatAt: r.last_heartbeat_at ?? undefined,
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
    compOffRepayBy: r.comp_off_repay_by ?? undefined,
    decidedById: r.hr_approver_id ?? undefined,
    decidedAt: r.decided_at ?? undefined,
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
    deletedAt: (r as any).deleted_at ?? null,
    deletedBy: (r as any).deleted_by ?? null,
    hiddenBy: Array.isArray((r as any).hidden_by) ? (r as any).hidden_by : undefined,
  };
}

export function mapHoliday(r: any): Holiday {
  return {
    id: r.id,
    companyId: r.company_id ?? null,
    // Postgres date columns serialise as ISO strings; the time zone shouldn't
    // appear here, but slice defensively in case it's a full timestamp.
    date: typeof r.date === "string" ? r.date.slice(0, 10) : r.date,
    name: r.name,
    type: (r.type ?? "gazetted") as HolidayType,
    notes: r.notes ?? undefined,
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

// ---------- Project milestones ----------
export function mapProjectMilestone(r: any): import("@/types").ProjectMilestone {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description ?? null,
    dueDate: r.due_date ?? null,
    status: r.status as import("@/types").MilestoneStatus,
    position: r.position ?? 0,
    createdAt: r.created_at ?? "",
    createdById: r.created_by ?? null,
    completedAt: r.completed_at ?? null,
  };
}

// ---------- Teams ----------
export function mapTeam(r: any, memberIds: string[] = []): import("@/types").Team {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    kind: r.kind as import("@/types").TeamKind,
    description: r.description ?? null,
    ownerId: r.owner_id ?? null,
    companyId: r.company_id ?? null,
    clientOrgId: r.client_org_id ?? null,
    conversationId: r.conversation_id ?? null,
    isActive: r.is_active !== false,
    createdAt: r.created_at ?? "",
    createdById: r.created_by ?? null,
    memberIds: Array.isArray(r.member_ids) ? r.member_ids : memberIds,
  };
}

// ---------- Payroll (PT slab reference) ----------
export function mapPtSlab(r: any): import("@/types").PtSlab {
  return {
    id: r.id,
    state: r.state,
    minGross: Number(r.min_gross ?? 0),
    maxGross: r.max_gross == null ? null : Number(r.max_gross),
    amount: Number(r.amount ?? 0),
    isActive: r.is_active !== false,
  };
}

export function mapTaxSlab(r: any): import("@/types").TaxSlab {
  return {
    id: r.id,
    regime: r.regime,
    fyLabel: r.fy_label,
    minIncome: Number(r.min_income ?? 0),
    maxIncome: r.max_income == null ? null : Number(r.max_income),
    ratePct: Number(r.rate_pct ?? 0),
    isActive: r.is_active !== false,
  };
}

export function mapTaxRegimeConfig(r: any): import("@/types").TaxRegimeConfig {
  return {
    id: r.id,
    regime: r.regime,
    fyLabel: r.fy_label,
    standardDeduction: Number(r.standard_deduction ?? 0),
    rebateThreshold: r.rebate_threshold == null ? null : Number(r.rebate_threshold),
    cessPct: Number(r.cess_pct ?? 0),
    isActive: r.is_active !== false,
  };
}

// ---------- Contacts & Organizations ----------
export function mapOrganization(r: any): import("@/types").Organization {
  return {
    id: r.id,
    name: r.name,
    type: r.type ?? null,
    website: r.website ?? null,
    linkedinUrl: r.linkedin_url ?? null,
    address: r.address ?? null,
    gstin: r.gstin ?? null,
    notes: r.notes ?? null,
    isActive: r.is_active !== false,
    createdAt: r.created_at ?? "",
    createdBy: r.created_by ?? null,
  };
}

export function mapContact(r: any): import("@/types").Contact {
  const links: { company_id: string; relationship?: string | null }[] = Array.isArray(r.company_links)
    ? r.company_links
    : [];
  return {
    id: r.id,
    fullName: r.full_name,
    category: r.category,
    role: r.role ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    linkedinUrl: r.linkedin_url ?? null,
    organizationId: r.organization_id ?? null,
    notes: r.notes ?? null,
    isActive: r.is_active !== false,
    businessCardAttachmentId: r.business_card_attachment_id ?? null,
    companyIds: Array.isArray(r.company_ids) ? r.company_ids : links.map((l) => l.company_id),
    companyLinks: links.map((l) => ({ companyId: l.company_id, relationship: l.relationship ?? null })),
    createdAt: r.created_at ?? "",
    createdBy: r.created_by ?? null,
  };
}
