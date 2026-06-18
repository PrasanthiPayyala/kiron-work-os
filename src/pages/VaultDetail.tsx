import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { useAuth, roleLabel } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError, type VaultRow, type VaultAccessRow, type VaultAuditRow } from "@/lib/api";
import { toast } from "sonner";
import {
  KeyRound, ArrowLeft, Eye, EyeOff, Copy, Pencil, Loader2, Trash2,
  UserPlus, X, ShieldCheck,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

const ROLE_OPTIONS: Role[] = [
  "super_admin", "founder", "founder_office_coordinator", "founder_office_support",
  "manager", "hr_admin", "employee", "intern",
];

export default function VaultDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, role } = useAuth();
  const { getUser } = useDataStore();
  const navigate = useNavigate();
  const isSuperAdmin = role === "super_admin";

  const [credential, setCredential] = useState<VaultRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      setCredential(await api.getVault(id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load credential");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); setRevealed(null); }, [id]);

  const reveal = async () => {
    if (!id) return;
    if (revealed) { setRevealed(null); return; }
    setRevealing(true);
    try {
      const { secret } = await api.revealVault(id);
      setRevealed(secret);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't decrypt");
    } finally {
      setRevealing(false);
    }
  };

  const copySecret = async () => {
    if (!id || !revealed) {
      // First click after page load: fetch + copy in one step.
      try {
        const { secret } = await api.revealVault(id!);
        await navigator.clipboard.writeText(secret);
        toast.success("Copied (audited)");
        void api.logVaultCopy(id!);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Couldn't copy");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(revealed);
      toast.success("Copied (audited)");
      void api.logVaultCopy(id!);
    } catch {
      toast.error("Clipboard blocked by the browser");
    }
  };

  const deleteCred = async () => {
    if (!id) return;
    if (!confirm("Delete this credential permanently? Audit log will retain that it existed.")) return;
    try {
      await api.deleteVault(id);
      toast.success("Deleted");
      navigate("/vault");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    }
  };

  if (loading || !credential) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/vault")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to vault
        </Button>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "Credential not found."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={credential.label}
        description={credential.category}
        icon={<KeyRound className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate("/vault")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Vault
            </Button>
            {isSuperAdmin && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Identifier + URL — plaintext, no reveal needed */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            {credential.identifier && (
              <Row label="Identifier" value={credential.identifier} copyable />
            )}
            {credential.url && (
              <Row label="URL" value={credential.url} copyable link />
            )}
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Secret</Label>
              <div className="mt-1 flex items-center gap-2">
                <code className={cn(
                  "flex-1 truncate rounded-md bg-surface-muted px-3 py-2 font-mono text-sm",
                  !revealed && "tracking-widest",
                )}>
                  {revealed ?? "•••••••••••••••••••"}
                </code>
                <Button size="sm" variant="outline" onClick={() => void reveal()} disabled={revealing}>
                  {revealing ? <Loader2 className="h-4 w-4 animate-spin" />
                    : revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  <span className="ml-1.5 hidden sm:inline">{revealed ? "Hide" : "Reveal"}</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copySecret()}>
                  <Copy className="h-4 w-4" />
                  <span className="ml-1.5 hidden sm:inline">Copy</span>
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Each reveal / copy is logged in the audit trail.
              </p>
            </div>
            {credential.notes && (
              <div className="mt-3">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{credential.notes}</p>
              </div>
            )}
            {credential.rotate_every_days && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Rotates every {credential.rotate_every_days} days
                {credential.last_rotated_at ? ` · last rotated ${new Date(credential.last_rotated_at).toLocaleDateString()}` : " · never rotated"}
              </p>
            )}
          </div>

          {isSuperAdmin && (
            <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Audit log (last 200)
              </h3>
              <AuditLog credentialId={credential.id} />
            </div>
          )}

          {isSuperAdmin && (
            <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
              <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => void deleteCred()}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete permanently
              </Button>
            </div>
          )}
        </div>

        {/* Access management — super_admin only */}
        {isSuperAdmin && (
          <aside className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <AccessPanel credentialId={credential.id} />
          </aside>
        )}
      </div>

      {editing && (
        <EditVaultDialog
          credential={credential}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setCredential(updated); setEditing(false); setRevealed(null); }}
        />
      )}
    </div>
  );
}

