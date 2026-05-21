import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { ChartWrap, MiniBar } from "@/components/Charts";
import { UserAvatar } from "@/components/UserAvatar";
import { TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { Briefcase, Users, ListChecks, ShieldCheck } from "lucide-react";

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { tasks, users, getUser } = useDataStore();
  if (!user) return null;

  const team = users.filter((u) => u.reportingManagerId === user.id);
  const teamIds = new Set([user.id, ...team.map((u) => u.id)]);
  const teamTasks = tasks.filter((t) => t.assigneeId && teamIds.has(t.assigneeId));
  const pendingReviews = teamTasks.filter((t) => t.status === "waiting_review" || t.status === "waiting_approval");

  const teamLoad = team.map((u) => ({
    label: u.initials,
    value: tasks.filter((t) => t.assigneeId === u.id && t.status !== "done").length,
  }));

  return (
    <div>
      <PageHeader
        title={`Hi ${user.name.split(" ")[0]}, here's your team`}
        description="Manager view — your team's work and approvals."
        icon={<Briefcase className="h-5 w-5" />}
      />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Team size" value={team.length} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Open team tasks" value={teamTasks.filter((t) => t.status !== "done").length} accent="primary" icon={<ListChecks className="h-4 w-4" />} />
          <StatCard label="Awaiting your review" value={pendingReviews.length} accent="warning" icon={<ShieldCheck className="h-4 w-4" />} />
          <StatCard label="Team avg score" value={`${Math.round(team.reduce((s, u) => s + (u.productivityScore ?? 0), 0) / Math.max(team.length, 1))}%`} accent="accent" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartWrap title="Team workload" height={240}>
            <MiniBar data={teamLoad.length ? teamLoad : [{ label: "—", value: 0 }]} />
          </ChartWrap>

          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 font-display text-sm font-semibold">Pending your review</h3>
            <ul className="divide-y divide-border">
              {pendingReviews.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nothing waiting on you. 🎉</p>}
              {pendingReviews.slice(0, 5).map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <UserAvatar userId={t.assigneeId} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.key} · {t.title}</p>
                    <p className="truncate text-xs text-muted-foreground">by {getUser(t.assigneeId)?.name}</p>
                  </div>
                  <TaskStatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4">
            <h3 className="font-display text-sm font-semibold">Your team</h3>
          </div>
          <ul className="divide-y divide-border">
            {team.map((u) => {
              const t = tasks.filter((x) => x.assigneeId === u.id && x.status !== "done").length;
              return (
                <li key={u.id} className="flex items-center gap-3 p-4 hover:bg-surface-muted/40">
                  <UserAvatar userId={u.id} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.designation}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{t} open</span>
                  <span className="ml-3 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{u.productivityScore}%</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4">
            <h3 className="font-display text-sm font-semibold">High-priority team tasks</h3>
          </div>
          <ul className="divide-y divide-border">
            {teamTasks.filter((t) => ["high","critical"].includes(t.priority)).slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-4 hover:bg-surface-muted/40">
                <UserAvatar userId={t.assigneeId} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.key} · {t.title}</p>
                  <div className="mt-1 flex items-center gap-2">
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
