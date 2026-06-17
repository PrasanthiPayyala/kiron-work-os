import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TaskStatusBadge, PriorityBadge, VisibilityBadge } from "@/components/StatusBadges";
import { UserAvatar } from "@/components/UserAvatar";
import { ListChecks, LayoutGrid, List as ListIcon, Plus, Cloud, Loader2, Mail, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { taskStatusOut } from "@/lib/mappers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { LinkedEmails } from "@/components/mail/LinkedEmails";
import type { Task, TaskStatus } from "@/types";

const kanbanCols: { key: TaskStatus; label: string }[] = [
  { key: "created", label: "Created" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting_review", label: "Waiting Review" },
  { key: "waiting_approval", label: "Waiting Approval" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

export default function Tasks() {
  const { user } = useAuth();
  const { tasks: allTasks, companies, users, getUser, refresh } = useDataStore();
  const [view, setView] = useState<"list" | "kanban">("list");
  const [filter, setFilter] = useState<string>("all");
  const [company, setCompany] = useState<string>("all");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Task | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [fromEmail, setFromEmail] = useState<{ messageId: string; accountId?: string; title: string; description: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    priority: "medium" as "low" | "medium" | "high" | "critical",
    company_id: "",
    assignee_id: "",
  });
  const [createOpen, setCreateOpen] = useState(false);

  // Post-update (comment) state for the open task in the Sheet detail view.
  const [updateText, setUpdateText] = useState("");
  const [posting, setPosting] = useState(false);

  type ActivityRow = Awaited<ReturnType<typeof api.listTaskActivity>>[number];
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const loadActivity = async (taskId: string) => {
    setLoadingActivity(true);
    try {
      const rows = await api.listTaskActivity(taskId);
      setActivity(rows);
    } catch {
      setActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  };

  // Fetch activity whenever a task drawer opens or after a successful post.
  useEffect(() => {
    if (active) {
      void loadActivity(active.id);
      setEditingDetails(false);
    } else {
      setActivity([]);
      setUpdateText("");
    }
  }, [active?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Inline edit for reviewer / reporting manager / due date — fields most
  // commonly forgotten at create time. Reviewer needs this to take action.
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({
    reviewer_id: "",
    reporting_manager_id: "",
    due_date: "",
  });
  const [marking, setMarking] = useState(false);

  const openDetailsEdit = () => {
    if (!active) return;
    setDetailsDraft({
      reviewer_id: active.reviewerId ?? "",
      reporting_manager_id: active.reportingManagerId ?? "",
      due_date: active.dueDate ?? "",
    });
    setEditingDetails(true);
  };

  const saveDetails = async () => {
    if (!active) return;
    setSavingDetails(true);
    try {
      const patch: Record<string, unknown> = {
        reviewer_id: detailsDraft.reviewer_id || null,
        reporting_manager_id: detailsDraft.reporting_manager_id || null,
        due_at: detailsDraft.due_date
          ? new Date(`${detailsDraft.due_date}T23:59:00`).toISOString()
          : null,
      };
      await api.updateTask(active.id, patch);
      toast.success("Details updated");
      setEditingDetails(false);
      refresh();
    } catch (e) {
      toast.error("Couldn't save", { description: String((e as Error).message ?? e) });
    } finally {
      setSavingDetails(false);
    }
  };

  const markComplete = async () => {
    if (!active) return;
    setMarking(true);
    try {
      await api.updateTask(active.id, { status: taskStatusOut("done") });
      toast.success("Task marked complete");
      setActive({ ...active, status: "done" });
      void loadActivity(active.id);
      refresh();
    } catch (e) {
      toast.error("Couldn't mark complete", { description: String((e as Error).message ?? e) });
    } finally {
      setMarking(false);
    }
  };

  useEffect(() => {
    if (searchParams.get("from_email") === "1") {
      const messageId = searchParams.get("message_id") || "";
      const title = searchParams.get("title") || "";
      const description = searchParams.get("description") || "";
      if (messageId) {
        setFromEmail({ messageId, title, description });
        setDraft({
          title, description, priority: "medium",
          company_id: user?.homeCompanyId ?? "",
          assignee_id: user?.id ?? "",
        });
      }
      // clear params so refresh doesn't reopen
      const next = new URLSearchParams(searchParams);
      ["from_email", "message_id", "title", "description"].forEach((k) => next.delete(k));
      setSearchParams(next, { replace: true });
    }
    // ?create=1 lands here from the topbar Quick Add — open the dialog
    // immediately and clear the param so it doesn't re-fire on reload.
    if (searchParams.get("create") === "1") {
      openCreate();
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, user?.id]);

  const handleCreateFromEmail = async () => {
    if (!fromEmail || !user) return;
    if (!draft.title.trim()) return toast.error("Title is required");
    setCreating(true);
    try {
      const task = await api.createTask({
        title: draft.title,
        description: draft.description || null,
        priority: draft.priority,
        status: "created",
        company_id: user.homeCompanyId,
        assignee_id: user.id,
      });
      // Linking the source email lives in the mail module (later phase). Best-effort
      // so task creation still succeeds before mail is migrated off Supabase.
      try {
        const { data: msg } = await supabase
          .from("email_messages")
          .select("account_id")
          .eq("id", fromEmail.messageId)
          .maybeSingle();
        if (msg?.account_id && task?.id) {
          await supabase.from("email_links").insert({
            message_id: fromEmail.messageId,
            account_id: msg.account_id,
            entity_type: "task",
            entity_id: task.id as string,
            linked_by: user.id,
          });
        }
      } catch {
        /* mail not migrated yet */
      }
      toast.success("Task created from email");
      setFromEmail(null);
    } catch (e) {
      toast.error("Failed to create task", { description: String((e as Error).message ?? e) });
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    if (!user) return;
    setDraft({
      title: "",
      description: "",
      priority: "medium",
      company_id: user.homeCompanyId,
      assignee_id: user.id,
    });
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!draft.title.trim()) return toast.error("Title is required");
    if (!draft.company_id) return toast.error("Company is required");
    setCreating(true);
    try {
      await api.createTask({
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        priority: draft.priority,
        status: "created",
        company_id: draft.company_id,
        assignee_id: draft.assignee_id || null,
      });
      toast.success("Task created");
      setCreateOpen(false);
      refresh();
    } catch (e) {
      toast.error("Failed to create task", { description: String((e as Error).message ?? e) });
    } finally {
      setCreating(false);
    }
  };

  const handlePostUpdate = async () => {
    if (!active) return;
    const text = updateText.trim();
    if (!text) return toast.error("Type an update before posting");
    setPosting(true);
    try {
      await api.addTaskActivity(active.id, {
        activity_type: "comment",
        message: text,
        note: text,
      });
      setUpdateText("");
      toast.success("Update posted");
      void loadActivity(active.id);
      refresh();
    } catch (e) {
      toast.error("Couldn't post update", { description: String((e as Error).message ?? e) });
    } finally {
      setPosting(false);
    }
  };

  const handleSyncToExternal = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("call-node-api", {
        body: {
          path: "/v1/echo",
          method: "POST",
          body: { source: "kiron.tasks", at: new Date().toISOString() },
        },
      });
      if (error) throw error;
      toast.success("Synced to external system", {
        description: `Status ${data?.status ?? "?"} from Node service.`,
      });
    } catch (err) {
      toast.error("Sync failed", { description: String((err as Error).message ?? err) });
    } finally {
      setSyncing(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => allTasks.filter((t) => {
    if (company !== "all" && t.companyId !== company) return false;
    if (q && !`${t.key} ${t.title}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "mine") return t.assigneeId === user?.id;
    if (filter === "due_today") return t.dueDate === today;
    if (filter === "overdue") return t.dueDate && t.dueDate < today && t.status !== "done";
    if (filter === "high") return t.priority === "high" || t.priority === "critical";
    if (filter === "review") return t.status === "waiting_review";
    if (filter === "blocked") return t.status === "blocked" || t.status === "escalated";
    if (filter === "recurring") return !!t.recurrence;
    return true;
  }), [allTasks, filter, company, q, user, today]);

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="All tasks across companies — assignee, reviewer, SLA, dependencies."
        icon={<ListChecks className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleSyncToExternal} disabled={syncing}>
              {syncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Cloud className="h-4 w-4 mr-1.5" />}
              Sync to External System
            </Button>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" /> Create task</Button>
          </div>
        }
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Input placeholder="Search tasks..." className="h-9 max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tasks</SelectItem>
              <SelectItem value="mine">Assigned to me</SelectItem>
              <SelectItem value="due_today">Due today</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="high">High priority</SelectItem>
              <SelectItem value="review">Waiting review</SelectItem>
              <SelectItem value="blocked">Blocked / escalated</SelectItem>
              <SelectItem value="recurring">Recurring</SelectItem>
            </SelectContent>
          </Select>
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.shortName}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <button onClick={() => setView("list")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><ListIcon className="h-3.5 w-3.5" /> List</button>
            <button onClick={() => setView("kanban")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><LayoutGrid className="h-3.5 w-3.5" /> Kanban</button>
          </div>
        </div>

        {view === "list" ? (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Key</th>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Assignee</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const done = t.status === "done";
                  return (
                  <tr key={t.id} className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40 ${done ? "text-muted-foreground" : ""}`} onClick={() => setActive(t)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.key}</td>
                    <td className={`px-4 py-2.5 font-medium ${done ? "line-through" : ""}`}>{t.title}</td>
                    <td className="px-4 py-2.5"><CompanyBadge companyId={t.companyId} size="xs" /></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><UserAvatar userId={t.assigneeId} size="xs" /><span className="text-xs">{getUser(t.assigneeId)?.name}</span></div></td>
                    <td className="px-4 py-2.5"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-4 py-2.5"><TaskStatusBadge status={t.status} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.dueDate ?? "—"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kanbanCols.map((col) => {
              const items = filtered.filter((t) => t.status === col.key);
              return (
                <div key={col.key} className="flex flex-col rounded-xl border border-border bg-surface-muted/40 p-2">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{col.label}</h3>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((t) => {
                      const done = t.status === "done";
                      return (
                      <button key={t.id} onClick={() => setActive(t)} className={`w-full rounded-lg border border-border bg-surface p-2.5 text-left shadow-card hover:border-primary/30 ${done ? "opacity-70" : ""}`}>
                        <div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-muted-foreground">{t.key}</span><PriorityBadge priority={t.priority} /></div>
                        <p className={`mt-1.5 text-sm font-medium leading-snug ${done ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                        <div className="mt-2 flex items-center justify-between"><CompanyBadge companyId={t.companyId} size="xs" showName={false} /><UserAvatar userId={t.assigneeId} size="xs" /></div>
                      </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Task drawer */}
      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {active && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{active.key}</span>
                  <CompanyBadge companyId={active.companyId} size="xs" />
                </div>
                <SheetTitle className="text-left font-display">{active.title}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge status={active.status} />
                  <PriorityBadge priority={active.priority} />
                  <VisibilityBadge visibility={active.visibility} />
                  {active.recurrence && <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs capitalize">Recurring · {active.recurrence.cadence}</span>}
                  {active.status !== "done" && (
                    <Button size="sm" variant="default" className="ml-auto h-7" onClick={markComplete} disabled={marking}>
                      {marking ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                      Mark complete
                    </Button>
                  )}
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Details</p>
                    {!editingDetails && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={openDetailsEdit}>
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </Button>
                    )}
                  </div>
                  {!editingDetails ? (
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <Field label="Assignee" value={getUser(active.assigneeId)?.name} avatarId={active.assigneeId} />
                      <Field label="Reviewer" value={getUser(active.reviewerId)?.name ?? "Not set"} avatarId={active.reviewerId} />
                      <Field label="Reporting manager" value={getUser(active.reportingManagerId)?.name ?? "Not set"} avatarId={active.reportingManagerId} />
                      <Field label="Created by" value={getUser(active.createdById)?.name} avatarId={active.createdById} />
                      <Field label="Due" value={active.dueDate ?? "Not set"} />
                      <Field label="SLA" value={active.slaHours ? `${active.slaHours}h` : "—"} />
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Reviewer</Label>
                        <Select
                          value={detailsDraft.reviewer_id || "__none__"}
                          onValueChange={(v) => setDetailsDraft({ ...detailsDraft, reviewer_id: v === "__none__" ? "" : v })}
                        >
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Not set</SelectItem>
                            {users.filter((u) => u.isActive).map((u) => (
                              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Reporting manager</Label>
                        <Select
                          value={detailsDraft.reporting_manager_id || "__none__"}
                          onValueChange={(v) => setDetailsDraft({ ...detailsDraft, reporting_manager_id: v === "__none__" ? "" : v })}
                        >
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Not set</SelectItem>
                            {users.filter((u) => u.isActive).map((u) => (
                              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Due date</Label>
                        <Input
                          type="date"
                          value={detailsDraft.due_date}
                          onChange={(e) => setDetailsDraft({ ...detailsDraft, due_date: e.target.value })}
                          className="mt-1 h-9"
                        />
                      </div>
                      <div className="col-span-2 flex items-center justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingDetails(false)} disabled={savingDetails}>Cancel</Button>
                        <Button size="sm" onClick={saveDetails} disabled={savingDetails}>
                          {savingDetails && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {active.labels && active.labels.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Labels</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">{active.labels.map((l) => <span key={l} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs">{l}</span>)}</div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity</p>
                  <ul className="mt-2 space-y-2">
                    {loadingActivity && (
                      <li className="rounded-md border border-border p-2.5 text-xs text-muted-foreground">Loading…</li>
                    )}
                    {!loadingActivity && activity.length === 0 && (
                      <li className="rounded-md border border-border p-2.5 text-xs text-muted-foreground">No updates yet — post one below.</li>
                    )}
                    {activity.map((a) => {
                      const actor = a.actor_user_id ? getUser(a.actor_user_id) : null;
                      const body = a.message || a.note || "";
                      return (
                        <li key={a.id} className="rounded-md border border-border p-2.5">
                          <p className="text-xs text-muted-foreground">
                            {a.created_at}{actor ? ` · ${actor.name}` : ""}{a.activity_type && a.activity_type !== "comment" ? ` · ${a.activity_type.replace("_", " ")}` : ""}
                          </p>
                          {body && <p className="mt-1 whitespace-pre-wrap text-sm">{body}</p>}
                        </li>
                      );
                    })}
                    <li className="rounded-md border border-border border-dashed p-2.5"><p className="text-xs text-muted-foreground">{active.createdAt}</p><p className="text-sm">Task created by {getUser(active.createdById)?.name}</p></li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attachments</p>
                  <div className="mt-2">
                    <AttachmentList entityType="task" entityId={active.id} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked emails</p>
                  <div className="mt-2">
                    <LinkedEmails entityType="task" entityId={active.id} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add update</p>
                  <textarea
                    value={updateText}
                    onChange={(e) => setUpdateText(e.target.value)}
                    className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
                    rows={3}
                    placeholder="Status update or comment..."
                  />
                  <Button size="sm" className="mt-2" onClick={handlePostUpdate} disabled={posting || !updateText.trim()}>
                    {posting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Post update
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!fromEmail} onOpenChange={(o) => !o && setFromEmail(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Create task from email</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={4}
                className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={draft.priority} onValueChange={(v: "low" | "medium" | "high" | "critical") => setDraft({ ...draft, priority: v })}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFromEmail(null)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreateFromEmail} disabled={creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Standalone Create task dialog (opened by the Create task button
          on this page AND by Quick Add in the topbar). Five fields per
          the user's "minimal" choice — title, company, assignee,
          priority, due date is implicit-not-yet-supported because the
          backend POST doesn't accept it (description carries that). */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && !creating && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Create task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Title *</Label>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="What needs doing?" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
                placeholder="Context, links, acceptance criteria..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Company *</Label>
                <Select value={draft.company_id} onValueChange={(v) => setDraft({ ...draft, company_id: v })}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {companies.filter((c) => c.isActive).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Priority</Label>
                <Select value={draft.priority} onValueChange={(v: "low" | "medium" | "high" | "critical") => setDraft({ ...draft, priority: v })}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Assignee</Label>
              <Select
                value={
                  !draft.assignee_id
                    ? "__unassigned__"
                    : draft.assignee_id === user?.id
                      ? "__me__"
                      : draft.assignee_id
                }
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    assignee_id: v === "__me__" ? (user?.id ?? "") : v === "__unassigned__" ? "" : v,
                  })
                }
              >
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__me__">Me ({user?.name})</SelectItem>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {users
                    .filter((u) => u.isActive && u.id !== user?.id)
                    .map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, avatarId }: { label: string; value?: string; avatarId?: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {avatarId && <UserAvatar userId={avatarId} size="xs" />}
        <span className="text-sm">{value ?? "—"}</span>
      </div>
    </div>
  );
}
