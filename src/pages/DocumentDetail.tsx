import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth, roleLabel } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import {
  api, ApiError, type DocumentDetailRow, type DocumentVersionRow,
  type DocumentAccessRow,
} from "@/lib/api";
import { toast } from "sonner";
import {
  FileText, ArrowLeft, Pencil, Trash2, Loader2, History, ShieldCheck,
  UserPlus, X, Lock, Globe, Building,
} from "lucide-react";
import type { Role } from "@/types";

const ROLE_OPTIONS: Role[] = [
  "super_admin", "founder", "founder_office_coordinator", "founder_office_support",
  "manager", "hr_admin", "employee", "intern",
];

const VISIBILITY_LABEL = {
  company: "Company",
  group_wide: "Group-wide",
  private: "Private (owner + ACL)",
} as const;

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showAccess, setShowAccess] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDoc(await api.getDocument(id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load document");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  const deleteDoc = async () => {
    if (!doc) return;
    if (!confirm("Delete this document permanently? Version history will also be lost.")) return;
    try {
      await api.deleteDocument(doc.id);
      toast.success("Deleted");
      navigate("/documents");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    }
  };

  if (loading || !doc) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/documents")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to documents
        </Button>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "Document not found, or you don't have access."}
        </p>
      </div>
    );
  }

  const VIcon = doc.visibility === "private" ? Lock : doc.visibility === "group_wide" ? Globe : Building;

  return (
    <div>
      <PageHeader
        title={doc.title}
        description={`${doc.category} · ${VISIBILITY_LABEL[doc.visibility]} · v${doc.version}`}
        icon={<FileText className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate("/documents")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Documents
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowVersions(true)}>
              <History className="mr-1.5 h-4 w-4" /> Versions
            </Button>
            {doc.can_edit && (
              <>
                <Button size="sm" variant="outline" onClick={() => setShowAccess(true)}>
                  <ShieldCheck className="mr-1.5 h-4 w-4" /> Access
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1.5 h-4 w-4" /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void deleteDoc()}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 text-xs">
            <VIcon className="h-3 w-3" /> {VISIBILITY_LABEL[doc.visibility]}
          </span>
          {(doc.tags ?? []).map((t) => (
            <span key={t} className="rounded bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-primary">
              {t}
            </span>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-card">
          <article className="whitespace-pre-wrap text-sm leading-relaxed">
            {doc.body || (
              <span className="text-muted-foreground">
                This document has no body yet. {doc.can_edit ? "Click Edit to add one." : ""}
              </span>
            )}
          </article>
        </div>

        <p className="text-xs text-muted-foreground">
          Last edited {doc.updated_at.slice(0, 16).replace("T", " ")} · created {doc.created_at.slice(0, 10)}
        </p>
      </div>

      {editing && (
        <EditDialog doc={doc} onClose={() => setEditing(false)} onSaved={(d) => { setDoc(d); setEditing(false); }} />
      )}
      {showVersions && (
        <VersionsDialog docId={doc.id} onClose={() => setShowVersions(false)} />
      )}
      {showAccess && doc.can_edit && (
        <AccessDialog docId={doc.id} onClose={() => setShowAccess(false)} />
      )}
    </div>
  );
}

// ---------- Edit dialog ----------

function EditDialog({
  doc, onClose, onSaved,
}: { doc: DocumentDetailRow; onClose: () => void; onSaved: (d: DocumentDetailRow) => void }) {
  const { companies } = useDataStore();
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [category, setCategory] = useState(doc.category);
  const [companyId, setCompanyId] = useState<string>(doc.company_id ?? "__group__");
  const [visibility, setVisibility] = useState(doc.visibility);
  const [tagsInput, setTagsInput] = useState((doc.tags ?? []).join(", "));
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setBusy(true);
    try {
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      const updated = await api.updateDocument(doc.id, {
        title: title.trim(),
        body,
        category,
        company_id: companyId === "__group__" ? null : companyId,
        visibility,
        tags,
        change_note: changeNote.trim() || undefined,
      });
      // updateDocument returns the snake_case row; re-fetch to populate can_edit.
      const fresh = await api.getDocument(doc.id);
      toast.success("Saved");
      onSaved(fresh);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Edit document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__group__">Group-wide</SelectItem>
                  {companies.filter((c) => c.isActive).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="group_wide">Group-wide</SelectItem>
                  <SelectItem value="private">Private (owner + ACL)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Tags (comma-separated)</Label>
            <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">Body</Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Change note (optional — shown in version history)</Label>
            <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} className="mt-1 h-9" placeholder="e.g. Updated travel cap to Rs 15,000" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Versions dialog ----------

function VersionsDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { getUser } = useDataStore();
  const [rows, setRows] = useState<DocumentVersionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setRows(await api.listDocumentVersions(docId));
      } finally {
        setLoading(false);
      }
    })();
  }, [docId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Version history</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((v) => {
              const editor = v.edited_by ? getUser(v.edited_by) : null;
              return (
                <li key={v.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">v{v.version}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(v.edited_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{v.title}</p>
                  {v.change_note && <p className="mt-1 text-xs italic">{v.change_note}</p>}
                  {editor && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <UserAvatar userId={editor.id} size="xs" />
                      {editor.name}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Access dialog ----------

function AccessDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { users, getUser } = useDataStore();
  const [rows, setRows] = useState<DocumentAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"user" | "role">("user");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("hr_admin");
  const [level, setLevel] = useState<"view" | "edit">("view");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.listDocumentAccess(docId));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [docId]);

  const grant = async () => {
    const principalId = kind === "user" ? userId : role;
    if (!principalId) return toast.error(kind === "user" ? "Pick a user" : "Pick a role");
    setBusy(true);
    try {
      await api.grantDocumentAccess(docId, kind, principalId, level);
      toast.success("Granted");
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't grant");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (r: DocumentAccessRow) => {
    try {
      await api.revokeDocumentAccess(docId, r.principal_kind, r.principal_id);
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't revoke");
    }
  };

  const activeUsers = useMemo(() => users.filter((u) => u.isActive).sort((a, b) => a.name.localeCompare(b.name)), [users]);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Access</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Owner + global roles always have access. Add explicit user / role grants below.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="user">A specific person</SelectItem>
              <SelectItem value="role">Everyone in a role</SelectItem>
            </SelectContent>
          </Select>
          {kind === "user" ? (
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Pick someone" /></SelectTrigger>
              <SelectContent>
                {activeUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="view">Can view</SelectItem>
              <SelectItem value="edit">Can edit</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={grant} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            <UserPlus className="mr-1.5 h-4 w-4" /> Grant
          </Button>
        </div>

        <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border">
          {loading && <p className="p-3 text-xs text-muted-foreground">Loading…</p>}
          {!loading && rows.length === 0 && <p className="p-3 text-xs text-muted-foreground">No grants yet.</p>}
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={`${r.principal_kind}:${r.principal_id}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                {r.principal_kind === "user" ? (
                  <>
                    <UserAvatar userId={r.principal_id} size="xs" />
                    <span className="flex-1 truncate">{getUser(r.principal_id)?.name ?? "Unknown user"}</span>
                  </>
                ) : (
                  <>
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary-soft text-[10px] font-semibold text-primary">R</span>
                    <span className="flex-1 truncate">All {roleLabel(r.principal_id as Role)}s</span>
                  </>
                )}
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{r.access_level}</span>
                <button onClick={() => void revoke(r)} className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
