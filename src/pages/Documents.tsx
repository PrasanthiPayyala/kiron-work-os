import { useEffect, useMemo, useState } from "react";
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
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError, type DocumentRow } from "@/lib/api";
import { toast } from "sonner";
import {
  FileText, Plus, Search, Lock, Globe, Building, Tag, Loader2,
} from "lucide-react";

// Suggested categories — used in the create dialog dropdown. The
// schema stores free text so custom values are still allowed via the
// API if anyone needs one outside this list.
const CATEGORY_OPTIONS = [
  "policy", "handbook", "sop", "contract", "guide", "template", "other",
] as const;
const CATEGORY_LABEL: Record<string, string> = {
  policy: "Policies",
  handbook: "Handbooks",
  sop: "SOPs",
  contract: "Contracts",
  guide: "Guides",
  template: "Templates",
  other: "Other",
};
const VISIBILITY_LABEL = {
  company: "Company",
  group_wide: "Group-wide",
  private: "Private",
} as const;
const VISIBILITY_ICON = {
  company: Building,
  group_wide: Globe,
  private: Lock,
} as const;

export default function Documents() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.listDocuments());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load documents");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  // Collect every distinct tag across visible docs for the filter chip row.
  const allTags = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => (r.tags ?? []).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && !(
        r.title.toLowerCase().includes(term) ||
        r.category.toLowerCase().includes(term) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(term))
      )) return false;
      if (tag && !(r.tags ?? []).includes(tag)) return false;
      return true;
    });
  }, [rows, q, tag]);

  const byCategory = useMemo(() => {
    const m = new Map<string, DocumentRow[]>();
    for (const r of filtered) {
      (m.get(r.category) ?? m.set(r.category, []).get(r.category)!).push(r);
    }
    return m;
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Shared knowledge base — SOPs, policies, contracts, handbooks."
        icon={<FileText className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New document
          </Button>
        }
      />

      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, category, tags..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 max-w-sm border-0 focus-visible:ring-0"
          />
          {allTags.length > 0 && (
            <>
              <span className="ml-2 text-xs text-muted-foreground">Tag:</span>
              <button
                onClick={() => setTag("")}
                className={`rounded px-2 py-0.5 text-xs ${tag === "" ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted-foreground hover:bg-muted"}`}
              >
                All
              </button>
              {allTags.slice(0, 10).map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(tag === t ? "" : t)}
                  className={`rounded px-2 py-0.5 text-xs ${tag === t ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted-foreground hover:bg-muted"}`}
                >
                  <Tag className="mr-1 inline h-3 w-3" />{t}
                </button>
              ))}
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "document" : "documents"}`}
          </span>
        </div>

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No documents yet. Click <b>New document</b> to add the first one.
          </div>
        )}

        {Array.from(byCategory.entries()).map(([cat, list]) => (
          <div key={cat}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABEL[cat] ?? cat}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => {
                const Icon = VISIBILITY_ICON[r.visibility];
                return (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/documents/${r.id}`)}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-card hover:border-primary/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-snug">{r.title}</p>
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" title={VISIBILITY_LABEL[r.visibility]} />
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-1">
                      {(r.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>
                      ))}
                      {(r.tags ?? []).length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{(r.tags ?? []).length - 3}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      v{r.version} · updated {r.updated_at.slice(0, 10)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <CreateDocumentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); void load(); navigate(`/documents/${id}`); }}
      />
    </div>
  );
}

// ---------- Create dialog ----------

function CreateDocumentDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const { companies } = useDataStore();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("policy");
  const [companyId, setCompanyId] = useState<string>("__group__");
  const [visibility, setVisibility] = useState<"company" | "group_wide" | "private">("company");
  const [tagsInput, setTagsInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(""); setBody(""); setCategory("policy");
      setCompanyId(user?.homeCompanyId ?? "__group__");
      setVisibility("company"); setTagsInput("");
    }
  }, [open, user?.homeCompanyId]);

  const submit = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setBusy(true);
    try {
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      const created = await api.createDocument({
        title: title.trim(),
        body,
        category,
        company_id: companyId === "__group__" ? null : companyId,
        visibility,
        tags,
      });
      toast.success("Document created");
      onCreated(created.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> New document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9" placeholder="e.g. Employee handbook 2026, Travel policy" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
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
            <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="e.g. hr, leave, india" className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">Body</Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-sm"
              placeholder="Paste the policy / handbook text here."
            />
          </div>
        </div>
        <DialogFooter>
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
