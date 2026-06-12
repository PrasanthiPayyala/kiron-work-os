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
 * Director Identification Number (8 digits). */
export interface Director {
  name: string;
  designation: string;
  din?: string | null;
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
    // Directors + per-entity founder designations
    directors: Director[];
    kiranDesignation?: string | null;
    prashantiDesignation?: string | null;
    // Compliance
    certificates: string[];
    managingCaName?: string | null;
    managingCaPhone?: string | null;
    managingCaEmail?: string | null;
    caDocumentsHeld: string[];
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
    | "announcement";
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: ISODate;
}
