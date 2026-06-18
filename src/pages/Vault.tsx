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
import { api, ApiError, type VaultRow } from "@/lib/api";
import { toast } from "sonner";
import {
  KeyRound, Plus, Loader2, Search, Mail, Landmark, Server, Globe,
  Building, Share2, Lock, Wallet,
} from "lucide-react";

// Stable category order + display labels. The backend stores whatever
// category string is sent; this map is just for grouping + icons.
const CATEGORIES: { key: string; label: string; Icon: typeof KeyRound }[] = [
  { key: "email",         label: "Email accounts",   Icon: Mail },
  { key: "bank",          label: "Bank logins",       Icon: Landmark },
  { key: "cpanel",        label: "cPanel / hosting",  Icon: Server },
  { key: "domain",        label: "Domain registrars", Icon: Globe },
  { key: "govt",          label: "Government portals", Icon: Building },
  { key: "saas",          label: "SaaS vendors",      Icon: Share2 },
  { key: "social",        label: "Social media",      Icon: Share2 },
  { key: "wallet",        label: "Wallets / payment", Icon: Wallet },
  { key: "misc",          label: "Misc",              Icon: Lock },
];

const CATEGORY_LOOKUP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export default function Vault() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const canCreate = role === "super_admin";
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.listVault());
    } catch (e) {
      // 503 here usually means VAULT_MASTER_KEY isn't set on the VM —
      // surface it loud so the operator knows what's wrong.
      toast.error(e instanceof ApiError ? e.message : "Couldn't load vault");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) =>
      !term ||
      r.label.toLowerCase().includes(term) ||
      (r.identifier ?? "").toLowerCase().includes(term) ||
      (r.url ?? "").toLowerCase().includes(term)
    );
  }, [rows, q]);

  const byCategory = useMemo(() => {
    const map = new Map<string, VaultRow[]>();
    for (const r of filtered) {
      (map.get(r.category) ?? map.set(r.category, []).get(r.category)!).push(r);
    }
    return map;
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Credentials vault"
        description="Encrypted store for shared passwords. Decrypts only on click — every reveal is audited."
        icon={<KeyRound className="h-5 w-5" />}
        actions={canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add credential
          </Button>
        )}
      />

      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by label, username, URL..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 max-w-sm border-0 focus-visible:ring-0"
          />
          <span className="ml-auto text-xs text-muted-foreground">
            {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "credential" : "credentials"}`}
          </span>
        </div>

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {canCreate
              ? <>Vault is empty. Click <b>Add credential</b> to store the first one.</>
              : "Nothing has been shared with you yet. Ask Kiran to grant access to specific credentials."}
          </div>
        )}

        {CATEGORIES.map(({ key, label, Icon }) => {
          const list = byCategory.get(key);
          if (!list || list.length === 0) return null;
          return (
            <div key={key}>
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
                <span className="text-xs text-muted-foreground">· {list.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/vault/${r.id}`)}
                    className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left shadow-card hover:border-primary/30"
                  >
                    <p className="truncate font-medium">{r.label}</p>
                    {r.identifier && <p className="truncate text-xs text-muted-foreground">{r.identifier}</p>}
                    {r.url && <p className="truncate text-[11px] text-muted-foreground">{r.url}</p>}
                    {r.rotate_every_days && (
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        rotates every {r.rotate_every_days} days
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* Render any unknown categories at the bottom under "Other". */}
        {Array.from(byCategory.entries())
          .filter(([k]) => !CATEGORY_LOOKUP[k])
          .map(([k, list]) => (
            <div key={k}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/vault/${r.id}`)}
                    className="rounded-xl border border-border bg-surface p-3 text-left shadow-card hover:border-primary/30"
                  >
                    <p className="truncate font-medium">{r.label}</p>
                    {r.identifier && <p className="truncate text-xs text-muted-foreground">{r.identifier}</p>}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>

      <CreateVaultDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); void load(); navigate(`/vault/${id}`); }}
      />
    </div>
  );
}

// ----------------- Create credential dialog (super_admin only) -----------------

function CreateVaultDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("email");
  const [identifier, setIdentifier] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [notes, setNotes] = useState("");
  const [rotate, setRotate] = useState<number | "">(90);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setLabel(""); setCategory("email"); setIdentifier(""); setUrl("");
    setSecret(""); setNotes(""); setRotate(90);
  };

  const submit = async () => {
    if (!label.trim()) return toast.error("Label is required");
    if (!secret.trim()) return toast.error("Secret can't be empty");
    setBusy(true);
    try {
      const row = await api.createVault({
        label: label.trim(),
        category,
        identifier: identifier.trim() || null,
        url: url.trim() || null,
        secret: secret,
        notes: notes.trim() || null,
        rotate_every_days: typeof rotate === "number" ? rotate : null,
      });
      toast.success("Credential saved");
      reset();
      onCreated(row.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && (onClose(), reset())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Add credential</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Label *</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Innomax cPanel — production"
              className="mt-1 h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Rotate every (days)</Label>
              <Input
                type="number" min={1} max={3650}
                value={rotate}
                onChange={(e) => setRotate(e.target.value === "" ? "" : Math.max(1, Number(e.target.value) || 0))}
                placeholder="e.g. 90 — leave blank to never remind"
                className="mt-1 h-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Username / identifier</Label>
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="account@example.com"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Secret (password / token / key) *</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="mt-1 h-9 font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="2FA recovery codes location, who has the master key, anything else"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); reset(); }} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
