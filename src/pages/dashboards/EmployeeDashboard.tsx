import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { Briefcase, Clock, CheckCircle2, Activity } from "lucide-react";
import { ChartWrap, MiniLine } from "@/components/Charts";
import { useNavigate } from "react-router-dom";

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { tasks, leaveRequests } = useDataStore();
  const navigate = useNavigate();
  if (!user) return null;

  const myTasks = tasks.filter((t) => t.assigneeId === user.id);
  const today = new Date().toISOString().slice(0, 10);
  const dueToday = myTasks.filter((t) => t.dueDate === today && t.status !== "done");
  const overdue = myTasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== "done");
  const myLeaves = leaveRequests.filter((l) => l.userId === user.id);

  const trend = [
    { label: "Mon", value: 70 }, { label: "Tue", value: 75 }, { label: "Wed", value: 78 },
    { label: "Thu", value: 80 }, { label: "Fri", value: 82 }, { label: "Sat", value: 84 }, { label: "Sun", value: user.productivityScore ?? 78 },
  ];

  return (
    <div>
      <PageHeader
        title={`Hi ${user.name.split(" ")[0]}`}
        description="Your work for today, across Kiron Group."
        icon={<Briefcase className="h-5 w-5" />}
      />

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="My open tasks" value={myTasks.filter((t) => t.status !== "done").length} icon={<Briefcase className="h-4 w-4" />} />
          <StatCard label="Due today" value={dueToday.length} accent="primary" icon={<Clock className="h-4 w-4" />} />
          <StatCard label="Overdue" value={overdue.length} accent="destructive" />
          <StatCard label="Productivity" value={`${user.productivityScore ?? 78}%`} accent="accent" icon={<Activity className="h-4 w-4" />} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="font-display text-sm font-semibold">My tasks today</h3>
              <button onClick={() => navigate("/tasks")} className="text-xs text-primary hover:underline">View all</button>
            </div>
            <ul className="divide-y divide-border">
              {myTasks.filter((t) => t.status !== "done").slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center gap-3 p-3.5 hover:bg-surface-muted/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.key} · {t.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <CompanyBadge companyId={t.companyId} size="xs" />
                      <PriorityBadge priority={t.priority} />
                      <TaskStatusBadge status={t.status} />
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">Due {t.dueDate ?? "—"}</span>
                </li>
              ))}
              {myTasks.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No tasks assigned to you yet.</p>}
            </ul>
          </div>

          <ChartWrap title="My productivity (week)" height={240}>
            <MiniLine data={trend} color="hsl(var(--accent))" />
          </ChartWrap>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 font-display text-sm font-semibold">Recent updates</h3>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> Submitted PRD for productivity scoring (INN-222).</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> Posted update on attendance widget (INN-220).</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-accent" /> Logged check-in at 09:32.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 font-display text-sm font-semibold">My leave</h3>
            <ul className="space-y-2 text-sm">
              {myLeaves.length === 0 && <p className="text-muted-foreground">No leave requests.</p>}
              {myLeaves.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <span className="capitalize">{l.type.replace("_"," ")} · {l.fromDate} → {l.toDate}</span>
                  <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs capitalize">{l.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
