import { useParams, useNavigate } from "react-router-dom";
import { useDataStore } from "@/lib/dataStore";
import { roleLabel } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

export default function PersonProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { users, tasks, getUser } = useDataStore();
  const u = users.find((x) => x.id === id);
  if (!u) return <div className="p-6"><Button variant="outline" onClick={() => navigate("/people")}>Back</Button></div>;
  const myTasks = tasks.filter((t) => t.assigneeId === u.id);

  return (
    <div>
      <PageHeader title={u.name} description={`${u.designation} · ${roleLabel(u.role)}`} icon={<Users className="h-5 w-5" />} actions={<Button variant="outline" size="sm" onClick={() => navigate("/people")}>Back</Button>} />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-5 shadow-card">
          <UserAvatar userId={u.id} size="xl" />
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold">{u.name}</h2>
            <p className="text-sm text-muted-foreground">{u.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CompanyBadge companyId={u.homeCompanyId} />
              <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">Score {u.productivityScore}%</span>
              <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs">Joined {u.joinedAt}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Reports to</p><p className="font-medium">{getUser(u.reportingManagerId)?.name ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Reviewer</p><p className="font-medium">{getUser(u.reviewerId)?.name ?? "—"}</p></div>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="tasks">Tasks</TabsTrigger><TabsTrigger value="attendance">Attendance</TabsTrigger><TabsTrigger value="leave">Leave</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="skills">Skills</TabsTrigger><TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <h3 className="font-display text-sm font-semibold">About</h3>
            <p className="mt-2 text-sm text-muted-foreground">{u.designation} at {u.homeCompanyId}.</p>
          </TabsContent>
          <TabsContent value="tasks" className="rounded-xl border border-border bg-surface shadow-card">
            <ul className="divide-y divide-border">
              {myTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{t.key} · {t.title}</p><div className="mt-1 flex items-center gap-2"><PriorityBadge priority={t.priority} /><TaskStatusBadge status={t.status} /></div></div>
                  <span className="text-xs text-muted-foreground">{t.dueDate}</span>
                </li>
              ))}
              {myTasks.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">No tasks.</p>}
            </ul>
          </TabsContent>
          <TabsContent value="skills" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <div className="flex flex-wrap gap-2">{u.skills?.map((s) => <span key={s} className="rounded-md bg-surface-muted px-2 py-1 text-sm">{s}</span>)}</div>
          </TabsContent>
          {["attendance","leave","activity","performance"].map((k) => (
            <TabsContent key={k} value={k} className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-card">{k} — coming next iteration.</TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