function Row({ label, value, copyable, link }: { label: string; value: string; copyable?: boolean; link?: boolean }) {
  return (
    <div className="mb-3">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        {link ? (
          <a href={value} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm text-primary hover:underline">{value}</a>
        ) : (
          <span className="flex-1 truncate text-sm">{value}</span>
        )}
        {copyable && (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ----------------- Access panel (super_admin only) -----------------

function AccessPanel({ credentialId }: { credentialId: string }) {
  const { getUser } = useDataStore();
  const [grants, setGrants] = useState<VaultAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingOpen, setAddingOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setGrants(await api.listVaultAccess(credentialId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [credentialId]);

  const revoke = async (g: VaultAccessRow) => {
    try {
      await api.revokeVaultAccess(credentialId, g.principal_kind, g.principal_id);
      toast.success("Revoked");
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't revoke");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Access
        </h3>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setAddingOpen(true)}>
          <UserPlus className="mr-1 h-3.5 w-3.5" /> Grant
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        super_admin (you) always has access. Everyone else needs an explicit grant.
      </p>
      <ul className="mt-3 space-y-1.5">
        {loading && <li className="text-xs text-muted-foreground">Loading…</li>}
        {!loading && grants.length === 0 && (
          <li className="text-xs text-muted-foreground">No grants yet. Click <b>Grant</b> to share.</li>
        )}
        {grants.map((g) => (
          <li key={`${g.principal_kind}:${g.principal_id}`} className="flex items-center gap-2">
            {g.principal_kind === "user" ? (
              <>
                <UserAvatar userId={g.principal_id} size="xs" />
                <span className="flex-1 truncate text-sm">{getUser(g.principal_id)?.name ?? "Unknown user"}</span>
              </>
            ) : (
              <>
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary-soft text-[10px] font-semibold text-primary">R</span>
                <span className="flex-1 truncate text-sm">All {roleLabel(g.principal_id as Role)}s</span>
              </>
            )}
            <button onClick={() => void revoke(g)} className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive" title="Revoke">
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      {addingOpen && (
        <GrantDialog
          credentialId={credentialId}
          onClose={() => setAddingOpen(false)}
          onGranted={() => { setAddingOpen(false); void load(); }}
        />
      )}
    </>
  );
}

function GrantDialog({
  credentialId, onClose, onGranted,
}: { credentialId: string; onClose: () => void; onGranted: () => void }) {
  const { users } = useDataStore();
  const [kind, setKind] = useState<"user" | "role">("user");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("hr_admin");
  const [busy, setBusy] = useState(false);

  const activeUsers = useMemo(() => users.filter((u) => u.isActive).sort((a, b) => a.name.localeCompare(b.name)), [users]);

  const submit = async () => {
    setBusy(true);
    try {
      const principalId = kind === "user" ? userId : role;
      if (!principalId) return toast.error(kind === "user" ? "Pick a user" : "Pick a role");
      await api.grantVaultAccess(credentialId, kind, principalId);
      toast.success("Granted");
      onGranted();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't grant");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Grant access</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Grant to</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "user" | "role")}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">A specific person</SelectItem>
                <SelectItem value="role">Everyone in a role</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "user" ? (
            <div>
              <Label className="text-xs">User</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick someone" /></SelectTrigger>
                <SelectContent>
                  {activeUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} · {u.designation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------- Audit log -----------------

function AuditLog({ credentialId }: { credentialId: string }) {
  const { getUser } = useDataStore();
  const [rows, setRows] = useState<VaultAuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setRows(await api.getVaultAudit(credentialId));
      } finally {
        setLoading(false);
      }
    })();
  }, [credentialId]);

  if (loading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No activity yet.</p>;

  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-0">
          <span className="text-[10px] font-mono uppercase rounded bg-surface-muted px-1.5 py-0.5">{r.action}</span>
          <span className="flex-1 truncate text-xs">
            {r.actor_user_id ? getUser(r.actor_user_id)?.name ?? "Unknown" : "system"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(r.at).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ----------------- Edit dialog -----------------

function EditVaultDialog({
  credential, onClose, onSaved,
}: { credential: VaultRow; onClose: () => void; onSaved: (v: VaultRow) => void }) {
  const [label, setLabel] = useState(credential.label);
  const [category, setCategory] = useState(credential.category);
  const [identifier, setIdentifier] = useState(credential.identifier ?? "");
  const [url, setUrl] = useState(credential.url ?? "");
  const [notes, setNotes] = useState(credential.notes ?? "");
  const [newSecret, setNewSecret] = useState("");
  const [rotate, setRotate] = useState<number | "">(credential.rotate_every_days ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!label.trim()) return toast.error("Label is required");
    setBusy(true);
    try {
      const updated = await api.updateVault(credential.id, {
        label: label.trim(),
        category,
        identifier: identifier.trim() || null,
        url: url.trim() || null,
        notes: notes.trim() || null,
        secret: newSecret || undefined,
        rotate_every_days: typeof rotate === "number" ? rotate : null,
      });
      toast.success(newSecret ? "Saved (secret rotated)" : "Saved");
      onSaved(updated);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Edit credential</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Rotate every (days)</Label>
              <Input
                type="number" min={1} max={3650}
                value={rotate}
                onChange={(e) => setRotate(e.target.value === "" ? "" : Math.max(1, Number(e.target.value) || 0))}
                className="mt-1 h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Username / identifier</Label>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">New secret (blank = keep existing)</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder="Type to rotate"
              className="mt-1 h-9 font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
