import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError } from "@/lib/api";
import { mapTeam } from "@/lib/mappers";
import { toast } from "sonner";
import {
  UsersRound, Plus, Loader2, Hash, Briefcase, Sparkles, ShieldCheck,
  Crown, Building2, Globe, Search,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import type { TeamKind, Team } from "@/types";

// Order + display labels mirror the backend TEAM_KINDS set. Kept here so
// the list page groups by kind in a stable order.
const KIND_LABELS: Record<TeamKind, string> = {
  project: "Project teams",
  hackathon: "Hackathon teams",
  hr: "HR teams",
  founders_office: "Founder's office",
  client_internal: "Client teams (internal)",
  client_external: "Client teams (external)",
  functional: "Functional teams",
  ad_hoc: "Ad-hoc teams",
};

const KIND_ORDER: TeamKind[] = [
  "project", "hackathon", "founders_office", "hr",
  "client_internal", "client_external", "functional", "ad_hoc",
];

const KIND_ICONS: Record<TeamKind, typeof Hash> = {
  project: Briefcase,
  hackathon: Sparkles,
  hr: ShieldCheck,
  founders_office: Crown,
  client_internal: Building2,
  client_external: Globe,
  functional: Hash,
  ad_hoc: Hash,
};

export default function Teams() {
  const { user, role } = useAuth();
  const { teams, users, companies, refresh } = useDataStore();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");

  // Founder's office + super_admin see every team; everyone else only
  // sees their own. The backend already enforces this — we just don't
  // need to filter again here, but we DO want to hide inactive teams
  // by default + offer a search box.
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return teams
      .filter((t) => t.isActive)
      .filter((t) => !term || t.name.toLowerCase().includes(term))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, q]);

  const byKind = useMemo(() => {
    const map = new Map<TeamKind, Team[]>();
    for (const t of filtered) {
      const arr = map.get(t.kind) ?? [];
      arr.push(t);
      map.set(t.kind, arr);
    }
    return map;
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Teams"
        description="Flexible groups for projects, hackathons, departments, clients."
        icon={<UsersRound className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New team
          </Button>
        }
      />

      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search teams..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 max-w-sm border-0 focus-visible:ring-0"
          />
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "team" : "teams"}
          </span>
        </div>

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No teams yet. Click <b>New team</b> to create one.
          </div>
        )}

        {KIND_ORDER.map((kind) => {
          const list = byKind.get(kind);
          if (!list || list.length === 0) return null;
          const Icon = KIND_ICONS[kind];
          return (
            <div key={kind}>
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {KIND_LABELS[kind]}
                </h3>
                <span className="text-xs text-muted-foreground">· {list.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => navigate(`/teams/${t.id}`)}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-card hover:border-primary/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-snug">{t.name}</p>
                      <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t.memberIds.length}
                      </span>
                    </div>
                    {t.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                    )}
                    <div className="mt-1 flex -space-x-1.5">
                      {t.memberIds.slice(0, 5).map((id) => (
                        <UserAvatar key={id} userId={id} size="xs" />
                      ))}
                      {t.memberIds.length > 5 && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-muted text-[9px] font-semibold">
                          +{t.memberIds.length - 5}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <CreateTeamDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); refresh(); navigate(`/teams/${id}`); }}
      />
    </div>
  );
}

// ----------------- Create team dialog -----------------

function CreateTeamDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const { users, companies } = useDataStore();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TeamKind>("project");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState<string>("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return users
      .filter((u) => u.isActive && u.id !== user?.id)
      .filter((u) => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
  }, [users, user, q]);

  const toggle = (id: string) =>
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const reset = () => {
    setName(""); setKind("project"); setDescription("");
    setCompanyId(""); setMembers(new Set()); setQ("");
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Pick a name");
    setBusy(true);
    try {
      const team = await api.createTeam({
        name: name.trim(),
        kind,
        description: description.trim() || null,
        company_id: companyId || null,
        client_org_id: null,
        member_ids: Array.from(members),
      });
      toast.success("Team created");
      reset();
      onCreated(team.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't create team");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && (onClose(), reset())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UsersRound className="h-4 w-4" /> New team</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9" placeholder="e.g. Razorpay integration, Q3 hackathon, Heal HR" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Kind *</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as TeamKind)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Company (optional — leave blank for group-wide)</Label>
              <Select value={companyId || "__none__"} onValueChange={(v) => setCompanyId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Group-wide</SelectItem>
                  {companies.filter((c) => c.isActive).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="What's this team for?"
            />
          </div>
          <div>
            <Label className="text-xs">Members ({members.size + 1} incl. you)</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teammates"
              className="mt-1 h-9"
            />
            <ul className="mt-2 max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {candidates.map((u) => {
                const checked = members.has(u.id);
                return (
                  <li
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-muted"
                  >
                    <Checkbox checked={checked} />
                    <UserAvatar userId={u.id} size="xs" />
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className="text-[11px] text-muted-foreground">{u.designation}</span>
                  </li>
                );
              })}
              {candidates.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">No one matches.</li>
              )}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); reset(); }} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
