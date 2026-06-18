import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  UsersRound, ArrowLeft, MessageSquare, UserPlus, X, Pencil, Loader2, Trash2,
} from "lucide-react";
import type { Team, TeamKind } from "@/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<TeamKind, string> = {
  project: "Project team",
  hackathon: "Hackathon team",
  hr: "HR team",
  founders_office: "Founder's office team",
  client_internal: "Client team (internal)",
  client_external: "Client team (external)",
  functional: "Functional team",
  ad_hoc: "Ad-hoc team",
};

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, role } = useAuth();
  const { teams, users, getUser, refresh } = useDataStore();
  const navigate = useNavigate();

  const team = teams.find((t) => t.id === id);
  // Owner / global roles can manage. Bootstrap already filters teams
  // the user can see, so we only need the admin check here.
  const canEdit = !!team && !!user && (
    team.ownerId === user.id ||
    role === "super_admin" ||
    role === "founder" ||
    role === "founder_office_coordinator"
  );

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (team) {
      setNameDraft(team.name);
      setDescDraft(team.description ?? "");
    }
  }, [team?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!team) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/teams")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to teams
        </Button>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Team not found, or you don't have access.
        </p>
      </div>
    );
  }

  const memberUsers = team.memberIds
    .map((uid) => getUser(uid))
    .filter((u): u is NonNullable<typeof u> => !!u);
  const owner = getUser(team.ownerId ?? undefined);

  const saveName = async () => {
    if (!nameDraft.trim()) return toast.error("Name can't be empty");
    setSaving(true);
    try {
      await api.updateTeam(team.id, { name: nameDraft.trim() });
      toast.success("Saved");
      setEditingName(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const saveDesc = async () => {
    setSaving(true);
    try {
      await api.updateTeam(team.id, { description: descDraft.trim() || null });
      toast.success("Saved");
      setEditingDesc(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (uid: string) => {
    setSaving(true);
    try {
      await api.removeTeamMember(team.id, uid);
      toast.success("Removed from team");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't remove");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    try {
      await api.updateTeam(team.id, { is_active: false });
      toast.success("Team archived");
      refresh();
      navigate("/teams");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't archive");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={team.name}
        description={KIND_LABEL[team.kind]}
        icon={<UsersRound className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate("/teams")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> All teams
            </Button>
            {team.conversationId && (
              <Button size="sm" variant="outline" onClick={() => navigate("/chat")}>
                <MessageSquare className="mr-1.5 h-4 w-4" /> Team chat
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Header card with editable name + description */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              {editingName ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="h-9 max-w-md"
                  />
                  <Button size="sm" onClick={saveName} disabled={saving}>
                    {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditingName(false); setNameDraft(team.name); }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div>
                  <h2 className="font-display text-xl font-semibold">{team.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABEL[team.kind]}{team.companyId ? "" : " · group-wide"}
                  </p>
                </div>
              )}
              {canEdit && !editingName && (
                <Button size="sm" variant="ghost" onClick={() => setEditingName(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Rename
                </Button>
              )}
            </div>

            {team.companyId && (
              <div className="mt-3">
                <CompanyBadge companyId={team.companyId} size="sm" />
              </div>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Description</Label>
                {canEdit && !editingDesc && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingDesc(true)}>
                    <Pencil className="mr-1 h-3 w-3" /> Edit
                  </Button>
                )}
              </div>
              {editingDesc ? (
                <div className="mt-2">
                  <textarea
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditingDesc(false); setDescDraft(team.description ?? ""); }}>Cancel</Button>
                    <Button size="sm" onClick={saveDesc} disabled={saving}>
                      {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {team.description || "No description yet."}
                </p>
              )}
            </div>

            {canEdit && (
              <div className="mt-4 border-t border-border pt-3">
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-destructive" onClick={archive}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Archive team
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Members panel */}
        <aside className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Members ({memberUsers.length})
            </h3>
            {canEdit && <AddMemberPopover teamId={team.id} existing={team.memberIds} />}
          </div>
          {owner && (
            <p className="mt-2 text-[11px] text-muted-foreground">Owner: {owner.name}</p>
          )}
          <ul className="mt-3 space-y-1.5">
            {memberUsers.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <UserAvatar userId={u.id} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{u.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{u.designation}</p>
                </div>
                {canEdit && u.id !== team.ownerId && (
                  <button
                    onClick={() => void removeMember(u.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                    title="Remove from team"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function AddMemberPopover({ teamId, existing }: { teamId: string; existing: string[] }) {
  const { users, refresh } = useDataStore();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const existingSet = useMemo(() => new Set(existing), [existing]);
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return users
      .filter((u) => u.isActive && !existingSet.has(u.id))
      .filter((u) => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      .slice(0, 30);
  }, [users, existingSet, q]);

  const add = async (uid: string) => {
    setAdding(true);
    try {
      await api.addTeamMember(teamId, uid);
      toast.success("Added");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't add");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2">
          <UserPlus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teammates"
            className="h-8"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {candidates.map((u) => (
            <li
              key={u.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted",
                adding && "pointer-events-none opacity-50",
              )}
              onClick={() => void add(u.id)}
            >
              <UserAvatar userId={u.id} size="xs" />
              <span className="flex-1 truncate">{u.name}</span>
              <span className="text-[11px] text-muted-foreground">{u.designation}</span>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="px-3 py-3 text-xs text-muted-foreground">No matches.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
