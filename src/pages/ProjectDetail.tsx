import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDataStore } from "@/lib/dataStore";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { CompanyBadge } from "@/components/CompanyBadge";
import { ProjectStatusBadge, RiskBadge, TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { UserAvatarStack, UserAvatar } from "@/components/UserAvatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FolderKanban, Pencil, Trash2, UserPlus, X, Loader2, Plus, CheckCircle2, Circle, ChevronRight, RefreshCw, Calendar } from "lucide-react";
import { useEffect } from "react";
import type { MilestoneRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import type { Project, ProjectStatus, Risk } from "@/types";

const GLOBAL_ROLES = new Set(["super_admin", "founder", "founder_office_coordinator", "founder_office_support"]);

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { projects, tasks, getUser, refresh } = useDataStore();
  const project = projects.find((p) => p.id === id);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!project) {
    return (
      <div className="p-6">
        <Button variant="outline" onClick={() => navigate("/projects")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
        <p className="mt-4">Project not found.</p>
      </div>
    );
  }

  const projTasks = tasks.filter((t) => t.projectId === project.id);
  const owner = getUser(project.ownerId);
  const canManage =
    (role && GLOBAL_ROLES.has(role)) ||
    user?.id === project.ownerId ||
    user?.id === project.createdById;

  const deleteProject = async () => {
    try {
      await api.deleteProject(project.id);
      toast.success("Project deleted");
      refresh();
      navigate("/projects");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete project");
    }
  };

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
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4 mr-1.5" /> Edit
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate("/projects")}>Back</Button>
          </>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Owner</p>
            <div className="mt-2 flex items-center gap-2">
              <UserAvatar userId={owner?.id} size="sm" />
              <span className="text-sm font-medium">{owner?.name ?? "—"}</span>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Members</p>
            <div className="mt-2"><UserAvatarStack userIds={project.memberIds} max={5} /></div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Progress</p>
              {project.progressMode === "auto" && (
                <button
                  onClick={async () => {
                    try {
                      await api.recomputeProjectProgress(project.id);
                      toast.success("Progress recomputed");
                      refresh();
                    } catch (e) {
                      toast.error(e instanceof ApiError ? e.message : "Couldn't recompute");
                    }
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                  title="Recompute from tasks"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="mt-2 font-display text-xl font-semibold">{project.progress}%</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${project.progress}%` }} />
            </div>
            {project.progressMode === "auto" && (
              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">auto (from tasks)</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Due</p>
            <p className="mt-2 text-sm font-medium">{project.dueDate || "—"}</p>
            <p className="text-xs text-muted-foreground">Started {project.startDate || "—"}</p>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tasks">Tasks ({projTasks.length})</TabsTrigger>
            <TabsTrigger value="team">Team ({project.memberIds.length})</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="discussion">Discussion</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <h3 className="font-display text-sm font-semibold">About this project</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{project.description || "No description yet."}</p>

            <ProjectMeta project={project} />

            {project.techStack && project.techStack.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tech stack</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.techStack.map((t) => (
                    <span key={t} className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {project.tags && project.tags.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tags</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {project.tags.map((t) => <span key={t} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs">#{t}</span>)}
                </div>
              </div>
            )}
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
                  <span className="text-xs text-muted-foreground">{t.dueDate ?? "—"}</span>
                </li>
              ))}
              {projTasks.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No tasks yet.</p>}
            </ul>
          </TabsContent>

          <TabsContent value="team" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <TeamPanel project={project} canManage={!!canManage} />
          </TabsContent>

          <TabsContent value="files" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <AttachmentList entityType="project" entityId={project.id} />
          </TabsContent>

          <TabsContent value="timeline" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <MilestonesPanel projectId={project.id} canManage={!!canManage} />
          </TabsContent>

          {["discussion", "approvals", "reports"].map((k) => (
            <TabsContent key={k} value={k} className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-card">
              {k.charAt(0).toUpperCase() + k.slice(1)} — coming next iteration.
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <EditProjectSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={project}
        onSaved={() => { refresh(); setEditOpen(false); }}
      />

      <Dialog open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this project?</DialogTitle>
            <DialogDescription>
              Tasks under this project will be kept but lose their project link. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button className="bg-destructive hover:bg-destructive/90" onClick={() => { setDeleteOpen(false); void deleteProject(); }}>
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Team panel: list + add/remove members ----------

function TeamPanel({ project, canManage }: { project: Project; canManage: boolean }) {
  const { users, getUser, refresh } = useDataStore();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(
    () => users.filter((u) => !project.memberIds.includes(u.id)),
    [users, project.memberIds],
  );

  const add = async (uid: string) => {
    setBusy(true);
    try {
      await api.addProjectMember(project.id, uid);
      toast.success(`Added ${getUser(uid)?.name ?? "member"}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't add member");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (uid: string) => {
    if (uid === project.ownerId) return toast.error("Reassign the owner first");
    try {
      await api.removeProjectMember(project.id, uid);
      toast.success("Removed");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't remove member");
    }
  };

  return (
    <>
      {canManage && (
        <div className="mb-3 flex justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                <UserPlus className="h-4 w-4 mr-1.5" /> Add member
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold">Add to project</div>
              <ul className="max-h-72 overflow-y-auto">
                {candidates.length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground">Everyone's already a member.</li>
                )}
                {candidates.map((u) => (
                  <li
                    key={u.id}
                    onClick={() => void add(u.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted",
                      busy && "pointer-events-none opacity-50",
                    )}
                  >
                    <UserAvatar userId={u.id} size="xs" />
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className="text-[11px] text-muted-foreground">{u.designation}</span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {project.memberIds.map((id) => {
          const u = getUser(id);
          const isOwner = id === project.ownerId;
          return (
            <li key={id} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <UserAvatar userId={id} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u?.name ?? "—"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {u?.designation}{isOwner && " · Owner"}
                </p>
              </div>
              {canManage && !isOwner && id !== user?.id && (
                <button
                  onClick={() => void remove(id)}
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                  title="Remove from project"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------- Edit project sheet ----------

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "planning",  label: "Planning" },
  { value: "active",    label: "Active" },
  { value: "on_hold",   label: "On hold" },
  { value: "at_risk",   label: "At risk" },
  { value: "completed", label: "Completed" },
];

const RISK_OPTIONS: { value: Risk; label: string }[] = [
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
];

function EditProjectSheet({
  open, onClose, project, onSaved,
}: { open: boolean; onClose: () => void; project: Project; onSaved: () => void }) {
  const { users } = useDataStore();
  const [title, setTitle] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [statusValue, setStatusValue] = useState<ProjectStatus>(project.status);
  const [risk, setRisk] = useState<Risk>(project.risk);
  const [progress, setProgress] = useState(String(project.progress));
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [dueDate, setDueDate] = useState(project.dueDate ?? "");
  const [ownerId, setOwnerId] = useState(project.ownerId);
  const [busy, setBusy] = useState(false);

  // Reset form whenever the sheet opens against a (possibly different) project.
  useMemo(() => {
    if (open) {
      setTitle(project.name);
      setDescription(project.description ?? "");
      setStatusValue(project.status);
      setRisk(project.risk);
      setProgress(String(project.progress));
      setStartDate(project.startDate ?? "");
      setDueDate(project.dueDate ?? "");
      setOwnerId(project.ownerId);
    }
  }, [open, project.id]);

  const sameCompanyUsers = users.filter((u) => u.homeCompanyId === project.companyId);

  const save = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setBusy(true);
    try {
      await api.updateProject(project.id, {
        title: title.trim(),
        description: description.trim() || null,
        status: statusValue,
        risk_level: risk,
        progress: Math.max(0, Math.min(100, Number(progress) || 0)),
        start_date: startDate || null,
        due_date: dueDate || null,
        owner_id: ownerId,
      });
      toast.success("Project updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-left font-display">Edit project</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusValue} onValueChange={(v) => setStatusValue(v as ProjectStatus)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Risk</Label>
              <Select value={risk} onValueChange={(v) => setRisk(v as Risk)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RISK_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Progress</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sameCompanyUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 h-9" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ===================== Project meta line =====================
// Inlined under Overview tab — shows the new phase-3 metadata that
// didn't have a card slot up top (kind, team link, progress mode).

function ProjectMeta({ project }: { project: Project }) {
  const { teams } = useDataStore();
  const team = project.teamId ? teams.find((t) => t.id === project.teamId) : null;
  const kindLabel: Record<string, string> = {
    internal: "Internal", client: "Client", rnd: "R&D",
    hackathon: "Hackathon", other: "Other",
  };
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Kind</p>
        <p className="mt-0.5 text-sm">{kindLabel[project.kind] ?? project.kind}</p>
      </div>
      {team && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Team</p>
          <a
            href={`/teams/${team.id}`}
            className="mt-0.5 text-sm text-primary hover:underline"
          >
            {team.name}
          </a>
        </div>
      )}
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Progress mode</p>
        <p className="mt-0.5 text-sm capitalize">
          {project.progressMode === "auto" ? "Auto (from tasks)" : "Manual"}
        </p>
      </div>
    </div>
  );
}

// ===================== Milestones panel =====================
// Replaces the old Timeline placeholder. A milestone is a named
// phase within the project. The owner / manager can add, edit
// (status / title / due), and remove. Other members see read-only.

function MilestonesPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [rows, setRows] = useState<MilestoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.listMilestones(projectId));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load milestones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [projectId]);

  const flipStatus = async (m: MilestoneRow) => {
    if (!canManage) return;
    // Cycle: planned → in_progress → done → planned. Skipped stays as is.
    const next: MilestoneRow["status"] =
      m.status === "planned" ? "in_progress" :
      m.status === "in_progress" ? "done" :
      m.status === "done" ? "planned" : "planned";
    try {
      await api.updateMilestone(m.id, { status: next });
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update");
    }
  };

  const remove = async (id: string) => {
    if (!canManage) return;
    if (!confirm("Delete this milestone?")) return;
    try {
      await api.deleteMilestone(id);
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold">Milestones</h3>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add milestone
          </Button>
        )}
      </div>

      {loading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No milestones yet. {canManage ? "Add one to mark a phase of this project." : ""}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {rows.map((m) => {
          const Icon = m.status === "done" ? CheckCircle2
                     : m.status === "in_progress" ? ChevronRight
                     : Circle;
          const accent = m.status === "done" ? "text-success" :
                          m.status === "in_progress" ? "text-primary" :
                          m.status === "skipped" ? "text-muted-foreground line-through" :
                          "text-muted-foreground";
          return (
            <li
              key={m.id}
              className={cn(
                "flex items-start gap-3 rounded-md border border-border p-3",
                m.status === "done" && "bg-success/5",
              )}
            >
              <button
                onClick={() => void flipStatus(m)}
                disabled={!canManage}
                className={cn("mt-0.5 shrink-0", canManage && "hover:opacity-80")}
                title={canManage ? "Click to advance status" : ""}
              >
                <Icon className={cn("h-5 w-5", accent)} />
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", m.status === "skipped" && "line-through text-muted-foreground")}>
                  {m.title}
                </p>
                {m.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-wrap">{m.description}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-surface-muted px-1.5 py-0.5 uppercase tracking-wide">
                    {m.status.replace("_", " ")}
                  </span>
                  {m.due_date && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {m.due_date}
                    </span>
                  )}
                </div>
              </div>
              {canManage && (
                <button
                  onClick={() => void remove(m.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                  title="Delete milestone"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {adding && (
        <AddMilestoneDialog
          projectId={projectId}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load(); }}
          nextPosition={rows.length}
        />
      )}
    </div>
  );
}

function AddMilestoneDialog({
  projectId, onClose, onSaved, nextPosition,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
  nextPosition: number;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<MilestoneRow["status"]>("planned");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setBusy(true);
    try {
      await api.createMilestone(projectId, {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        status,
        position: nextPosition,
      });
      toast.success("Milestone added");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New milestone</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9" placeholder="e.g. Kickoff, Auth done, Beta launch" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as MilestoneRow["status"])}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
