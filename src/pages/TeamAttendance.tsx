// Team Attendance / Follow-up — only the rows that need HR's attention
// today land in `need_followup` (late + no-show past grace, or early
// checkout without a half-day/WFH excuse). People who simply haven't
// arrived yet sit in `not_yet_arrived` as an info count so HR isn't
// chasing the team at 9 a.m.
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Mail, Phone, RefreshCw, Loader2, AlertTriangle, LogOut, Clock, LogIn, Plane, MapPin, Plus, Download } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { toast as sonner } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GrantPermissionDialog } from "@/components/attendance/GrantPermissionDialog";
import { useSearchParams } from "react-router-dom";

type LeaveTypeKey = "casual_leave" | "sick_leave" | "loss_of_pay" | "comp_off" | "optional_holiday";
// UI option value can be a leave_type OR the synthetic 'comp_off_advance'
// key which maps to leave_type=comp_off but with a reason auto-prefix so
// audit can tell "took an existing balance" from "owes a future off-day."
type LeaveUiKey = LeaveTypeKey | "comp_off_advance";
const COMP_OFF_ADVANCE_PREFIX = "[Comp-off advance — repay later] ";
const LEAVE_TYPE_OPTIONS: { value: LeaveUiKey; label: string }[] = [
  { value: "casual_leave",      label: "Casual" },
  { value: "sick_leave",        label: "Sick" },
  { value: "comp_off",          label: "Comp off (already earned)" },
  { value: "comp_off_advance",  label: "Comp off (repay later)" },
  { value: "loss_of_pay",       label: "Unpaid leave" },
  { value: "optional_holiday",  label: "Optional holiday" },
];

type Row = {
  user_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  home_company_id?: string | null;
  reporting_manager_id?: string | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  check_in_status?: string | null;
  leave_type?: string | null;
  reason?: "missed_check_in" | "left_early";
  minutes_early?: number;
  expected_by?: string;
  /** True when this person's check-in was outside their assigned office's
   *  geofence. Renders the "📍 outside office" chip on Present rows. */
  geo_outside_office?: boolean;
  /** Sum of idle minutes today (≥30 min gaps detected by the client).
   *  Surfaced as a small "· idle Xm" suffix in the row metadata. */
  idle_minutes?: number;
  /** Which client posted the check-in — surfaces as a "Web" / "Desktop"
   *  chip so HR can spot rows that came from the presence agent vs.
   *  someone tapping Check In in the PWA. */
  source?: string | null;
  /** Bumped by the desktop agent every ~5 min while it's running. Used
   *  to render "🟢 Desktop" (live) vs "⚪ Desktop" (stale) — a stale
   *  heartbeat > 15 min old means the agent stopped reporting mid-day. */
  last_heartbeat_at?: string | null;
};

type FollowupResponse = {
  date: string;
  iso_weekday: number;
  now: string;
  totals: { need_followup: number; present: number; not_yet_arrived: number; on_leave: number; off_today: number };
  need_followup: Row[];
  present: Row[];
  not_yet_arrived: Row[];
  on_leave: Row[];
  off_today: Row[];
};

const today = () => new Date().toISOString().slice(0, 10);
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

