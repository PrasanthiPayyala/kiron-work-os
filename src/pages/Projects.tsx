import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { CompanyBadge } from "@/components/CompanyBadge";
import { ProjectStatusBadge, RiskBadge } from "@/components/StatusBadges";
import { UserAvatar, UserAvatarStack } from "@/components/UserAvatar";
import { useDataStore } from "@/lib/dataStore";
import { useAuth, can } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import {
  FolderKanban, LayoutGrid, Table as TableIcon, Plus, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Projects() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, role } = useAuth();
  const { projects, companies, users, getUser, refresh } = useDataStore();
  const [view, setView] = useState<"cards" | "table">("cards");
  const [company, setCompany] = useState<string>(params.get("company") ?? "all");
  const [status, setStatus] = useState<string>("all");
  const [risk, setRisk] = useState<string>("all");
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const canCreate = role ? can.createProjects(role) : false;

  const filtered = useMemo(() => projects.filter((p) =>
    (company === "all" || p.companyId === company) &&
    (status === "all" || p.status === status) &&
    (risk === "all" || p.risk === risk) &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase()))
  ), [projects, company, status, risk, q]);

  return (
    <div>
      <PageHeader
        title="Projects"
        description="All projects across Kiron Group entities."
        icon={<FolderKanban className="h-5 w-5" />}
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New project
            </Button>
          )
        }
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Input placeholder="Search projects..." className="h-9 max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map((c) => (<SelectItem key={c.id} value={c.id}>{c.shortName}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="planning">Planning</SelectItem>
              <SelectItem value="on_hold">On hold</SelectItem>
              <SelectItem value="at_risk">At risk</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={risk} onValueChange={setRisk}>
            <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <button onClick={() => setView("cards")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
            <button onClick={() => setView("table")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><TableIcon className="h-3.5 w-3.5" /> Table</button>
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-12 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">No projects match your filters.</p>
            {canCreate && (
              <Button size="sm" className="mt-3" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Create the first one
              </Button>
            )}
          </div>
        )}

        {view === "cards" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => {
              const owner = getUser(p.ownerId);
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="rounded-xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-primary/40 hover:shadow-elevated"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <CompanyBadge companyId={p.companyId} size="xs" />
                        {p.kind && p.kind !== "internal" && (
                          <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {p.kind === "rnd" ? "R&D" : p.kind}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 font-display text-base font-semibold leading-tight">{p.name}</h3>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                    </div>
                    <RiskBadge risk={p.risk} />
                  </div>
                  {p.techStack && p.techStack.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.techStack.slice(0, 5).map((t) => (
                        <span key={t} className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t}
                        </span>
                      ))}
                      {p.techStack.length > 5 && (
                        <span className="text-[10px] text-muted-foreground">+{p.techStack.length - 5}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <ProjectStatusBadge status={p.status} />
                    <span className="text-xs text-muted-foreground">Due {p.dueDate || "—"}</span>
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>{p.progress}% complete</span>
                      <span>{p.memberIds.length} members</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserAvatar userId={owner?.id} size="xs" />
                      <span className="text-xs text-muted-foreground">{owner?.name ?? "—"}</span>
                    </div>
                    <UserAvatarStack userIds={p.memberIds} max={3} size="xs" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Risk</th>
                  <th className="px-4 py-2.5 font-medium">Owner</th>
                  <th className="px-4 py-2.5 font-medium">Progress</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40" onClick={() => navigate(`/projects/${p.id}`)}>
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5"><CompanyBadge companyId={p.companyId} size="xs" /></td>
                    <td className="px-4 py-2.5"><ProjectStatusBadge status={p.status} /></td>
                    <td className="px-4 py-2.5"><RiskBadge risk={p.risk} /></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><UserAvatar userId={p.ownerId} size="xs" /><span className="text-xs">{getUser(p.ownerId)?.name ?? "—"}</span></div></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${p.progress}%` }} /></div><span className="text-xs tabular-nums">{p.progress}%</span></div></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.dueDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewProjectDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        defaultCompanyId={user?.homeCompanyId ?? companies[0]?.id ?? ""}
        onCreated={(id) => { refresh(); setNewOpen(false); navigate(`/projects/${id}`); }}
      />
    </div>
  );
}

// ---------- New project dialog ----------

function NewProjectDialog({
  open, onClose, defaultCompanyId, onCreated,
}: { open: boolean; onClose: () => void; defaultCompanyId: string; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const { companies, users, teams } = useDataStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [statusValue, setStatusValue] = useState("active");
  const [risk, setRisk] = useState("medium");
  const [progress, setProgress] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState(user?.id ?? "");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [memberQuery, setMemberQuery] = useState("");
  // New phase-3 fields. Tech stack input is comma-separated; we split
  // on save to keep the data model tidy (string[] on the wire).
  const [kind, setKind] = useState("internal");
  const [techStackInput, setTechStackInput] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [progressMode, setProgressMode] = useState<"manual" | "auto">("manual");
  const [busy, setBusy] = useState(false);

  // Reset state when the dialog opens, so subsequent uses start fresh.
  useMemo(() => {
    if (open) {
      setTitle(""); setDescription("");
      setCompanyId(defaultCompanyId);
      setStatusValue("active"); setRisk("medium"); setProgress("0");
      setStartDate(""); setDueDate("");
      setOwnerId(user?.id ?? "");
      setMemberIds(new Set()); setMemberQuery("");
      setKind("internal"); setTechStackInput(""); setTeamId(""); setProgressMode("manual");
    }
  }, [open, defaultCompanyId, user?.id]);

  const candidates = useMemo(() => {
    const haystack = memberQuery.toLowerCase();
    return users
      .filter((u) => u.homeCompanyId === companyId || can.isCrossCompany(u.role))
      .filter((u) => !haystack || u.name.toLowerCase().includes(haystack) || u.email.toLowerCase().includes(haystack));
  }, [users, companyId, memberQuery]);

  const toggle = (id: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!title.trim()) return toast.error("Title is required");
    if (!companyId) return toast.error("Pick a company");
    setBusy(true);
    try {
      const techStack = techStackInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const created = await api.createProject({
        title: title.trim(),
        description: description.trim() || null,
        company_id: companyId,
        owner_id: ownerId || null,
        status: statusValue,
        risk_level: risk,
        progress: Math.max(0, Math.min(100, Number(progress) || 0)),
        start_date: startDate || null,
        due_date: dueDate || null,
        member_ids: Array.from(memberIds),
        kind,
        tech_stack: techStack,
        team_id: teamId || null,
        progress_mode: progressMode,
      });
      toast.success("Project created");
      onCreated(created.id as string);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* Three-region layout: pinned title, scrolling form body, pinned
          footer. Override shadcn's defaults (grid + p-6 + gap-4) so we
          control the layout. max-h-[85vh] keeps the dialog within the
          viewport; the middle region uses flex-1 + min-h-0 so the
          overflow-y-auto can actually engage. */}
      <DialogContent className="sm:max-w-xl flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9" placeholder="e.g. Q3 launch playbook" autoFocus />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="One-line goal of the project"
            />
          </div>
          <div>
            <Label className="text-xs">Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.shortName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {users
                  .filter((u) => u.homeCompanyId === companyId || can.isCrossCompany(u.role))
                  .map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={statusValue} onValueChange={setStatusValue}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_hold">On hold</SelectItem>
                <SelectItem value="at_risk">At risk</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Risk</Label>
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
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
          <div>
            <Label className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="rnd">R&amp;D</SelectItem>
                <SelectItem value="hackathon">Hackathon</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Progress mode</Label>
            <Select value={progressMode} onValueChange={(v) => setProgressMode(v as "manual" | "auto")}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (you set %)</SelectItem>
                <SelectItem value="auto">Auto (computed from tasks)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Team (optional)</Label>
            <Select value={teamId || "__none__"} onValueChange={(v) => setTeamId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No team link</SelectItem>
                {teams.filter((t) => t.isActive).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Tech stack (comma-separated)</Label>
            <Input
              value={techStackInput}
              onChange={(e) => setTechStackInput(e.target.value)}
              placeholder="e.g. React, FastAPI, Postgres, Razorpay"
              className="mt-1 h-9"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Initial members</Label>
            <Input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="Search teammates"
              className="mt-1 h-9"
            />
            <ul className="mt-1.5 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {candidates.length === 0 && (
                <li className="px-3 py-3 text-center text-xs text-muted-foreground">No one matches.</li>
              )}
              {candidates.map((u) => {
                const checked = memberIds.has(u.id);
                return (
                  <li
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                      checked ? "bg-primary-soft" : "hover:bg-surface-muted",
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(u.id)} />
                    <UserAvatar userId={u.id} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{u.designation}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
