import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { PageHeader } from "@/components/PageHeader";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { UserAvatar } from "@/components/UserAvatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { taskStatusOut } from "@/lib/mappers";
import { toast } from "sonner";
import type { Task, TaskStatus, Priority } from "@/types";

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "created",          label: "Created" },
  { value: "accepted",         label: "Accepted" },
  { value: "in_progress",      label: "In Progress" },
  { value: "waiting_review",   label: "Waiting Review" },
  { value: "waiting_approval", label: "Waiting Approval" },
  { value: "blocked",          label: "Blocked" },
  { value: "on_hold",          label: "On Hold" },
  { value: "done",             label: "Done" },
];

const priorityOptions: { value: Priority; label: string }[] = [
  { value: "low",      label: "Low" },
  { value: "medium",   label: "Medium" },
  { value: "high",     label: "High" },
  { value: "critical", label: "Critical" },
];

type Draft = {
  status: TaskStatus;
  priority: Priority;
  dueDate: string; // YYYY-MM-DD or ""
  assigneeId: string;
  note: string;
};

const draftFrom = (t: Task): Draft => ({
  status: t.status,
  priority: t.priority,
  dueDate: t.dueDate ?? "",
  assigneeId: t.assigneeId ?? "",
  note: "",
});

export default function MyWork() {
  const { user } = useAuth();
  const { tasks, users, getUser, refresh } = useDataStore();
  const [active, setActive] = useState<Task | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const mine = useMemo(
    () => tasks.filter((t) => t.assigneeId === user?.id),
    [tasks, user?.id],
  );
  const reviews = useMemo(
    () => tasks.filter((t) => t.reviewerId === user?.id && (t.status === "waiting_review" || t.status === "waiting_approval")),
    [tasks, user?.id],
  );

  // Pool of assignee candidates for the quick reassign — limit to people in the same company.
  const assigneeCandidates = useMemo(() => {
    if (!active) return users;
    return users.filter((u) => u.homeCompanyId === active.companyId);
  }, [users, active]);

  const openTask = (t: Task) => {
    setActive(t);
    setDraft(draftFrom(t));
  };

  const close = () => {
    setActive(null);
    setDraft(null);
  };

  const dirty = useMemo(() => {
    if (!active || !draft) return false;
    return (
      draft.status !== active.status ||
      draft.priority !== active.priority ||
      (draft.dueDate || "") !== (active.dueDate ?? "") ||
      (draft.assigneeId || "") !== (active.assigneeId ?? "") ||
      !!draft.note.trim()
    );
  }, [active, draft]);

  const save = async () => {
    if (!active || !draft || !user) return;
    if (!dirty) return close();

    setSaving(true);
    const patch: Record<string, unknown> = {};
    if (draft.status !== active.status) patch.status = taskStatusOut(draft.status);
    if (draft.priority !== active.priority) patch.priority = draft.priority;
    if ((draft.dueDate || null) !== (active.dueDate ?? null)) {
      patch.due_at = draft.dueDate ? new Date(`${draft.dueDate}T23:59:00`).toISOString() : null;
    }
    if ((draft.assigneeId || null) !== (active.assigneeId ?? null)) {
      patch.assignee_id = draft.assigneeId || null;
    }

    let taskErr: { message: string } | null = null;
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("tasks").update(patch).eq("id", active.id);
      taskErr = error;
    }

    let noteErr: { message: string } | null = null;
    if (!taskErr && draft.note.trim()) {
      const { error } = await supabase.from("task_activity").insert({
        task_id: active.id,
        actor_user_id: user.id,
        activity_type: "comment",
        message: draft.note.trim(),
        note: draft.note.trim(),
      });
      noteErr = error;
    }

    setSaving(false);
    if (taskErr) return toast.error(taskErr.message);
    if (noteErr) toast.warning("Saved, but couldn't post update", { description: noteErr.message });
    else toast.success("Task updated");
    refresh();
    close();
  };

  return (
    <div>
      <PageHeader
        title="My Work"
        description="Everything assigned to you across Kiron Group."
        icon={<Briefcase className="h-5 w-5" />}
      />
      <div className="space-y-4 p-6">
        <Section title={`Assigned to me (${mine.length})`} items={mine} onPick={openTask} />
        <Section title={`Awaiting my review (${reviews.length})`} items={reviews} onPick={openTask} />
      </div>

      <Sheet open={!!active} onOpenChange={(o) => !o && close()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {active && draft && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{active.key}</span>
                  <CompanyBadge companyId={active.companyId} size="xs" />
                </div>
                <SheetTitle className="text-left font-display">{active.title}</SheetTitle>
              </SheetHeader>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <TaskStatusBadge status={active.status} />
                <PriorityBadge priority={active.priority} />
                {active.dueDate && (
                  <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    Due {active.dueDate}
                  </span>
                )}
              </div>

              {active.description && (
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{active.description}</p>
              )}

              <div className="mt-5 rounded-lg border border-border bg-surface-muted/30 p-4">
                <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                  <Pencil className="h-3.5 w-3.5" /> Quick edit
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Status</Label>
                    <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as TaskStatus })}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Priority</Label>
                    <Select value={draft.priority} onValueChange={(v) => setDraft({ ...draft, priority: v as Priority })}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {priorityOptions.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Due date</Label>
                    <Input
                      type="date"
                      value={draft.dueDate}
                      onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Assignee</Label>
                    <Select
                      value={draft.assigneeId || "unassigned"}
                      onValueChange={(v) => setDraft({ ...draft, assigneeId: v === "unassigned" ? "" : v })}
                    >
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {assigneeCandidates.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-3">
                  <Label className="text-xs">Add update / comment</Label>
                  <textarea
                    rows={3}
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    placeholder="What changed, what's blocked, what's next..."
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
                  />
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={close} disabled={saving}>Cancel</Button>
                  <Button size="sm" onClick={save} disabled={saving || !dirty}>
                    {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Reviewer: {getUser(active.reviewerId)?.name ?? "—"}</div>
                <div>Reporting: {getUser(active.reportingManagerId)?.name ?? "—"}</div>
                <div>Created: {active.createdAt}</div>
                <div>Updated: {active.updatedAt}</div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Section({ title, items, onPick }: { title: string; items: Task[]; onPick: (t: Task) => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border p-4">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
      </div>
      <ul className="divide-y divide-border">
        {items.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">Nothing here.</p>
        )}
        {items.map((t) => (
          <li
            key={t.id}
            onClick={() => onPick(t)}
            className="flex cursor-pointer items-center gap-3 p-3.5 hover:bg-surface-muted/40"
          >
            <UserAvatar userId={t.assigneeId} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.key} · {t.title}</p>
              <div className="mt-1 flex items-center gap-2">
                <CompanyBadge companyId={t.companyId} size="xs" />
                <PriorityBadge priority={t.priority} />
                <TaskStatusBadge status={t.status} />
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{t.dueDate ?? "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