export default function TeamAttendance() {
  const { companies, getUser, getCompany, attendance, attendancePermissions, leaveRequests, refresh } = useDataStore();
  const { toast } = useToast();
  const [date, setDate] = useState<string>(today());
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [data, setData] = useState<FollowupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumingUserId, setResumingUserId] = useState<string | null>(null);
  const [markingLeaveUserId, setMarkingLeaveUserId] = useState<string | null>(null);
  const [decidingCompOffId, setDecidingCompOffId] = useState<string | null>(null);
  const [decidingPermId, setDecidingPermId] = useState<string | null>(null);
  const [decidingLeaveId, setDecidingLeaveId] = useState<string | null>(null);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [searchParams] = useSearchParams();
  // Deep-link support: /team-attendance?tab=pending_leave opens that tab.
  const initialTab = searchParams.get("tab") || "need_followup";

  const load = async (d: string) => {
    setLoading(true);
    try {
      const res = await api.attendanceFollowup(d) as unknown as FollowupResponse;
      setData(res);
    } catch (e) {
      toast({
        title: "Couldn't load follow-up",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(date); /* eslint-disable-next-line */ }, [date]);

  // Find the attendance_logs row id for (user, date) so the HR Resume action
  // can PATCH it. The dataStore preloads all attendance logs the viewer is
  // allowed to see (HR / founder-office roles get everyone via the backend's
  // ATTENDANCE_VIEW_ROLES gate), so this is a local Map lookup.
  const findLogId = (userId: string, d: string): string | undefined =>
    attendance.find((a) => a.userId === userId && a.date === d)?.id;

  const handleResume = async (userId: string, name: string) => {
    const logId = findLogId(userId, date);
    if (!logId) {
      sonner.error(`Couldn't find ${name}'s log for ${date}`);
      return;
    }
    setResumingUserId(userId);
    try {
      await api.updateAttendance(logId, { check_out_at: null });
      sonner.success(`${name} resumed — clocked back in`);
      refresh();
      void load(date);
    } catch (e) {
      sonner.error(e instanceof ApiError ? e.message : `Couldn't resume ${name}`);
    } finally {
      setResumingUserId(null);
    }
  };

  // HR flips a missed-check-in row into an approved-leave row. The
  // backend creates BOTH the attendance log AND the leave_requests row
  // (and bumps the balance) so payroll's day-by-day rollup picks it up.
  // Core mark-as-leave call shared by the inline popover (always for
  // the page's selected `date`) and the page-level dialog (any user /
  // any date). repayBy is only sent when uiKey === 'comp_off_advance'.
  //
  // On 409 (existing attendance log for the date) we prompt to overwrite
  // and retry — the backend refunds the prior balance + replaces the
  // pair atomically when overwrite=true. Lets HR fix a mistyped leave
  // type without resorting to a manual PATCH.
  const markLeaveCore = async (
    userId: string, name: string,
    workDate: string,
    uiKey: LeaveUiKey, reason: string,
    repayBy?: string | null,
  ) => {
    // 'comp_off_advance' is a UI-only key — backend stores it as a
    // regular comp_off leave with the advance prefix in the reason so
    // audit + reports can tell the two apart. Negative balance is what
    // actually represents the IOU.
    const isAdvance = uiKey === "comp_off_advance";
    const dbLeaveType: LeaveTypeKey = isAdvance ? "comp_off" : uiKey;
    const trimmed = reason.trim();
    const finalReason = isAdvance
      ? (COMP_OFF_ADVANCE_PREFIX + (trimmed || "—")).trim()
      : (trimmed || null);
    const payload = {
      user_id: userId,
      work_date: workDate,
      leave_type: dbLeaveType,
      reason: finalReason,
      comp_off_repay_by: isAdvance && repayBy ? repayBy : null,
    };
    const label = LEAVE_TYPE_OPTIONS.find((o) => o.value === uiKey)?.label ?? uiKey;
    try {
      await api.markAttendanceAsLeave(payload);
      sonner.success(`${name} marked on ${label} for ${workDate}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const ok = window.confirm(
          `${name} already has an entry for ${workDate}. Overwrite it with "${label}"?\n\n` +
          "The previous leave row's balance will be refunded before the new one is applied.",
        );
        if (!ok) return;
        await api.markAttendanceAsLeave({ ...payload, overwrite: true });
        sonner.success(`${name} overwritten — now on ${label} for ${workDate}`);
      } else {
        throw e;
      }
    }
    refresh();
    void load(date);
  };

  const handleMarkAsLeave = async (userId: string, name: string,
                                    uiKey: LeaveUiKey, reason: string,
                                    repayBy?: string | null) => {
    setMarkingLeaveUserId(userId);
    try {
      await markLeaveCore(userId, name, date, uiKey, reason, repayBy);
    } catch (e) {
      sonner.error(e instanceof ApiError ? e.message : `Couldn't mark ${name} on leave`);
    } finally {
      setMarkingLeaveUserId(null);
    }
  };

  const filterByCompany = (rows: Row[]) =>
    companyFilter === "all" ? rows : rows.filter((r) => r.home_company_id === companyFilter);

  const needFollowup = useMemo(() => filterByCompany(data?.need_followup ?? []), [data, companyFilter]);
  const present = useMemo(() => filterByCompany(data?.present ?? []), [data, companyFilter]);
  const notYetArrived = useMemo(() => filterByCompany(data?.not_yet_arrived ?? []), [data, companyFilter]);
  const onLeave = useMemo(() => filterByCompany(data?.on_leave ?? []), [data, companyFilter]);
  const offToday = useMemo(() => filterByCompany(data?.off_today ?? []), [data, companyFilter]);

  // Pending comp-offs across the whole roster (not just `date`) so HR
  // sees what's been queued up. Sourced from the local dataStore — HR
  // already gets every attendance log via the backend's ATTENDANCE_VIEW
  // gate, so no extra fetch needed.
  const pendingCompOffs = useMemo(() => {
    const list = attendance
      .filter((a) => a.compOffStatus === "pending" && (a.compOffEarned ?? 0) > 0)
      .map((a) => {
        const u = getUser(a.userId);
        return {
          log_id: a.id,
          user_id: a.userId,
          name: u?.name ?? "Unknown",
          designation: u?.designation,
          home_company_id: u?.homeCompanyId,
          work_date: a.date,
          earned: a.compOffEarned ?? 0,
        };
      })
      .filter((r) => companyFilter === "all" || r.home_company_id === companyFilter)
      .sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
    return list;
  }, [attendance, getUser, companyFilter]);

  const decideCompOff = async (
    logId: string, name: string, decision: "approved" | "denied",
  ) => {
    setDecidingCompOffId(logId);
    try {
      await api.decideCompOff(logId, { decision });
      sonner.success(
        decision === "approved"
          ? `Comp-off approved for ${name}`
          : `Comp-off denied for ${name}`,
      );
      refresh();
    } catch (e) {
      sonner.error(e instanceof ApiError ? e.message : "Couldn't decide comp-off");
    } finally {
      setDecidingCompOffId(null);
    }
  };

  // Pending attendance permissions across the whole roster. Sourced from
  // the local dataStore — HR gets the full list via bootstrap thanks to
  // elevated_hr scoping. Sorted by date desc so today's bubble to the top.
  const pendingPermissions = useMemo(() => {
    return attendancePermissions
      .filter((p) => p.status === "pending")
      .map((p) => {
        const u = getUser(p.userId);
        return { ...p, name: u?.name ?? "Unknown", designation: u?.designation, home_company_id: u?.homeCompanyId };
      })
      .filter((p) => companyFilter === "all" || p.home_company_id === companyFilter)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [attendancePermissions, getUser, companyFilter]);

  const decidePermission = async (
    permId: string, name: string, decision: "approved" | "rejected",
  ) => {
    setDecidingPermId(permId);
    try {
      await api.decideAttendancePermission(permId, { decision });
      sonner.success(
        decision === "approved"
          ? `Permission approved for ${name}`
          : `Permission rejected for ${name}`,
      );
      refresh();
    } catch (e) {
      sonner.error(e instanceof ApiError ? e.message : "Couldn't decide permission");
    } finally {
      setDecidingPermId(null);
    }
  };

  // Pending leave requests across the whole roster. Sourced from the
  // dataStore — HR scope hydrates every pending row via bootstrap.
  // Sorted by start_date asc so the soonest-starting bubble to the top
  // (most time-sensitive to decide).
  const pendingLeaves = useMemo(() => {
    return leaveRequests
      .filter((l) => l.status === "pending")
      .map((l) => {
        const u = getUser(l.userId);
        return {
          ...l,
          name: u?.name ?? "Unknown",
          designation: u?.designation,
          home_company_id: u?.homeCompanyId,
        };
      })
      .filter((l) => companyFilter === "all" || l.home_company_id === companyFilter)
      .sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
  }, [leaveRequests, getUser, companyFilter]);

  const decideLeave = async (
    leaveId: string, name: string, decision: "approved" | "rejected",
  ) => {
    setDecidingLeaveId(leaveId);
    try {
      await api.updateLeave(leaveId, { status: decision });
      sonner.success(
        decision === "approved"
          ? `Leave approved for ${name}`
          : `Leave rejected for ${name}`,
      );
      refresh();
    } catch (e) {
      sonner.error(e instanceof ApiError ? e.message : "Couldn't decide leave");
    } finally {
      setDecidingLeaveId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Team Attendance"
        description="Today's check-in status. Need follow-up = late no check-in, or checked out before end-of-day without WFH / half day / field work / approved leave."
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load(date)} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Date:</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 w-[150px]"
            />
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDate(today())}>
              Today
            </Button>
          </div>

          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="All companies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.filter((c) => c.isActive).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {notYetArrived.length > 0 && (
            <div className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {notYetArrived.length} yet to check in
            </div>
          )}
        </div>

        <Tabs defaultValue={initialTab}>
          <TabsList>
            <TabsTrigger value="need_followup" className="gap-1.5">
              Need follow-up
              <Badge variant={needFollowup.length > 0 ? "destructive" : "secondary"} className="ml-1 text-[10px]">{needFollowup.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="present" className="gap-1.5">
              Present
              <Badge variant="secondary" className="ml-1 text-[10px]">{present.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="on_leave" className="gap-1.5">
              On leave
              <Badge variant="secondary" className="ml-1 text-[10px]">{onLeave.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="pending_leave" className="gap-1.5">
              Pending leave
              <Badge variant={pendingLeaves.length > 0 ? "destructive" : "secondary"} className="ml-1 text-[10px]">
                {pendingLeaves.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="off_today" className="gap-1.5">
              Off today
              <Badge variant="secondary" className="ml-1 text-[10px]">{offToday.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="comp_off" className="gap-1.5">
              Comp-off pending
              <Badge variant={pendingCompOffs.length > 0 ? "destructive" : "secondary"} className="ml-1 text-[10px]">
                {pendingCompOffs.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1.5">
              Permissions
              <Badge variant={pendingPermissions.length > 0 ? "destructive" : "secondary"} className="ml-1 text-[10px]">
                {pendingPermissions.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="hours" className="gap-1.5">
              Hours
            </TabsTrigger>
          </TabsList>

          <TabsContent value="need_followup">
            <PersonList
              rows={needFollowup}
              getCompany={getCompany}
              getUser={getUser}
              emptyText="Nobody to chase right now. ✓"
              variant="alert"
              onResume={handleResume}
              resumingUserId={resumingUserId}
              onMarkLeave={handleMarkAsLeave}
              markingLeaveUserId={markingLeaveUserId}
            />
          </TabsContent>
          <TabsContent value="present">
            <PersonList
              rows={present} getCompany={getCompany} getUser={getUser}
              emptyText="No check-ins yet."
              onMarkLeave={handleMarkAsLeave}
              markingLeaveUserId={markingLeaveUserId}
            />
          </TabsContent>
          <TabsContent value="on_leave">
            <PersonList
              rows={onLeave} getCompany={getCompany} getUser={getUser}
              emptyText="No one on leave today."
              onMarkLeave={handleMarkAsLeave}
              markingLeaveUserId={markingLeaveUserId}
            />
          </TabsContent>
          <TabsContent value="pending_leave">
            <p className="mt-4 mb-3 text-xs text-muted-foreground">
              Pending leave applications across the roster. Approving counts
              the days against the employee's balance and surfaces them on
              the "On leave" tab on the relevant dates.
            </p>
            {pendingLeaves.length === 0 ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">No leaves waiting on you. ✓</p>
            ) : (
              <ul className="mt-4 divide-y divide-border rounded-lg border bg-surface">
                {pendingLeaves.map((l) => {
                  const co = l.home_company_id ? getCompany(l.home_company_id) : null;
                  const busy = decidingLeaveId === l.id;
                  const sameDay = l.fromDate === l.toDate;
                  const dateLabel = sameDay ? l.fromDate : `${l.fromDate} → ${l.toDate}`;
                  const typeLabel = LEAVE_TYPE_OPTIONS.find((o) => o.value === l.type)?.label
                    ?? l.type.replace(/_/g, " ");
                  return (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{l.name}</p>
                          <Badge variant="secondary" className="text-[10px]">{typeLabel}</Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {l.days} day{l.days === 1 ? "" : "s"}
                          </Badge>
                          {co && <Badge variant="outline" className="text-[10px]">{co.shortName || co.name}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {l.designation && <>{l.designation} · </>}
                          For <b>{dateLabel}</b>
                          {l.reason && <> · {l.reason}</>}
                          {l.compOffRepayBy && <> · repay by <b>{l.compOffRepayBy}</b></>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => void decideLeave(l.id, l.name, "rejected")}
                          className="gap-1.5">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Reject
                        </Button>
                        <Button size="sm" disabled={busy}
                          onClick={() => void decideLeave(l.id, l.name, "approved")}
                          className="gap-1.5">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Approve
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="off_today">
            <PersonList
              rows={offToday} getCompany={getCompany} getUser={getUser}
              emptyText="Everyone is working today."
              onMarkLeave={handleMarkAsLeave}
              markingLeaveUserId={markingLeaveUserId}
            />
          </TabsContent>
          <TabsContent value="comp_off">
            {pendingCompOffs.length === 0 ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">No comp-offs waiting on you. ✓</p>
            ) : (
              <ul className="mt-4 divide-y divide-border rounded-lg border bg-surface">
                {pendingCompOffs.map((r) => {
                  const co = r.home_company_id ? getCompany(r.home_company_id) : null;
                  const busy = decidingCompOffId === r.log_id;
                  return (
                    <li key={r.log_id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{r.name}</p>
                          <Badge variant="secondary" className="text-[10px]">
                            {r.earned} day{r.earned === 1 ? "" : "s"}
                          </Badge>
                          {co && <Badge variant="outline" className="text-[10px]">{co.shortName || co.name}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.designation && <>{r.designation} · </>}
                          Worked off-day <b>{r.work_date}</b>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void decideCompOff(r.log_id, r.name, "denied")}
                          className="gap-1.5"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Deny
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void decideCompOff(r.log_id, r.name, "approved")}
                          className="gap-1.5"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Approve
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="permissions">
            <div className="mt-4 mb-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Pending requests filed by employees. Use <b>Grant</b> to record
                a permission you approved over WhatsApp / in person — it lands
                pre-approved without going through the queue.
              </p>
              <Button size="sm" className="gap-1.5" onClick={() => setGrantDialogOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Grant permission
              </Button>
            </div>
            {pendingPermissions.length === 0 ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">No permissions waiting on you. ✓</p>
            ) : (
              <ul className="mt-4 divide-y divide-border rounded-lg border bg-surface">
                {pendingPermissions.map((p) => {
                  const co = p.home_company_id ? getCompany(p.home_company_id) : null;
                  const busy = decidingPermId === p.id;
                  const kindLabel = p.kind === "late_in" ? "Late arrival"
                    : p.kind === "early_out" ? "Early logout" : "Mid-day step-out";
                  const hours = Math.floor(p.minutes / 60);
                  const mins = p.minutes % 60;
                  const dur = hours ? (mins ? `${hours}h${mins}m` : `${hours}h`) : `${mins}m`;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{p.name}</p>
                          <Badge variant="secondary" className="text-[10px]">{kindLabel}</Badge>
                          <Badge variant="outline" className="text-[10px]">{dur}</Badge>
                          {co && <Badge variant="outline" className="text-[10px]">{co.shortName || co.name}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {p.designation && <>{p.designation} · </>}
                          For <b>{p.date}</b>
                          {p.reason && <> · {p.reason}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => void decidePermission(p.id, p.name, "rejected")}
                          className="gap-1.5">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Reject
                        </Button>
                        <Button size="sm" disabled={busy}
                          onClick={() => void decidePermission(p.id, p.name, "approved")}
                          className="gap-1.5">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Approve
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="hours">
            <HoursRosterTable companyFilter={companyFilter} />
          </TabsContent>
        </Tabs>
      </div>

      <GrantPermissionDialog
        open={grantDialogOpen}
        onClose={() => setGrantDialogOpen(false)}
        onGranted={() => refresh()}
      />
    </div>
  );
}

// ----- Roster-wide hours rollup -------------------------------------------
// Pulls /attendance-permissions/hours-summary/roster — one row per active
// employee for the chosen month, sorted by shortfall descending so the
// people who owe the most hours bubble to the top of HR's review.
function HoursRosterTable({ companyFilter }: { companyFilter: string }) {
  const { getUser } = useDataStore();
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.attendanceHoursSummaryRoster>>>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = async (m: string) => {
    setLoading(true);
    try {
      const r = await api.attendanceHoursSummaryRoster(m);
      setRows(r);
    } catch (e) {
      sonner.error(e instanceof ApiError ? e.message : "Couldn't load hours rollup");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(month); /* eslint-disable-next-line */ }, [month]);

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      await api.downloadAttendanceMonthlyCsv(month, companyFilter === "all" ? undefined : companyFilter);
      sonner.success(`Downloaded attendance-${month}.csv`);
    } catch (e) {
      sonner.error(e instanceof ApiError ? e.message : "Couldn't download CSV");
    } finally {
      setDownloading(false);
    }
  };

  const filtered = useMemo(() => {
    return rows
      .filter((r) => {
        if (companyFilter === "all") return true;
        const u = getUser(r.user_id);
        return u?.homeCompanyId === companyFilter;
      })
      .sort((a, b) => b.net_shortfall_hours - a.net_shortfall_hours);
  }, [rows, companyFilter, getUser]);

  const formatHM = (h: number) => {
    const whole = Math.floor(h);
    const m = Math.round((h - whole) * 60);
    if (whole === 0 && m === 0) return "0h";
    return m === 0 ? `${whole}h` : `${whole}h${m}m`;
  };

  return (
    <div className="mt-4 rounded-lg border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Month:</span>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 w-[180px] cursor-pointer pr-2"
          />
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-muted-foreground">
            Expected after leave + permission. Shortfall = expected − worked.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={downloadCsv}
            disabled={downloading}
            title="Download a per-employee CSV of presence days, leave by type, hours worked, and shortfall — payroll input"
          >
            {downloading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
            Download CSV
          </Button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No data for this month.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Employee</th>
              <th className="px-3 py-2 text-right font-medium">Expected</th>
              <th className="px-3 py-2 text-right font-medium">Worked</th>
              <th className="px-3 py-2 text-right font-medium">Idle</th>
              <th className="px-3 py-2 text-right font-medium">Permissions</th>
              <th className="px-3 py-2 text-right font-medium">Shortfall</th>
              <th className="px-3 py-2 text-right font-medium">Surplus</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.user_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatHM(r.net_expected_hours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatHM(r.actual_hours)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.idle_minutes > 0 ? `${r.idle_minutes}m` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.permission_minutes}m</td>
                <td className="px-3 py-2 text-right tabular-nums text-destructive">{r.net_shortfall_hours > 0 ? formatHM(r.net_shortfall_hours) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-success">{r.net_surplus_hours > 0 ? formatHM(r.net_surplus_hours) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PersonList({
  rows, getCompany, getUser, emptyText, variant,
  onResume, resumingUserId,
  onMarkLeave, markingLeaveUserId,
}: {
  rows: Row[];
  getCompany: ReturnType<typeof useDataStore>["getCompany"];
  getUser: ReturnType<typeof useDataStore>["getUser"];
  emptyText: string;
  variant?: "alert";
  onResume?: (userId: string, name: string) => Promise<void>;
  resumingUserId?: string | null;
  onMarkLeave?: (
    userId: string, name: string, leaveType: LeaveUiKey, reason: string,
    repayBy?: string | null,
  ) => Promise<void>;
  markingLeaveUserId?: string | null;
}) {
  if (rows.length === 0) {
    return <p className="mt-4 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="mt-4 divide-y divide-border rounded-lg border bg-surface">
      {rows.map((r) => {
        const co = r.home_company_id ? getCompany(r.home_company_id) : null;
        const mgr = r.reporting_manager_id ? getUser(r.reporting_manager_id) : null;
        const reasonChip = r.reason === "missed_check_in"
          ? <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="h-2.5 w-2.5" />Missed check-in</Badge>
          : r.reason === "left_early"
            ? <Badge variant="destructive" className="gap-1 text-[10px]"><LogOut className="h-2.5 w-2.5" />Left {r.minutes_early}m early</Badge>
            : null;
        return (
          <li key={r.user_id} className={`flex flex-wrap items-center justify-between gap-3 p-3.5 ${variant === "alert" ? "" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{r.name}</p>
                {reasonChip}
                {r.check_in_status && !r.reason && <Badge variant="outline" className="text-[10px] capitalize">{r.check_in_status.replace("_", " ")}</Badge>}
                {r.leave_type && <Badge variant="secondary" className="text-[10px] capitalize">{r.leave_type.replace("_", " ")}</Badge>}
                {r.geo_outside_office && (
                  <Badge variant="destructive" className="gap-1 text-[10px]">
                    <MapPin className="h-2.5 w-2.5" /> outside office
                  </Badge>
                )}
                {r.source === "desktop_agent" && (
                  <Badge
                    variant="outline"
                    className="gap-1 text-[10px]"
                    title={
                      r.last_heartbeat_at
                        ? `Last heartbeat ${fmtTime(r.last_heartbeat_at)}`
                        : "Presence client — no heartbeat yet"
                    }
                  >
                    <span
                      className={
                        r.last_heartbeat_at &&
                        Date.now() - new Date(r.last_heartbeat_at).getTime() < 15 * 60 * 1000
                          ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                          : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                      }
                    />
                    Desktop
                  </Badge>
                )}
                {r.check_in_at && r.source && r.source !== "desktop_agent" && (
                  <Badge variant="outline" className="text-[10px]">Web</Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {r.designation && <>{r.designation} · </>}
                {co && <>{co.shortName || co.name}</>}
                {mgr && <> · Manager: {mgr.name}</>}
                {r.check_in_at && <> · In {fmtTime(r.check_in_at)}</>}
                {r.check_out_at && <> · Out {fmtTime(r.check_out_at)}</>}
                {!!r.idle_minutes && r.idle_minutes > 0 && (
                  <> · idle {r.idle_minutes}m</>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Resume work — undoes an accidental early check-out. Only relevant
                  for left_early rows; missed-check-in rows have no check_out yet. */}
              {onResume && r.reason === "left_early" && r.check_out_at && (
                <button
                  type="button"
                  onClick={() => void onResume(r.user_id, r.name)}
                  disabled={resumingUserId === r.user_id}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-muted disabled:opacity-60"
                  title="Reverse this check-out — lets them clock back in"
                >
                  {resumingUserId === r.user_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                  Resume
                </button>
              )}
              {/* Mark as leave — shown on every row across every tab.
                  Backend creates the attendance log + an approved
                  leave_request + bumps the balance. If a log already
                  exists for the (user, date) the API 409s and we toast
                  the error so HR knows to PATCH that row instead. */}
              {onMarkLeave && (
                <MarkLeavePopover
                  busy={markingLeaveUserId === r.user_id}
                  onMark={(lt, reason, repayBy) => onMarkLeave(r.user_id, r.name, lt, reason, repayBy)}
                />
              )}
              {r.email && (
                <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-muted" title={r.email}>
                  <Mail className="h-3 w-3" /> Email
                </a>
              )}
              {r.phone && (
                <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-muted" title={r.phone}>
                  <Phone className="h-3 w-3" /> Call
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MarkLeavePopover({
  busy, onMark,
}: {
  busy: boolean;
  onMark: (leaveType: LeaveUiKey, reason: string, repayBy?: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveUiKey>("casual_leave");
  const [reason, setReason] = useState("");
  const [repayBy, setRepayBy] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-muted disabled:opacity-60"
          title="Mark this missed check-in as an approved leave for the day"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plane className="h-3 w-3" />}
          Mark as leave
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mark as leave</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Creates an approved leave for the day and bumps the balance.
              Employee's calendar updates immediately.
            </p>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Leave type</label>
            <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveUiKey)}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {leaveType === "comp_off_advance" && (
              <>
                <p className="mt-1 text-[10px] text-warning">
                  IOU — comp-off balance will go negative until repaid.
                </p>
                <div className="mt-1.5">
                  <label className="text-[10px] text-muted-foreground">Plan to work which day to repay? (optional)</label>
                  <input
                    type="date"
                    value={repayBy}
                    onChange={(e) => setRepayBy(e.target.value)}
                    className="mt-0.5 h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                  />
                </div>
              </>
            )}
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Reason (optional)</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Phoned in sick, family emergency..."
              className="mt-1 h-8 text-xs"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={busy}
              onClick={async () => {
                await onMark(leaveType, reason, leaveType === "comp_off_advance" ? repayBy : null);
                setOpen(false);
                setReason("");
                setRepayBy("");
              }}
            >
              {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Mark
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

