import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { AttendanceBadge } from "@/components/StatusBadges";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { getEffectiveSchedule } from "@/lib/mappers";
import { api, ApiError } from "@/lib/api";
import { CalendarCheck, LogIn, LogOut, Fingerprint, Loader2, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { toast } from "sonner";
import type { AttendanceStatus } from "@/types";

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const formatHM = (mins: number) => {
  if (!Number.isFinite(mins) || mins <= 0) return "0h";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const minutesBetween = (start?: string, end?: string) => {
  if (!start) return 0;
  const [sh, sm] = start.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(sm)) return 0;
  const startMin = sh * 60 + sm;
  let endMin: number;
  if (end) {
    const [eh, em] = end.split(":").map(Number);
    if (!Number.isFinite(eh) || !Number.isFinite(em)) return 0;
    endMin = eh * 60 + em;
  } else {
    const now = new Date();
    endMin = now.getHours() * 60 + now.getMinutes();
  }
  return Math.max(0, endMin - startMin);
};

export default function Attendance() {
  const { user } = useAuth();
  const { attendance, users, leaveRequests, holidays, getCompany, refresh } = useDataStore();
  const [busy, setBusy] = useState<"checkin" | "checkout" | null>(null);
  const [todayMode, setTodayMode] = useState<AttendanceStatus>("present");

  // Effective schedule for the signed-in user — falls back to their
  // company's default when no per-employee override is set.
  const schedule = user ? getEffectiveSchedule(user, getCompany(user.homeCompanyId)) : { workDays: [1,2,3,4,5,6], workStart: "09:30", workEnd: "18:30" };

  // Holidays that apply to this user — their company-specific rows + the
  // global (company_id NULL) ones. Indexed by date so the grid lookup is O(1).
  const holidayByDate = useMemo(() => {
    const m = new Map<string, typeof holidays[number]>();
    for (const h of holidays) {
      if (h.companyId && h.companyId !== user?.homeCompanyId) continue;
      // Company-specific row beats the global row on the same date.
      const existing = m.get(h.date);
      if (!existing || (existing.companyId == null && h.companyId)) m.set(h.date, h);
    }
    return m;
  }, [holidays, user?.homeCompanyId]);

  const today = todayISO();
  const myLogs = useMemo(() => attendance.filter((a) => a.userId === user?.id), [attendance, user]);
  const present = myLogs.filter((l) => l.status === "present").length;
  const todayLog = myLogs.find((l) => l.date === today);
  const checkedIn = !!todayLog?.checkIn && !todayLog?.checkOut;
  const finished = !!todayLog?.checkIn && !!todayLog?.checkOut;

  const myApprovedLeaveToday = useMemo(
    () => leaveRequests.find((l) =>
      l.userId === user?.id && l.status === "approved" && l.fromDate <= today && l.toDate >= today,
    ),
    [leaveRequests, user, today],
  );

  const liveMinutes = useMemo(() => {
    if (!todayLog?.checkIn) return 0;
    return minutesBetween(todayLog.checkIn, todayLog.checkOut);
  }, [todayLog]);

  const handleCheckIn = async () => {
    if (!user) return;
    if (todayLog) return toast.info("Already checked in for today");
    setBusy("checkin");
    const status: AttendanceStatus = todayMode === "wfh" ? "wfh" : todayMode;
    const dbStatus = status === "wfh" ? "work_from_home" : status;
    try {
      await api.checkIn({
        work_date: today,
        check_in_at: new Date().toISOString(),
        status: dbStatus,
        source: "self_checkin",
      });
      toast.success(status === "wfh" ? "Checked in (WFH)" : "Checked in");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Check-in failed");
    } finally {
      setBusy(null);
    }
  };

  const handleCheckOut = async () => {
    if (!user || !todayLog) return;
    if (todayLog.checkOut) return toast.info("Already checked out");
    setBusy("checkout");
    try {
      await api.updateAttendance(todayLog.id, { check_out_at: new Date().toISOString() });
      const mins = minutesBetween(todayLog.checkIn, new Date().toTimeString().slice(0, 5));
      toast.success(`Checked out — ${formatHM(mins)} today`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Check-out failed");
    } finally {
      setBusy(null);
    }
  };

  const grid = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const ds = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const log = myLogs.find((l) => l.date === ds);
    const holiday = holidayByDate.get(ds);
    // Status precedence: real check-in > approved leave (the log already
    // reflects that) > gazetted holiday > weekly off > absent. Optional and
    // informational holidays don't change the cell — we only add the name
    // to the tooltip so the calendar still tells the truth about who showed
    // up. The user is free to take leave on those days if they want.
    let status: string;
    if (log) status = log.status;
    else if (holiday && holiday.type === "gazetted") status = "holiday";
    else if (isNonWorkingDay(d, schedule.workDays)) status = "weekly_off";
    else status = "absent";
    return { date: ds, status, holiday };
  });

  const colorFor = (s: string) => {
    if (s === "present") return "bg-success/70";
    if (s === "wfh") return "bg-accent/70";
    if (s === "half_day") return "bg-warning/70";
    if (s === "leave") return "bg-status-hold/70";
    if (s === "holiday") return "bg-accent-soft";
    if (s === "weekly_off") return "bg-muted";
    return "bg-destructive/40";
  };

  const totalMins = myLogs.reduce(
    (acc, l) => acc + minutesBetween(l.checkIn, l.checkOut),
    0,
  );
  const avgMins = present ? Math.round(totalMins / present) : 0;

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Self check-in, calendar, and team summary."
        icon={<CalendarCheck className="h-5 w-5" />}
      />
      <div className="space-y-6 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Days present (30d)" value={present} accent="accent" />
          <StatCard label="WFH days" value={myLogs.filter((l) => l.status === "wfh").length} accent="info" />
          <StatCard label="Leaves" value={myLogs.filter((l) => l.status === "leave").length} accent="warning" />
          <StatCard label="Avg hours" value={avgMins ? formatHM(avgMins) : "—"} accent="primary" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-card lg:col-span-1">
            <h3 className="font-display text-sm font-semibold">Today · {today}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Self check-in</p>

            {myApprovedLeaveToday && !todayLog && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-foreground">
                <Plane className="mt-0.5 h-3.5 w-3.5 text-warning" />
                <span>You have approved <b>{myApprovedLeaveToday.type.replace("_", " ")}</b> for today. Check-in is optional.</span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!todayLog ? (
                <>
                  <Select value={todayMode} onValueChange={(v) => setTodayMode(v as AttendanceStatus)}>
                    <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="present">In office</SelectItem>
                      <SelectItem value="wfh">WFH</SelectItem>
                      <SelectItem value="half_day">Half day</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleCheckIn} disabled={busy !== null} className="gap-1.5">
                    {busy === "checkin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    Check in
                  </Button>
                </>
              ) : checkedIn ? (
                <Button variant="outline" onClick={handleCheckOut} disabled={busy !== null} className="gap-1.5">
                  {busy === "checkout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  Check out
                </Button>
              ) : (
                <span className="rounded-md bg-status-done/10 px-2.5 py-1.5 text-xs font-medium text-status-done">
                  Day closed — {formatHM(liveMinutes)}
                </span>
              )}
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              {todayLog?.checkIn ? (
                <>
                  In <b className="text-foreground">{todayLog.checkIn}</b>
                  {todayLog.checkOut
                    ? <> · Out <b className="text-foreground">{todayLog.checkOut}</b> · {formatHM(liveMinutes)} total</>
                    : <> · {formatHM(liveMinutes)} so far</>}
                </>
              ) : "Not checked in yet"}
            </div>

            <div className="mt-4 rounded-md border border-dashed border-border bg-surface-muted p-3 text-xs text-muted-foreground">
              <Fingerprint className="mb-1 inline h-3.5 w-3.5" /> Biometric integration coming in next phase.
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-card lg:col-span-2">
            <h3 className="font-display text-sm font-semibold">Last 30 days</h3>
            <div className="mt-3 grid grid-cols-10 gap-1.5">
              {grid.map((g) => {
                const tip = g.holiday
                  ? `${g.date} · ${g.holiday.name}${g.holiday.type !== "gazetted" ? ` (${g.holiday.type})` : ""}`
                  : `${g.date} · ${g.status}`;
                return <div key={g.date} title={tip} className={`aspect-square rounded ${colorFor(g.status)}`} />;
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-success/70" /> Present</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-accent/70" /> WFH</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-warning/70" /> Half day</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-status-hold/70" /> Leave</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-accent-soft" /> Holiday</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-muted" /> Weekly off</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-destructive/40" /> Absent</span>
            </div>

            {/* Upcoming holidays for the user's company — six rows so it stays
                compact. Pulls from the same in-memory store, no extra query. */}
            {(() => {
              const todayStr = today;
              const upcoming = Array.from(holidayByDate.values())
                .filter((h) => h.date >= todayStr)
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(0, 6);
              if (!upcoming.length) return null;
              return (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Upcoming holidays</p>
                  <ul className="mt-1.5 space-y-1">
                    {upcoming.map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium">{h.name}</span>
                        <span className="text-muted-foreground">
                          {h.date}
                          {h.type !== "gazetted" && <span className="ml-1.5 rounded-md bg-surface-muted px-1 py-0.5 text-[10px]">{h.type}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4">
            <h3 className="font-display text-sm font-semibold">Team attendance — today</h3>
          </div>
          <ul className="divide-y divide-border">
            {users.slice(0, 8).map((u) => {
              const log = attendance.find((a) => a.userId === u.id && a.date === today);
              const mins = minutesBetween(log?.checkIn, log?.checkOut);
              return (
                <li key={u.id} className="flex items-center gap-3 p-3">
                  <UserAvatar userId={u.id} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.designation}</p>
                  </div>
                  <AttendanceBadge status={log?.status ?? "absent"} />
                  {log?.checkIn && (
                    <span className="ml-3 hidden text-xs text-muted-foreground md:inline">
                      {log.checkIn} → {log.checkOut ?? "now"} · {formatHM(mins)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Map JS getDay() (0=Sun..6=Sat) to our ISO numbering (1=Mon..7=Sun) and
// check against the user's effective working-day set.
function isNonWorkingDay(d: Date, workDays: number[]): boolean {
  const js = d.getDay();
  const iso = js === 0 ? 7 : js;
  return !workDays.includes(iso);
}
