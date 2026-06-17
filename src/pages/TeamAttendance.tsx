// Team Attendance / Follow-up — shows today's missing check-ins so HR
// and TA staff can reach out to people who are working but haven't
// checked in yet. Buckets:
//   - missing: should be here today but haven't checked in
//   - checked_in: already checked in
//   - on_leave: on approved leave today
//   - off_today: schedule says today is off (weekend / Saturday pattern)
//
// Access via roleNavAccess + per-user attendanceFollowupAccess flag —
// ProtectedRoute already gates it; the page just renders.
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Mail, Phone, RefreshCw, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type Row = {
  user_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  home_company_id?: string | null;
  reporting_manager_id?: string | null;
  check_in_at?: string | null;
  check_in_status?: string | null;
  leave_type?: string | null;
};

type FollowupResponse = {
  date: string;
  iso_weekday: number;
  totals: { missing: number; checked_in: number; on_leave: number; off_today: number };
  missing: Row[];
  checked_in: Row[];
  on_leave: Row[];
  off_today: Row[];
};

const today = () => new Date().toISOString().slice(0, 10);

export default function TeamAttendance() {
  const { companies, getUser, getCompany } = useDataStore();
  const { toast } = useToast();
  const [date, setDate] = useState<string>(today());
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [data, setData] = useState<FollowupResponse | null>(null);
  const [loading, setLoading] = useState(false);

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

  const filterByCompany = (rows: Row[]) =>
    companyFilter === "all" ? rows : rows.filter((r) => r.home_company_id === companyFilter);

  const missing = useMemo(() => filterByCompany(data?.missing ?? []), [data, companyFilter]);
  const checkedIn = useMemo(() => filterByCompany(data?.checked_in ?? []), [data, companyFilter]);
  const onLeave = useMemo(() => filterByCompany(data?.on_leave ?? []), [data, companyFilter]);
  const offToday = useMemo(() => filterByCompany(data?.off_today ?? []), [data, companyFilter]);

  return (
    <div>
      <PageHeader
        title="Team Attendance"
        description="Today's check-in status, so you can follow up with anyone who's working but hasn't checked in."
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
        </div>

        <Tabs defaultValue="missing">
          <TabsList>
            <TabsTrigger value="missing" className="gap-1.5">
              Need follow-up
              <Badge variant={missing.length > 0 ? "destructive" : "secondary"} className="ml-1 text-[10px]">{missing.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="checked_in" className="gap-1.5">
              Checked in
              <Badge variant="secondary" className="ml-1 text-[10px]">{checkedIn.length}</Badge>
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

          <TabsContent value="missing">
            <PersonList rows={missing} getCompany={getCompany} getUser={getUser} emptyText="Everyone working today has checked in. 🎉" highlight />
          </TabsContent>
          <TabsContent value="checked_in">
            <PersonList rows={checkedIn} getCompany={getCompany} getUser={getUser} emptyText="No one checked in yet." />
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
  rows, getCompany, getUser, emptyText, highlight,
}: {
  rows: Row[];
  getCompany: ReturnType<typeof useDataStore>["getCompany"];
  getUser: ReturnType<typeof useDataStore>["getUser"];
  emptyText: string;
  highlight?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="mt-4 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="mt-4 divide-y divide-border rounded-lg border bg-surface">
      {rows.map((r) => {
        const co = r.home_company_id ? getCompany(r.home_company_id) : null;
        const mgr = r.reporting_manager_id ? getUser(r.reporting_manager_id) : null;
        return (
          <li key={r.user_id} className={`flex flex-wrap items-center justify-between gap-3 p-3.5 ${highlight ? "first:rounded-t-lg last:rounded-b-lg" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium">{r.name}</p>
                {r.check_in_status && <Badge variant="outline" className="text-[10px] capitalize">{r.check_in_status.replace("_", " ")}</Badge>}
                {r.leave_type && <Badge variant="secondary" className="text-[10px] capitalize">{r.leave_type.replace("_", " ")}</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {r.designation && <>{r.designation} · </>}
                {co && <>{co.shortName || co.name}</>}
                {mgr && <> · Manager: {mgr.name}</>}
                {r.check_in_at && <> · Checked in {new Date(r.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
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
