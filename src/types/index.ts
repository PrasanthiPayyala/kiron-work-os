// Kiron Work OS — Frontend data contracts
// Mirrors a minimal future DB schema. Mock-only for now.

export type ID = string;
export type ISODate = string;

// ---------- Companies / Departments ----------
// ---------- Holidays ----------
export type HolidayType = "gazetted" | "optional" | "informational";

export interface Holiday {
  id: ID;
  /** NULL means it applies to every company. */
  companyId?: ID | null;
  /** ISO date (YYYY-MM-DD). */
  date: ISODate;
  name: string;
  type: HolidayType;
  notes?: string;
}

/** Working-hours schedule shared by Company default and per-user override.
 * workDays is ISO day numbers: 1=Mon, 2=Tue, …, 7=Sun. workStart and workEnd
 * are "HH:MM" strings. saturdayWeeksWorking restricts which Saturday-of-month
 * positions (1..5) are working when Sat (6) is in workDays — null means every
 * Saturday works (back-compat); [1,3,5] means 2nd & 4th Sat are off. */
export interface Schedule {
  workDays: number[];
  workStart: string;
  workEnd: string;
  saturdayWeeksWorking: number[] | null;
}

/** A director / board member on a company profile. `din` is the Indian
 * Director Identification Number (8 digits). Directors are formally
 * registered with the MCA. */
export interface Director {
  name: string;
  designation: string;
  din?: string | null;
}

/** An operational leadership member (CEO, COO, CTO, head of department,
 * advisory chair, etc.). Distinct from `Director` because no MCA
 * registration / DIN is involved — purely organisational. */
export interface LeadershipMember {
  name: string;
  designation: string;
}

/** A bank account a group entity holds. Lives in the company_bank_accounts
 * table; finance-scoped (HR can't see). One account per row; is_primary
 * marks the default for invoicing / salary debit. */
export interface CompanyBankAccount {
  id: ID;
  companyId: ID;
  bankName: string;
  accountNumber: string;
  ifsc?: string | null;
  branch?: string | null;
  accountType?: string | null;
  isPrimary: boolean;
  notes?: string | null;
}

/** Industry-specific licence (FSSAI, IATA, ITDC, SEBI, factory licence,
 * pollution control board, etc.). Stored as a jsonb list on the company. */
export interface IndustryLicence {
  licence_type: string;
  number: string;
  issued_at?: string | null;     // YYYY-MM-DD
  expires_at?: string | null;    // YYYY-MM-DD
}

export interface Company {
  id: ID;
  name: string;
  shortName: string;
  initials: string;
  color: string; // hsl token reference, e.g. "var(--primary)"
  domain?: string;
  code?: string | null;
  logoUrl?: string | null;
  isActive: boolean;
  /** Default schedule for everyone in the company. Profile overrides win
   * (see User.scheduleOverride). */
  schedule: Schedule;
  /** Profile fields captured by HR / founder office (migration 0009).
   * Every entry is nullable / optional — older companies have most of
   * these blank until somebody fills them in. */
  profile: {
    websiteUrls: string[];
    websiteTechnologies?: string | null;
    natureOfBusiness?: string | null;
    dateOfIncorporation?: ISODate | null;
    isStartup: boolean;
    // Registration / tax IDs
    cin?: string | null;
    gst?: string | null;
    pan?: string | null;
    tan?: string | null;
    tin?: string | null;
    msmeUdyamNumber?: string | null;
    msmeUdyamMobile?: string | null;
    msmeUdyamEmail?: string | null;
    dpiitStartupNumber?: string | null;
    // Addresses + phones
    registeredAddress?: string | null;
    corporateAddresses: string[];
    operationsAddresses: string[];
    phoneNumbers: string[];
    // Directors (legal — MCA-registered) + leadership (operational, no
    // DIN required) + per-entity founder principal designations.
    directors: Director[];
    leadership: LeadershipMember[];
    kiranDesignation?: string | null;
    prashantiDesignation?: string | null;
    // Compliance — managing CA contacts now live in the Contacts module
    // (linked via contact_companies with category='ca'). Migration 0011
    // dropped the single-CA columns; the page surfaces linked CAs as
    // read-only and editing happens through Contacts.
    certificates: string[];
    caDocumentsHeld: string[];
    // Statutory employer numbers (migration 0010) — these feed the
    // compliance-reminder calendar (PF/ESI monthly, PT half/yearly).
    esiNumber?: string | null;
    epfNumber?: string | null;
    professionalTaxNumber?: string | null;
    shopsEstablishmentNumber?: string | null;
    shopsEstablishmentExpiresAt?: ISODate | null;
    iecNumber?: string | null;
    industryLicences: IndustryLicence[];
  };
}

