import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { ChartWrap, MiniLine, MiniBar, DonutChart } from "@/components/Charts";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { Crown, AlertTriangle, Clock, CheckCircle2, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function FounderDashboard() {
  const { user } = useAuth();
  const { tasks, users, companies, approvals, leaveRequests, getUser } = useDataStore();
  const navigate = useNavigate();

  const overdue = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done");
  const noUpdate = tasks.filter((t) => (t.noUpdateDays ?? 0) >= 2 && t.status !== "done");
  const pendingApprovals = approvals.filter((a) => a.state === "pending");
  const leavePending = leaveRequests.filter((l) => l.status === "pending");

  const employeeWorkload = users
    .filter((u) => u.role === "employee" || u.role === "intern")
    .map((u) => ({
      label: u.initials,
      name: u.name,
      value: tasks.filter((t) => t.assigneeId === u.id && !["done", "cancelled"].includes(t.status)).length,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const progressTrend = [
    { label: "Mon", value: 62 }, { label: "Tue", value: 67 }, { label: "Wed", value: 71 },
    { label: "Thu", value: 69 }, { label: "Fri", value: 74 }, { label: "Sat", value: 76 }, { label: "Sun", value: 78 },
  ];

  const attendanceDist = [
    { name: "Present", value: 28 },
    { name: "WFH", value: 4 },
    { name: "Leave", value: 2 },
    { name: "Half day", value: 1 },
  ];
  const attendanceColors = ["hsl(var(--success))", "hsl(var(--accent))", "hsl(var(--status-hold))", "hsl(var(--warning))"];

  return (
    <div>
      <PageHeader
        title={`Good morning, ${user?.name.split(" ")[0]}`}
        description="Founder view — focused on people, bottlenecks, and approvals."
        icon={<Crown className="h-5 w-5" />}
      />

      <div className="space-y-6 p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="No-update employees" value={9} hint="≥ 2 days silent" accent="warning" icon={<AlertTriangle className="h-4 w-4" />} delta="+2" trend="down" />
          <StatCard label="Overdue tasks" value={overdue.length} hint="across all companies" accent="destructive" icon={<Clock className="h-4 w-4" />} delta="-3" trend="up" />
          <StatCard label="Approvals queued" value={pendingApprovals.length} hint="content + tasks + leave" accent="primary" icon={<CheckCircle2 className="h-4 w-4" />} delta="+1" trend="flat" />
          <StatCard label="On leave today" value={leavePending.length + 1} hint="HR routes pending" accent="info" />
        </div>

        {/* Charts */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartWrap title="Group progress this week" height={240}>
              <MiniLine data={progressTrend} />
            </ChartWrap>
          </div>
          <ChartWrap title="Attendance today" height={240}>
            <DonutChart data={attendanceDist} colors={attendanceColors} />
          </ChartWrap>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartWrap title="Employee workload (open tasks)" height={240}>
            <MiniBar data={employeeWorkload} />
          </ChartWrap>

          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">No-update employees</h3>
              <button onClick={() => navigate("/people")} className="text-xs text-primary hover:underline">View all</button>
            </div>
            <ul className="divide-y divide-border">
              {noUpdate.slice(0, 6).map((t) => {
                const u = getUser(t.assigneeId);
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <UserAvatar userId={t.assigneeId} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u?.name ?? "Unassigned"}</p>
                      <p className="truncate text-xs text-muted-foreground">{t.key} · {t.title}</p>
                    </div>
                    <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning-foreground">
                      {t.noUpdateDays}d silent
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Approval backlog table */}
        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h3 className="font-display text-sm font-semibold">Approval backlog</h3>
            <button onClick={() => navigate("/approvals")} className="flex items-center gap-1 text-xs text-primary hover:underline">
              Open approvals <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Requested by</th>
                  <th className="px-4 py-2.5 font-medium">Approver</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {pendingApprovals.slice(0, 5).map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-muted/40">
                    <td className="px-4 py-2.5">{a.refLabel}</td>
                    <td className="px-4 py-2.5 capitalize">{a.kind.replace("_", " ")}</td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><UserAvatar userId={a.requestedById} size="xs" /><span>{getUser(a.requestedById)?.name}</span></div></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><UserAvatar userId={a.approverId} size="xs" /><span>{getUser(a.approverId)?.name}</span></div></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drill-down by company */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold">Drill down by company</h3>
            <span className="text-xs text-muted-foreground">14 entities</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {companies.slice(0, 8).map((c) => {
              const ctasks = tasks.filter((t) => t.companyId === c.id);
              const done = ctasks.filter((t) => t.status === "done").length;
              const pct = ctasks.length ? Math.round((done / ctasks.length) * 100) : 0;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/projects?company=${c.id}`)}
                  className="rounded-lg border border-border bg-surface p-3 text-left transition hover:border-primary/40 hover:bg-primary-soft/30"
                >
                  <CompanyBadge companyId={c.id} size="xs" />
                  <p className="mt-2 font-display text-lg font-semibold">{ctasks.length}</p>
                  <p className="text-[11px] text-muted-foreground">{pct}% done</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent escalated/critical tasks */}
        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4">
            <h3 className="font-display text-sm font-semibold">Critical & escalated tasks</h3>
          </div>
          <ul className="divide-y divide-border">
            {tasks.filter((t) => t.priority === "critical" || t.status === "escalated").slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-4 hover:bg-surface-muted/40">
                <UserAvatar userId={t.assigneeId} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.key} · {t.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <CompanyBadge companyId={t.companyId} size="xs" />
                    <PriorityBadge priority={t.priority} />
                    <TaskStatusBadge status={t.status} />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">Due {t.dueDate}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
