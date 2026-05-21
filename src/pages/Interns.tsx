import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { UserAvatar } from "@/components/UserAvatar";
import { TaskStatusBadge } from "@/components/StatusBadges";
import { GraduationCap } from "lucide-react";
import { StatCard } from "@/components/StatCard";

export default function Interns() {
  const { users, tasks, getUser } = useDataStore();
  const interns = users.filter((u) => u.role === "intern");
  return (
    <div>
      <PageHeader title="Intern Management" description="Current interns, mentors, and progress." icon={<GraduationCap className="h-5 w-5" />} />
      <div className="space-y-4 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Current interns" value={interns.length} accent="primary" />
          <StatCard label="May joiners" value={3} accent="accent" />
          <StatCard label="Pending reviews" value={4} accent="warning" />
          <StatCard label="Avg score" value={`${Math.round(interns.reduce((s,u) => s + (u.productivityScore ?? 0),0)/Math.max(interns.length,1))}%`} accent="info" />
        </div>
        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">Active interns</h3></div>
          <ul className="divide-y divide-border">
            {interns.map((u) => {
              const mentor = getUser(u.reportingManagerId);
              const t = tasks.filter((x) => x.assigneeId === u.id);
              return (
                <li key={u.id} className="flex items-center gap-3 p-4">
                  <UserAvatar userId={u.id} size="md" />
                  <div className="min-w-0 flex-1"><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.designation} · Joined {u.joinedAt}</p></div>
                  <div className="hidden md:block text-xs text-muted-foreground">Mentor: {mentor?.name}</div>
                  <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{u.productivityScore}%</span>
                  <span className="hidden md:inline text-xs text-muted-foreground">{t.length} tasks</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">Pending intern reviews</h3></div>
          <ul className="divide-y divide-border">
            {tasks.filter((t) => interns.some((i) => i.id === t.assigneeId)).map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-3.5">
                <UserAvatar userId={t.assigneeId} size="sm" />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{t.key} · {t.title}</p><p className="text-xs text-muted-foreground">By {getUser(t.assigneeId)?.name}</p></div>
                <TaskStatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