export interface Department {
  id: ID;
  name: string;
  companyId: ID;
}

// ---------- Users / Roles ----------
export type Role =
  | "super_admin"
  | "founder"
  | "founder_office_coordinator"
  | "founder_office_support"
  | "manager"
  | "employee"
  | "intern"
  | "hr_admin";

export type EmploymentType = "intern" | "contract" | "full_time" | "temporary" | "part_time";

export interface User {
  id: ID;
  name: string;
  email: string;
  role: Role;
  homeCompanyId: ID;
  departmentId?: ID;
  designation: string;
  reportingManagerId?: ID;
  reviewerId?: ID;
  avatarUrl?: string;
  initials: string;
  skills?: string[];
  status: "active" | "on_leave" | "inactive";
  employmentType: EmploymentType;
  isActive: boolean;
  mustChangePassword: boolean;
  /** Per-user opt-in to the Team Attendance follow-up page. Granted by
   * HR for TA / recruitment staff. Role-based access (super_admin /
   * founder / hr_admin / founder_office_coordinator) wins regardless. */
  attendanceFollowupAccess: boolean;
  /** Per-employee schedule override. Any field can be null to inherit just
   * that piece (e.g. same hours, custom days). saturdayWeeksWorking is the
   * Saturday-of-month restriction; null inherits the company value. */
  scheduleOverride?: {
    workDays: number[] | null;
    workStart: string | null;
    workEnd: string | null;
    saturdayWeeksWorking: number[] | null;
  };
  productivityScore?: number; // 0-100
  joinedAt: ISODate;
}

// ---------- Projects / Tasks ----------
export type Priority = "low" | "medium" | "high" | "critical";
export type Risk = "low" | "medium" | "high";
export type Visibility =
  | "team"
  | "company"
  | "department"
  | "manager_only"
  | "founder_office"
  | "founder_private";

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "at_risk";

export interface Project {
  id: ID;
  name: string;
  description?: string;
  companyId: ID;
  departmentId?: ID;
  ownerId: ID;
  memberIds: ID[];
  status: ProjectStatus;
  risk: Risk;
  progress: number; // 0-100
  startDate: ISODate;
  dueDate: ISODate;
  visibility: Visibility;
  isStrategic?: boolean;
  tags?: string[];
}

export type TaskStatus =
  | "draft"
  | "created"
  | "assigned"
  | "accepted"
  | "in_progress"
  | "waiting_review"
  | "waiting_approval"
  | "done"
  | "blocked"
  | "on_hold"
  | "rework"
  | "escalated"
  | "cancelled";

export type DependencyType = "blocked_by" | "starts_after" | "parallel";

export interface TaskDependency {
  id: ID;
  taskId: ID;
  relatedTaskId: ID;
  type: DependencyType;
}

export interface Recurrence {
  cadence: "daily" | "weekly" | "monthly" | "custom";
  interval?: number;
  weekdays?: number[];
  endsOn?: ISODate;
}

export interface Task {
  id: ID;
  key: string; // e.g. HEAL-104
  title: string;
  description?: string;
  projectId?: ID;
  companyId: ID;
  departmentId?: ID;
  assigneeId?: ID;
  reviewerId?: ID;
  reportingManagerId?: ID;
  createdById: ID;
  priority: Priority;
  status: TaskStatus;
  visibility: Visibility;
  labels?: string[];
  dueDate?: ISODate;
  slaHours?: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  recurrence?: Recurrence;
  dependencies?: TaskDependency[];
  attachments?: Attachment[];
  parentTaskId?: ID; // subtask support
  noUpdateDays?: number; // computed for views
}

export interface TaskActivity {
  id: ID;
  taskId: ID;
  actorId: ID;
  type:
    | "created"
    | "status_changed"
    | "reassigned"
    | "comment"
    | "approval_requested"
    | "approved"
    | "rejected"
    | "escalated"
    | "attachment_added";
  message: string;
  fromValue?: string;
  toValue?: string;
  createdAt: ISODate;
}

// ---------- Approvals ----------
export type ApprovalKind = "task_completion" | "content" | "project" | "leave";
export type ApprovalState = "pending" | "approved" | "rejected" | "returned";
export type ApprovalRoute =
  | "domain_only"
  | "domain_plus_manager"
  | "domain_plus_founder";

export interface Approval {
  id: ID;
  kind: ApprovalKind;
  refId: ID; // taskId / projectId / leaveId
  refLabel: string;
  requestedById: ID;
  approverId: ID;
  route?: ApprovalRoute;
  state: ApprovalState;
  note?: string;
  createdAt: ISODate;
  decidedAt?: ISODate;
}

