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
import { ClipboardCheck, Mail, Phone, RefreshCw, Loader2, AlertTriangle, LogOut, Clock, LogIn } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { toast as sonner } from "sonner";

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
  const { companies, getUser, getCompany, attendance, refresh } = useDataStore();
  const { toast } = useToast();
  const [date, setDate] = useState<string>(today());
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [data, setData] = useState<FollowupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumingUserId, setResumingUserId] = useState<string | null>(null);

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

  const filterByCompany = (rows: Row[]) =>
    companyFilter === "all" ? rows : rows.filter((r) => r.home_company_id === companyFilter);

  const needFollowup = useMemo(() => filterByCompany(data?.need_followup ?? []), [data, companyFilter]);
  const present = useMemo(() => filterByCompany(data?.present ?? []), [data, companyFilter]);
  const notYetArrived = useMemo(() => filterByCompany(data?.not_yet_arrived ?? []), [data, companyFilter]);
  const onLeave = useMemo(() => filterByCompany(data?.on_leave ?? []), [data, companyFilter]);
  const offToday = useMemo(() => filterByCompany(data?.off_today ?? []), [data, companyFilter]);

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

        <Tabs defaultValue="need_followup">
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
            <TabsTrigger value="off_today" className="gap-1.5">
              Off today
              <Badge variant="secondary" className="ml-1 text-[10px]">{offToday.length}</Badge>
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
            />
          </TabsContent>
          <TabsContent value="present">
            <PersonList rows={present} getCompany={getCompany} getUser={getUser} emptyText="No check-ins yet." />
          </TabsContent>
          <TabsContent value="on_leave">
            <PersonList rows={onLeave} getCompany={getCompany} getUser={getUser} emptyText="No one on leave today." />
          </TabsContent>
          <TabsContent value="off_today">
            <PersonList rows={offToday} getCompany={getCompany} getUser={getUser} emptyText="Everyone is working today." />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function PersonList({
  rows, getCompany, getUser, emptyText, variant, onResume, resumingUserId,
}: {
  rows: Row[];
  getCompany: ReturnType<typeof useDataStore>["getCompany"];
  getUser: ReturnType<typeof useDataStore>["getUser"];
  emptyText: string;
  variant?: "alert";
  onResume?: (userId: string, name: string) => Promise<void>;
  resumingUserId?: string | null;
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
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {r.designation && <>{r.designation} · </>}
                {co && <>{co.shortName || co.name}</>}
                {mgr && <> · Manager: {mgr.name}</>}
                {r.check_in_at && <> · In {fmtTime(r.check_in_at)}</>}
                {r.check_out_at && <> · Out {fmtTime(r.check_out_at)}</>}
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
