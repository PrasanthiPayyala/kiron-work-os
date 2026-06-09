import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { AttendanceBadge } from "@/components/StatusBadges";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { getEffectiveSchedule, isNonWorkingDate } from "@/lib/mappers";
import { api, ApiError } from "@/lib/api";
import { CalendarCheck, LogIn, LogOut, Fingerprint, Loader2, Plane, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { toast } from "sonner";
import type { AttendanceStatus, AttendanceLog, Holiday, Schedule } from "@/types";

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

// ---------- Calendar helpers (year + month views) ----------

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_LETTERS = ["S","M","T","W","T","F","S"] as const;

const toISO = (d: Date): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const sameYMD = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

type DayStatus = AttendanceStatus | "holiday" | "weekly_off" | "absent" | "future";

const colorForStatus = (s: DayStatus): string => {
  if (s === "present") return "bg-success/70";
  if (s === "wfh") return "bg-accent/70";
  if (s === "half_day") return "bg-warning/70";
  if (s === "leave") return "bg-status-hold/70";
  if (s === "holiday") return "bg-accent-soft";
  if (s === "weekly_off") return "bg-muted";
  if (s === "future") return "bg-surface-muted/40";
  return "bg-destructive/40";  // absent
};

/** Same status precedence the live grid uses: log -> gazetted holiday ->
 * weekly off -> absent. Future dates render as a neutral placeholder so the
 * year view doesn't paint everything red. */
function statusForDate(
  d: Date,
  log: AttendanceLog | undefined,
  holiday: Holiday | undefined,
  schedule: Schedule,
  today: Date,
): DayStatus {
  if (d.getTime() > today.getTime() && !sameYMD(d, today)) return "future";
  if (log) return log.status;
  if (holiday && holiday.type === "gazetted") return "holiday";
  if (isNonWorkingDate(d, schedule)) return "weekly_off";
  return "absent";
}

/** Build a fixed 6-row × 7-col grid for a month. Empty cells become null —
 * we render them as blank squares so every month is the same height. */
function monthCells(year: number, month: number): (Date | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length < 42) cells.push(null);
  return cells;
}

type CalendarProps = {
  year: number;
  month: number;                          // 0..11
  myLogs: AttendanceLog[];
  holidayByDate: Map<string, Holiday>;
  schedule: Schedule;
  today: Date;
};

function MonthCalendar({ year, month, myLogs, holidayByDate, schedule, today, onPrev, onNext }: CalendarProps & {
  onPrev: () => void;
  onNext: () => void;
}) {
  const cells = monthCells(year, month);
  const logsByDate = new Map(myLogs.map((l) => [l.date, l]));
  return (
    <div>
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={onPrev} className="h-7 w-7" aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h4 className="font-display text-sm font-semibold">{MONTH_NAMES[month]} {year}</h4>
        <Button variant="ghost" size="icon" onClick={onNext} className="h-7 w-7" aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {DAY_LETTERS.map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="aspect-square" />;
          const ds = toISO(d);
          const log = logsByDate.get(ds);
          const holiday = holidayByDate.get(ds);
          const status = statusForDate(d, log, holiday, schedule, today);
          const isToday = sameYMD(d, today);
          const tip = holiday
            ? `${ds} - ${holiday.name}${holiday.type !== "gazetted" ? ` (${holiday.type})` : ""}`
            : `${ds} - ${status.replace("_", " ")}`;
          return (
            <div
              key={i}
              title={tip}
              className={`relative aspect-square rounded ${colorForStatus(status)} ${isToday ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""}`}
            >
              <span className={`absolute bottom-0.5 right-1 text-[10px] leading-none ${isToday ? "font-bold text-foreground" : "text-foreground/60"}`}>
                {d.getDate()}
              </span>
              {holiday && (
                <span
                  className="absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent"
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-success/70" /> Present</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-accent/70" /> WFH</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-warning/70" /> Half day</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-status-hold/70" /> Leave</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-accent-soft" /> Holiday</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-muted" /> Weekly off</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-destructive/40" /> Absent</span>
      </div>
    </div>
  );
}

function MiniMonth({ year, month, myLogs, holidayByDate, schedule, today, onClick }: CalendarProps & { onClick: () => void }) {
  const cells = monthCells(year, month);
  const logsByDate = new Map(myLogs.map((l) => [l.date, l]));
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border bg-surface p-2.5 text-left transition hover:border-primary/40 hover:shadow-card"
    >
      <div className="mb-1.5 text-xs font-semibold">{MONTH_NAMES[month]}</div>
      <div className="grid grid-cols-7 gap-[2px]">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="aspect-square" />;
          const ds = toISO(d);
          const log = logsByDate.get(ds);
          const holiday = holidayByDate.get(ds);
          const status = statusForDate(d, log, holiday, schedule, today);
          const isToday = sameYMD(d, today);
          return (
            <div
              key={i}
              className={`aspect-square rounded-[2px] ${colorForStatus(status)} ${isToday ? "ring-1 ring-primary" : ""}`}
              title={`${ds} - ${status.replace("_", " ")}`}
            />
          );
        })}
      </div>
    </button>
  );
}