// ---------- Attendance / Leave ----------
export type AttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "holiday"
  | "weekly_off"
  | "wfh"
  | "field_work"
  | "leave";

export interface AttendanceLog {
  id: ID;
  userId: ID;
  date: ISODate; // YYYY-MM-DD
  checkIn?: string; // HH:mm
  checkOut?: string;
  status: AttendanceStatus;
  workedHours?: number;
  source: "self" | "biometric" | "system";
}

export type LeaveType =
  | "casual"
  | "sick"
  | "loss_of_pay"
  | "wfh"
  | "comp_off"
  | "optional_holiday";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: ID;
  userId: ID;
  type: LeaveType;
  fromDate: ISODate;
  toDate: ISODate;
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedById?: ID;
  createdAt: ISODate;
}

// ---------- Chat ----------
export type ConversationKind = "dm" | "team_group" | "company_group" | "project_group" | "announcement";

export interface Conversation {
  id: ID;
  kind: ConversationKind;
  name: string;
  companyId?: ID;
  projectId?: ID;
  memberIds: ID[];
  lastMessageAt?: ISODate;
  lastMessagePreview?: string;
  /** Set from the current user's conversation_members.last_read_at on hydrate. */
  lastReadAt?: ISODate;
  unreadCount?: number;
  pinned?: boolean;
}

export interface MessageAttachmentMeta {
  id: ID;
  fileName: string;
  fileSize?: number | null;
  mimeType?: string | null;
}

export interface ConversationMember {
  conversationId: ID;
  userId: ID;
  role: "member" | "admin";
}

export interface Message {
  id: ID;
  conversationId: ID;
  senderId: ID;
  body: string;
  createdAt: ISODate;
  mentions?: ID[];
  taskRefId?: ID;
  /** Lightweight metadata returned alongside message rows; download via api.downloadFile(id). */
  attachments?: MessageAttachmentMeta[];
  /** Soft-delete tombstone. When set, the message body is suppressed in
   * the UI and replaced with "This message was deleted". */
  deletedAt?: ISODate | null;
  deletedBy?: ID | null;
  /** Only sent to founder + super_admin. List of user ids who have hidden
   * this message from their own view. UI renders a subtle "Hidden by X"
   * marker so the audit layer is visible at a glance. */
  hiddenBy?: ID[];
}

// ---------- Task reminders (kind=phone_call|in_person|other) ----------
export type TaskCallStatus = "scheduled" | "cancelled" | "done";
export type TaskCallKind = "phone_call" | "in_person" | "other";

export interface TaskCall {
  id: ID;
  taskId: ID;
  scheduledAt: ISODate;
  durationMins: number;
  kind: TaskCallKind;
  contact?: string | null;
  meetingLink?: string | null;
  notes?: string | null;
  status: TaskCallStatus;
  createdById?: ID | null;
  createdAt: ISODate;
  cancelledAt?: ISODate | null;
  cancelledById?: ID | null;
  participantIds: ID[];
}

// ---------- Misc ----------
export interface Attachment {
  id: ID;
  name: string;
  size: number;
  mimeType: string;
  url?: string;
  uploadedById: ID;
  uploadedAt: ISODate;
}

export interface Notification {
  id: ID;
  userId: ID;
  kind:
    | "due_today"
    | "overdue"
    | "no_update_1d"
    | "no_update_3d"
    | "pending_approval"
    | "recurring_upcoming"
    | "mention"
    | "announcement"
    | "reminder"
    | "general";
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: ISODate;
}

// ---------- Contacts & Organizations ----------
export type ContactCategory =
  // Compliance
  | "ca" | "cs" | "auditor" | "lawyer" | "banker" | "insurance" | "investor" | "govt_official"
  // Business
  | "client_poc" | "vendor_poc" | "channel_partner" | "collaborator"
  | "advisor" | "mentor" | "press" | "industry_body"
  // Recruitment
  | "college" | "tpo" | "training_institute" | "recruitment_agency"
  // IT / Vendor
  | "domain_registrar" | "hosting_saas" | "agency"
  | "other";

export interface Organization {
  id: ID;
  name: string;
  type?: string | null;
  website?: string | null;
  address?: string | null;
  gstin?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: ISODate;
  createdBy?: ID | null;
}

export interface ContactCompanyLink {
  companyId: ID;
  relationship?: string | null;
}

export interface Contact {
  id: ID;
  fullName: string;
  category: ContactCategory;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  organizationId?: ID | null;
  notes?: string | null;
  isActive: boolean;
  businessCardAttachmentId?: ID | null;
  companyIds: ID[];
  companyLinks: ContactCompanyLink[];
  createdAt: ISODate;
  createdBy?: ID | null;
}
