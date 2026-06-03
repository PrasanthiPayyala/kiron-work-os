import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TaskStatusBadge, PriorityBadge, VisibilityBadge } from "@/components/StatusBadges";
import { UserAvatar } from "@/components/UserAvatar";
import { ListChecks, LayoutGrid, List as ListIcon, Plus, Cloud, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  const { tasks: allTasks, companies, getUser } = useDataStore();
  const [view, setView] = useState<"list" | "kanban">("list");
  const [filter, setFilter] = useState<string>("all");
  const [company, setCompany] = useState<string>("all");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Task | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [fromEmail, setFromEmail] = useState<{ messageId: string; accountId?: string; title: string; description: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", priority: "medium" as "low" | "medium" | "high" | "critical" });

  useEffect(() => {
    if (searchParams.get("from_email") === "1") {
      const messageId = searchParams.get("message_id") || "";
      const title = searchParams.get("title") || "";
      const description = searchParams.get("description") || "";
      if (messageId) {
        setFromEmail({ messageId, title, description });
        setDraft({ title, description, priority: "medium" });
      }
      // clear params so refresh doesn't reopen
      const next = new URLSearchParams(searchParams);
      ["from_email", "message_id", "title", "description"].forEach((k) => next.delete(k));
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
            <Button size="sm"><Plus className="h-4 w-4 mr-1.5" /> Create task</Button>
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
                {filtered.map((t) => (
                  <tr key={t.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40" onClick={() => setActive(t)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.key}</td>
                    <td className="px-4 py-2.5 font-medium">{t.title}</td>
                    <td className="px-4 py-2.5"><CompanyBadge companyId={t.companyId} size="xs" /></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><UserAvatar userId={t.assigneeId} size="xs" /><span className="text-xs">{getUser(t.assigneeId)?.name}</span></div></td>
                    <td className="px-4 py-2.5"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-4 py-2.5"><TaskStatusBadge status={t.status} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.dueDate ?? "—"}</td>
                  </tr>
                ))}
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
                    {items.map((t) => (
                      <button key={t.id} onClick={() => setActive(t)} className="w-full rounded-lg border border-border bg-surface p-2.5 text-left shadow-card hover:border-primary/30">
                        <div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-muted-foreground">{t.key}</span><PriorityBadge priority={t.priority} /></div>
                        <p className="mt-1.5 text-sm font-medium leading-snug">{t.title}</p>
                        <div className="mt-2 flex items-center justify-between"><CompanyBadge companyId={t.companyId} size="xs" showName={false} /><UserAvatar userId={t.assigneeId} size="xs" /></div>
                      </button>
                    ))}
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
                <div className="flex flex-wrap gap-2">
                  <TaskStatusBadge status={active.status} />
                  <PriorityBadge priority={active.priority} />
                  <VisibilityBadge visibility={active.visibility} />
                  {active.recurrence && <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs capitalize">Recurring · {active.recurrence.cadence}</span>}
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
                  <Field label="Assignee" value={getUser(active.assigneeId)?.name} avatarId={active.assigneeId} />
                  <Field label="Reviewer" value={getUser(active.reviewerId)?.name} avatarId={active.reviewerId} />
                  <Field label="Reporting manager" value={getUser(active.reportingManagerId)?.name} avatarId={active.reportingManagerId} />
                  <Field label="Created by" value={getUser(active.createdById)?.name} avatarId={active.createdById} />
                  <Field label="Due" value={active.dueDate ?? "—"} />
                  <Field label="SLA" value={active.slaHours ? `${active.slaHours}h` : "—"} />
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
                    <li className="rounded-md border border-border p-2.5"><p className="text-xs text-muted-foreground">{active.updatedAt}</p><p className="text-sm">Status moved to <strong className="capitalize">{active.status.replace("_"," ")}</strong></p></li>
                    <li className="rounded-md border border-border p-2.5"><p className="text-xs text-muted-foreground">{active.createdAt}</p><p className="text-sm">Task created by {getUser(active.createdById)?.name}</p></li>
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
                  <textarea className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm" rows={3} placeholder="Required: status update or comment..." />
                  <Button size="sm" className="mt-2">Post update</Button>
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
