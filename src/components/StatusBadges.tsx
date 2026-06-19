import { cn } from "@/lib/utils";
import type { Priority, Risk, TaskStatus, ProjectStatus, AttendanceStatus, LeaveStatus, ApprovalState } from "@/types";

const taskStatusMap: Record<TaskStatus, { label: string; cls: string }> = {
  draft:             { label: "Draft",            cls: "bg-status-draft/10 text-status-draft border-status-draft/30" },
  created:           { label: "Created",          cls: "bg-status-created/10 text-status-created border-status-created/30" },
  assigned:          { label: "Assigned",         cls: "bg-status-assigned/10 text-status-assigned border-status-assigned/30" },
  accepted:          { label: "Accepted",         cls: "bg-status-accepted/10 text-status-accepted border-status-accepted/30" },
  in_progress:       { label: "In Progress",      cls: "bg-status-progress/10 text-status-progress border-status-progress/30" },
  waiting_review:    { label: "Waiting Review",   cls: "bg-status-review/10 text-status-review border-status-review/30" },
  waiting_approval:  { label: "Waiting Approval", cls: "bg-status-approval/10 text-status-approval border-status-approval/30" },
  done:              { label: "Done",             cls: "bg-status-done/10 text-status-done border-status-done/30" },
  blocked:           { label: "Blocked",          cls: "bg-status-blocked/10 text-status-blocked border-status-blocked/30" },
  on_hold:           { label: "On Hold",          cls: "bg-status-hold/10 text-status-hold border-status-hold/30" },
  rework:            { label: "Rework",           cls: "bg-status-rework/10 text-status-rework border-status-rework/30" },
  escalated:         { label: "Escalated",        cls: "bg-status-escalated/10 text-status-escalated border-status-escalated/30" },
  cancelled:         { label: "Cancelled",        cls: "bg-status-cancelled/10 text-status-cancelled border-status-cancelled/30" },
};

const projectStatusMap: Record<ProjectStatus, { label: string; cls: string }> = {
  planning:  { label: "Planning",  cls: "bg-muted text-muted-foreground border-border" },
  active:    { label: "Active",    cls: "bg-status-progress/10 text-status-progress border-status-progress/30" },
  on_hold:   { label: "On Hold",   cls: "bg-status-hold/10 text-status-hold border-status-hold/30" },
  completed: { label: "Completed", cls: "bg-status-done/10 text-status-done border-status-done/30" },
  at_risk:   { label: "At Risk",   cls: "bg-status-blocked/10 text-status-blocked border-status-blocked/30" },
};

const priorityMap: Record<Priority, { label: string; cls: string }> = {
  low:      { label: "Low",      cls: "bg-muted text-muted-foreground border-border" },
  medium:   { label: "Medium",   cls: "bg-info/10 text-info border-info/30" },
  high:     { label: "High",     cls: "bg-primary/10 text-primary border-primary/30" },
  critical: { label: "Critical", cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

const riskMap: Record<Risk, { label: string; cls: string }> = {
  low:    { label: "Low Risk",    cls: "bg-success/10 text-success border-success/30" },
  medium: { label: "Medium Risk", cls: "bg-warning/10 text-warning-foreground border-warning/30" },
  high:   { label: "High Risk",   cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

const attendanceMap: Record<AttendanceStatus, { label: string; cls: string }> = {
  present:    { label: "Present",    cls: "bg-success/10 text-success border-success/30" },
  absent:     { label: "Absent",     cls: "bg-destructive/10 text-destructive border-destructive/30" },
  half_day:   { label: "Half Day",   cls: "bg-warning/10 text-warning-foreground border-warning/30" },
  holiday:    { label: "Holiday",    cls: "bg-accent/10 text-accent border-accent/30" },
  weekly_off: { label: "Weekly Off", cls: "bg-muted text-muted-foreground border-border" },
  wfh:        { label: "WFH",        cls: "bg-info/10 text-info border-info/30" },
  field_work: { label: "Field work", cls: "bg-info/15 text-info border-info/40" },
  leave:      { label: "Leave",      cls: "bg-status-leave/10 text-status-leave border-status-leave/30" },
};

const leaveMap: Record<LeaveStatus, { label: string; cls: string }> = {
  pending:   { label: "Pending",   cls: "bg-warning/10 text-warning-foreground border-warning/30" },
  approved:  { label: "Approved",  cls: "bg-success/10 text-success border-success/30" },
  rejected:  { label: "Rejected",  cls: "bg-destructive/10 text-destructive border-destructive/30" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
};

const approvalMap: Record<ApprovalState, { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-warning/10 text-warning-foreground border-warning/30" },
  approved: { label: "Approved", cls: "bg-success/10 text-success border-success/30" },
  rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  returned: { label: "Returned", cls: "bg-status-rework/10 text-status-rework border-status-rework/30" },
};

const baseCls = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const m = taskStatusMap[status];
  return <span className={cn(baseCls, m.cls, className)}>{m.label}</span>;
}
export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const m = projectStatusMap[status];
  return <span className={cn(baseCls, m.cls, className)}>{m.label}</span>;
}
export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const m = priorityMap[priority];
  return <span className={cn(baseCls, m.cls, className)}>{m.label}</span>;
}
export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  const m = riskMap[risk];
  return <span className={cn(baseCls, m.cls, className)}>{m.label}</span>;
}
export function AttendanceBadge({ status, className }: { status: AttendanceStatus; className?: string }) {
  const m = attendanceMap[status];
  return <span className={cn(baseCls, m.cls, className)}>{m.label}</span>;
}
export function LeaveStatusBadge({ status, className }: { status: LeaveStatus; className?: string }) {
  const m = leaveMap[status];
  return <span className={cn(baseCls, m.cls, className)}>{m.label}</span>;
}
export function ApprovalStateBadge({ state, className }: { state: ApprovalState; className?: string }) {
  const m = approvalMap[state];
  return <span className={cn(baseCls, m.cls, className)}>{m.label}</span>;
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  const map: Record<string, string> = {
    team: "Team",
    company: "Company",
    department: "Department",
    manager_only: "Manager Only",
    founder_office: "Founder Office",
    founder_private: "Founder Private",
  };
  return (
    <span className={cn(baseCls, "bg-surface-muted text-muted-foreground border-border")}>
      {map[visibility] ?? visibility}
    </span>
  );
}
