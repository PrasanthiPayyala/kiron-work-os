import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ApprovalStateBadge } from "@/components/StatusBadges";
import { UserAvatar } from "@/components/UserAvatar";
import { useDataStore } from "@/lib/dataStore";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Approval, ApprovalState, ApprovalKind } from "@/types";

type Decision = "approved" | "rejected" | "returned";

const routeLabel: Record<string, string> = {
  domain_only: "Domain only",
  domain_plus_manager: "Domain + Manager",
  domain_plus_founder: "Domain + Founder (critical)",
};

const decisionLabel: Record<Decision, string> = {
  approved: "Approve",
  rejected: "Reject",
  returned: "Return",
};

export default function Approvals() {
  const { approvals, getUser } = useDataStore();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | ApprovalKind>("all");
  const [scope, setScope] = useState<"all" | "mine_to_approve" | "mine_requested">("all");
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<{ approval: Approval; decision: Decision } | null>(null);
  const [note, setNote] = useState("");

  const filtered = useMemo(() => approvals.filter((a) => {
    if (kind !== "all" && a.kind !== kind) return false;
    if (scope === "mine_to_approve" && a.approverId !== user?.id) return false;
    if (scope === "mine_requested" && a.requestedById !== user?.id) return false;
    if (q) {
      const hay = `${a.refLabel} ${getUser(a.requestedById)?.name ?? ""} ${getUser(a.approverId)?.name ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [approvals, kind, scope, q, user, getUser]);

  const groups = useMemo(() => ({
    pending:  filtered.filter((a) => a.state === "pending"),
    approved: filtered.filter((a) => a.state === "approved"),
    rejected: filtered.filter((a) => a.state === "rejected"),
    returned: filtered.filter((a) => a.state === "returned"),
  }), [filtered]);

  const submit = async () => {
    if (!active || !user) return;
    const { approval, decision } = active;
    setPending((p) => ({ ...p, [approval.id]: true }));

    const patch: { status: ApprovalState; decided_at: string; approver_id: string; comments?: string } = {
      status: decision,
      decided_at: new Date().toISOString(),
      approver_id: user.id,
    };
    if (note.trim()) patch.comments = note.trim();

    const { error } = await supabase.from("approvals").update(patch).eq("id", approval.id);
    setPending((p) => ({ ...p, [approval.id]: false }));

    if (error) toast.error(error.message);
    else toast.success(`${decisionLabel[decision]}d`);

    setActive(null);
    setNote("");
  };

  const openDecide = (approval: Approval, decision: Decision) => {
    setActive({ approval, decision });
    setNote("");
  };

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Tasks, content, projects, and leave routes."
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by reference, requester, approver"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-72 pl-8"
            />
          </div>
          <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All approvals</SelectItem>
              <SelectItem value="mine_to_approve">Waiting on me</SelectItem>
              <SelectItem value="mine_requested">Raised by me</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="task_completion">Task</SelectItem>
              <SelectItem value="content">Content</SelectItem>
              <SelectItem value="project">Project</SelectItem>
              <SelectItem value="leave">Leave</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} shown · live</span>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending ({groups.pending.length})</TabsTrigger>
            <TabsTrigger value="approved">Approved ({groups.approved.length})</TabsTrigger>
            <TabsTrigger value="rejected">Rejected ({groups.rejected.length})</TabsTrigger>
            <TabsTrigger value="returned">Returned ({groups.returned.length})</TabsTrigger>
          </TabsList>
          {(Object.keys(groups) as (keyof typeof groups)[]).map((k) => (
            <TabsContent key={k} value={k} className="rounded-xl border border-border bg-surface shadow-card">
              <ul className="divide-y divide-border">
                {groups[k].length === 0 && (
                  <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>
                )}
                {groups[k].map((a) => {
                  const isPending = !!pending[a.id];
                  const canDecide = k === "pending" && a.approverId === user?.id;
                  return (
                    <li key={a.id} className="flex items-center gap-3 p-4 hover:bg-surface-muted/40">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs capitalize">{a.kind.replace("_", " ")}</span>
                          {a.route && (
                            <span className="rounded-md border border-border px-2 py-0.5 text-xs">{routeLabel[a.route]}</span>
                          )}
                          <ApprovalStateBadge state={a.state} />
                        </div>
                        <p className="mt-1 text-sm font-medium">{a.refLabel}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <UserAvatar userId={a.requestedById} size="xs" /> {getUser(a.requestedById)?.name}
                          </span>
                          <span>→</span>
                          <span className="flex items-center gap-1">
                            <UserAvatar userId={a.approverId} size="xs" /> {getUser(a.approverId)?.name}
                          </span>
                          <span>· {a.createdAt}</span>
                        </div>
                        {a.note && <p className="mt-1 text-xs italic text-muted-foreground">"{a.note}"</p>}
                      </div>
                      {k === "pending" && (
                        <div className="flex shrink-0 gap-2">
                          {!canDecide ? (
                            <span className="text-xs text-muted-foreground">Awaiting {getUser(a.approverId)?.name ?? "approver"}</span>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" disabled={isPending} onClick={() => openDecide(a, "returned")}>Return</Button>
                              <Button size="sm" variant="outline" disabled={isPending} className="text-destructive" onClick={() => openDecide(a, "rejected")}>Reject</Button>
                              <Button size="sm" disabled={isPending} onClick={() => openDecide(a, "approved")}>Approve</Button>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <Dialog open={!!active} onOpenChange={(o) => { if (!o) { setActive(null); setNote(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {active ? `${decisionLabel[active.decision]} — ${active.approval.refLabel}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs">
              Note {active?.decision === "approved" ? "(optional)" : "(recommended)"}
            </Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={
                active?.decision === "rejected"
                  ? "Why are you rejecting?"
                  : active?.decision === "returned"
                  ? "What needs to change before this can be approved?"
                  : "Add any context for the requester..."
              }
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActive(null); setNote(""); }}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={active ? !!pending[active.approval.id] : true}
              className={active?.decision === "rejected" ? "bg-destructive hover:bg-destructive/90" : ""}
            >
              Confirm {active ? decisionLabel[active.decision] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