function YearGrid(props: { year: number; myLogs: AttendanceLog[]; holidayByDate: Map<string, Holiday>; schedule: Schedule; today: Date; onMonthClick: (m: number) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => (
        <MiniMonth
          key={m}
          year={props.year}
          month={m}
          myLogs={props.myLogs}
          holidayByDate={props.holidayByDate}
          schedule={props.schedule}
          today={props.today}
          onClick={() => props.onMonthClick(m)}
        />
      ))}
    </div>
  );
}

function HolidaysList({ year, holidayByDate }: { year: number; holidayByDate: Map<string, Holiday> }) {
  const yearHolidays = Array.from(holidayByDate.values())
    .filter((h) => h.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!yearHolidays.length) {
    return <p className="text-sm text-muted-foreground">No holidays configured for {year}. Ask HR to import the list under Settings - Holidays.</p>;
  }

  // Group by month so the year reads at a glance.
  const groups = new Map<number, Holiday[]>();
  for (const h of yearHolidays) {
    const m = Number(h.date.slice(5, 7)) - 1;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push(h);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([m, list]) => (
        <div key={m}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{MONTH_NAMES[m]}</h4>
          <ul className="mt-1.5 divide-y divide-border rounded-lg border border-border bg-surface">
            {list.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{h.name}</p>
                  {h.notes && <p className="truncate text-xs text-muted-foreground">{h.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>{h.date}</span>
                  {h.type !== "gazetted" && (
                    <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase">{h.type}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function Attendance() {
  const { user } = useAuth();
  const { attendance, users, leaveRequests, holidays, getCompany, refresh } = useDataStore();
  const [busy, setBusy] = useState<"checkin" | "checkout" | null>(null);
  const [todayMode, setTodayMode] = useState<AttendanceStatus>("present");
  // Calendar UI state. Tab is "month" by default so the user lands on the
  // most useful view; currentMonth is initialised to today's month.
  const todayDate = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<"month" | "year" | "holidays">("month");
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));
  const viewYear = todayDate.getFullYear();
  const goPrevMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNextMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const jumpToMonth = (m: number) => {
    setViewMonth(new Date(viewYear, m, 1));
    setTab("month");
  };

  // Effective schedule for the signed-in user — falls back to their
  // company's default when no per-employee override is set.
  const schedule = user
    ? getEffectiveSchedule(user, getCompany(user.homeCompanyId))
    : { workDays: [1,2,3,4,5,6], workStart: "09:30", workEnd: "18:30", saturdayWeeksWorking: null };

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
      toast.success(
        status === "wfh" ? "Checked in (WFH)" :
        status === "half_day" ? "Checked in (half day)" :
        "Checked in",
      );
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
                  {/* Three inline pills instead of a dropdown so Half day is
                      visible without a click. The selected mode is what the
                      Check in button records. */}
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { value: "present",  label: "In office" },
                      { value: "wfh",      label: "WFH" },
                      { value: "half_day", label: "Half day" },
                    ] as { value: AttendanceStatus; label: string }[]).map(({ value, label }) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={todayMode === value ? "default" : "outline"}
                        onClick={() => setTodayMode(value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
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
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList className="grid w-full grid-cols-3 sm:w-auto">
                <TabsTrigger value="month">This month</TabsTrigger>
                <TabsTrigger value="year">Full year</TabsTrigger>
                <TabsTrigger value="holidays">Holidays</TabsTrigger>
              </TabsList>

              <TabsContent value="month" className="mt-4">
                <MonthCalendar
                  year={viewMonth.getFullYear()}
                  month={viewMonth.getMonth()}
                  myLogs={myLogs}
                  holidayByDate={holidayByDate}
                  schedule={schedule}
                  today={todayDate}
                  onPrev={goPrevMonth}
                  onNext={goNextMonth}
                />
              </TabsContent>

              <TabsContent value="year" className="mt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-display text-sm font-semibold">{viewYear}</h4>
                  <p className="text-xs text-muted-foreground">Click any month to drill in</p>
                </div>
                <YearGrid
                  year={viewYear}
                  myLogs={myLogs}
                  holidayByDate={holidayByDate}
                  schedule={schedule}
                  today={todayDate}
                  onMonthClick={jumpToMonth}
                />
              </TabsContent>

              <TabsContent value="holidays" className="mt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-display text-sm font-semibold">Holidays · {viewYear}</h4>
                  <p className="text-xs text-muted-foreground">Read-only — HR manages via Settings</p>
                </div>
                <HolidaysList year={viewYear} holidayByDate={holidayByDate} />
              </TabsContent>
            </Tabs>
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

