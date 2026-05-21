import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { ChartWrap, MiniLine, StackedBar, DonutChart } from "@/components/Charts";
import { CompanyBadge } from "@/components/CompanyBadge";
import { ProjectStatusBadge, RiskBadge } from "@/components/StatusBadges";
import { useDataStore } from "@/lib/dataStore";
import { ShieldCheck, Building2, AlertTriangle, TrendingUp } from "lucide-react";
import { useState } from "react";

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const { tasks, projects, companies, approvals } = useDataStore();
  const [view, setView] = useState<"company" | "employee">("company");

  const trend = [
    { label: "W1", value: 68 }, { label: "W2", value: 71 }, { label: "W3", value: 70 },
    { label: "W4", value: 74 }, { label: "W5", value: 76 }, { label: "W6", value: 79 },
  ];

  const stacked = companies.slice(0, 8).map((c) => {
    const ctasks = tasks.filter((t) => t.companyId === c.id);
    return {
      label: c.initials,
      Done: ctasks.filter((t) => t.status === "done").length,
      Active: ctasks.filter((t) => ["in_progress", "assigned", "accepted"].includes(t.status)).length,
      Blocked: ctasks.filter((t) => ["blocked", "escalated"].includes(t.status)).length,
    };
  });

  const approvalDist = [
    { name: "Pending", value: approvals.filter((a) => a.state === "pending").length },
    { name: "Approved", value: approvals.filter((a) => a.state === "approved").length },
    { name: "Rejected", value: approvals.filter((a) => a.state === "rejected").length },
    { name: "Returned", value: approvals.filter((a) => a.state === "returned").length },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name.split(" ")[0]}`}
        description="Super Admin view — focused on company health and group performance."
        icon={<ShieldCheck className="h-5 w-5" />}
      />

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Active companies" value={14} icon={<Building2 className="h-4 w-4" />} hint="across Kiron Group" />
          <StatCard label="Group productivity" value="79%" delta="+3%" trend="up" accent="accent" icon={<TrendingUp className="h-4 w-4" />} />
          <StatCard label="At-risk projects" value={projects.filter((p) => p.risk === "high").length} accent="destructive" icon={<AlertTriangle className="h-4 w-4" />} />
          <StatCard label="Strategic projects" value={projects.filter((p) => p.isStrategic).length} accent="primary" />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1 text-sm w-fit">
          {(["company","employee"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k} summary
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartWrap title={view === "company" ? "Company-wise task progress" : "Employee productivity trend"} height={260}>
              {view === "company"
                ? <StackedBar data={stacked} keys={["Done","Active","Blocked"]} colors={["hsl(var(--success))","hsl(var(--status-progress))","hsl(var(--destructive))"]} />
                : <MiniLine data={trend} />
              }
            </ChartWrap>
          </div>
          <ChartWrap title="Approvals breakdown" height={260}>
            <DonutChart data={approvalDist} colors={["hsl(var(--warning))","hsl(var(--success))","hsl(var(--destructive))","hsl(var(--status-rework))"]} />
          </ChartWrap>
        </div>

        {/* Company health */}
        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4">
            <h3 className="font-display text-sm font-semibold">Company health snapshot</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Active projects</th>
                  <th className="px-4 py-2.5 font-medium">Open tasks</th>
                  <th className="px-4 py-2.5 font-medium">Overdue</th>
                  <th className="px-4 py-2.5 font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const cprojects = projects.filter((p) => p.companyId === c.id);
                  const ctasks = tasks.filter((t) => t.companyId === c.id);
                  const overdue = ctasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done").length;
                  const health = overdue > 1 ? "high" : ctasks.length > 0 ? "medium" : "low";
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-muted/40">
                      <td className="px-4 py-2.5"><CompanyBadge companyId={c.id} /></td>
                      <td className="px-4 py-2.5">{cprojects.length}</td>
                      <td className="px-4 py-2.5">{ctasks.length}</td>
                      <td className="px-4 py-2.5">{overdue}</td>
                      <td className="px-4 py-2.5"><RiskBadge risk={health as any} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Strategic projects */}
        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4">
            <h3 className="font-display text-sm font-semibold">Strategic & risk projects</h3>
          </div>
          <ul className="divide-y divide-border">
            {projects.filter((p) => p.isStrategic || p.risk === "high").map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-4 hover:bg-surface-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <CompanyBadge companyId={p.companyId} size="xs" />
                    <ProjectStatusBadge status={p.status} />
                    <RiskBadge risk={p.risk} />
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-3 w-48">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                  </div>
                  <span className="w-9 text-right text-xs font-medium tabular-nums">{p.progress}%</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
