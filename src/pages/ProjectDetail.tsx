import { useParams, useNavigate } from "react-router-dom";
import { useDataStore } from "@/lib/dataStore";
import { PageHeader } from "@/components/PageHeader";
import { CompanyBadge } from "@/components/CompanyBadge";
import { ProjectStatusBadge, RiskBadge, TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { UserAvatarStack, UserAvatar } from "@/components/UserAvatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { LinkedEmails } from "@/components/mail/LinkedEmails";


export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects, tasks, getUser } = useDataStore();
  const project = projects.find((p) => p.id === id);

  if (!project) {
    return <div className="p-6"><Button variant="outline" onClick={() => navigate("/projects")}><ArrowLeft className="h-4 w-4 mr-1.5" /> Back</Button><p className="mt-4">Project not found.</p></div>;
  }

  const projTasks = tasks.filter((t) => t.projectId === project.id);
  const owner = getUser(project.ownerId);

  return (
    <div>
      <PageHeader
        title={project.name}
        description={project.description}
        icon={<FolderKanban className="h-5 w-5" />}
        actions={
          <>
            <CompanyBadge companyId={project.companyId} />
            <ProjectStatusBadge status={project.status} />
            <RiskBadge risk={project.risk} />
            <Button variant="outline" size="sm" onClick={() => navigate("/projects")}>Back</Button>
          </>
        }
      />
      <div className="space-y-4 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Owner</p>
            <div className="mt-2 flex items-center gap-2"><UserAvatar userId={owner?.id} size="sm" /><span className="text-sm font-medium">{owner?.name}</span></div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Members</p>
            <div className="mt-2"><UserAvatarStack userIds={project.memberIds} max={5} /></div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Progress</p>
            <p className="mt-2 font-display text-xl font-semibold">{project.progress}%</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${project.progress}%` }} /></div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Due</p>
            <p className="mt-2 text-sm font-medium">{project.dueDate}</p>
            <p className="text-xs text-muted-foreground">Started {project.startDate}</p>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tasks">Tasks ({projTasks.length})</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="discussion">Discussion</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <h3 className="font-display text-sm font-semibold">About this project</h3>
            <p className="mt-2 text-sm text-muted-foreground">{project.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {project.tags?.map((t) => <span key={t} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs">#{t}</span>)}
            </div>
          </TabsContent>
          <TabsContent value="tasks" className="rounded-xl border border-border bg-surface shadow-card">
            <ul className="divide-y divide-border">
              {projTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 p-3.5 hover:bg-surface-muted/40">
                  <UserAvatar userId={t.assigneeId} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.key} · {t.title}</p>
                    <div className="mt-1 flex items-center gap-2"><PriorityBadge priority={t.priority} /><TaskStatusBadge status={t.status} /></div>
                  </div>
                  <span className="text-xs text-muted-foreground">{t.dueDate}</span>
                </li>
              ))}
              {projTasks.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No tasks yet.</p>}
            </ul>
          </TabsContent>
          <TabsContent value="team" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <ul className="grid gap-2 sm:grid-cols-2">
              {project.memberIds.map((id) => {
                const u = getUser(id);
                return <li key={id} className="flex items-center gap-3 rounded-lg border border-border p-3"><UserAvatar userId={id} size="md" /><div><p className="text-sm font-medium">{u?.name}</p><p className="text-xs text-muted-foreground">{u?.designation}</p></div></li>;
              })}
            </ul>
          </TabsContent>
          <TabsContent value="files" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-3 font-display text-sm font-semibold">Attachments</h3>
                <AttachmentList entityType="project" entityId={project.id} />
              </div>
              <div>
                <h3 className="mb-3 font-display text-sm font-semibold">Linked emails</h3>
                <LinkedEmails entityType="project" entityId={project.id} />
              </div>
            </div>
          </TabsContent>
          {["discussion","timeline","approvals","reports"].map((k) => (
            <TabsContent key={k} value={k} className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-card">
              {k.charAt(0).toUpperCase() + k.slice(1)} — coming next iteration.
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
