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
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import {
  api, ApiError, type AssetRow, type AssetAssignmentRow,
} from "@/lib/api";
import { toast } from "sonner";
import {
  Laptop, ArrowLeft, Loader2, Send, Undo, History as HistoryIcon, Trash2,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";

const ASSET_MANAGE_ROLES = new Set([
  "super_admin", "founder", "founder_office_coordinator",
  "founder_office_support", "hr_admin",
]);

const STATUS_TONE: Record<string, string> = {
  in_stock: "bg-surface-muted text-muted-foreground",
  issued: "bg-primary-soft text-primary",
  in_repair: "bg-warning/10 text-warning",
  retired: "bg-muted text-muted-foreground",
  lost: "bg-destructive/10 text-destructive",
};

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { getUser } = useDataStore();
  const canManage = role ? ASSET_MANAGE_ROLES.has(role) : false;
  const canDelete = role === "super_admin" || role === "founder";

  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [history, setHistory] = useState<AssetAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [issueOpen, setIssueOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [a, h] = await Promise.all([api.getAsset(id), api.listAssetHistory(id)]);
      setAsset(a);
      setHistory(h);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load asset");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [id]);

  const deleteAsset = async () => {
    if (!asset) return;
    if (!confirm("Delete this asset permanently? Assignment history will be lost.")) return;
    try {
      await api.deleteAsset(asset.id);
      toast.success("Deleted");
      navigate("/assets");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    }
  };

  if (loading || !asset) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/assets")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to assets
        </Button>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "Asset not found."}
        </p>
      </div>
    );
  }

  const holder = asset.current_holder_id ? getUser(asset.current_holder_id) : null;
  const issuedOk = asset.status === "issued";
  const inStock = asset.status === "in_stock";

  return (
    <div>
      <PageHeader
        title={asset.asset_tag || `${asset.brand ?? ""} ${asset.model ?? ""}`.trim() || "Untagged asset"}
        description={asset.category}
        icon={<Laptop className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate("/assets")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Assets
            </Button>
            {canManage && (
              <>
                {inStock && (
                  <Button size="sm" onClick={() => setIssueOpen(true)}>
                    <Send className="mr-1.5 h-4 w-4" /> Issue to…
                  </Button>
                )}
                {issuedOk && (
                  <Button size="sm" variant="outline" onClick={() => setReturnOpen(true)}>
                    <Undo className="mr-1.5 h-4 w-4" /> Return
                  </Button>
                )}
              </>
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void deleteAsset()}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between">
              <span className={`rounded px-2 py-0.5 text-[11px] uppercase tracking-wide ${STATUS_TONE[asset.status]}`}>
                {asset.status.replace("_", " ")}
              </span>
              {asset.company_id && <CompanyBadge companyId={asset.company_id} size="xs" />}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Row label="Brand" value={asset.brand} />
              <Row label="Model" value={asset.model} />
              <Row label="Serial" value={asset.serial_number} mono />
              <Row label="Condition" value={asset.condition} />
              <Row label="Purchased" value={asset.purchase_date} />
              <Row label="Cost" value={asset.purchase_cost ? `₹${Number(asset.purchase_cost).toLocaleString("en-IN")}` : null} />
              <Row label="Supplier" value={asset.supplier} />
              <Row label="Asset tag" value={asset.asset_tag} mono />
            </div>
            {asset.notes && (
              <div className="mt-3 rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap">{asset.notes}</div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <HistoryIcon className="mr-1 inline h-3.5 w-3.5" /> Assignment history
            </h3>
            {history.length === 0 && <p className="text-sm text-muted-foreground">No assignments yet.</p>}
            <ul className="space-y-2">
              {history.map((h) => {
                const u = getUser(h.user_id);
                const active = !h.returned_at;
                return (
                  <li key={h.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <UserAvatar userId={h.user_id} size="xs" />
                      <span className="font-medium">{u?.name ?? "Unknown"}</span>
                      <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${active ? "bg-primary-soft text-primary" : "bg-surface-muted text-muted-foreground"}`}>
                        {active ? "Active" : "Returned"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Issued {new Date(h.issued_at).toLocaleString()}
                      {h.returned_at && ` · returned ${new Date(h.returned_at).toLocaleString()}`}
                    </p>
                    {h.issue_note && <p className="mt-1 text-xs">Issue: {h.issue_note}</p>}
                    {h.return_note && <p className="mt-1 text-xs">Return: {h.return_note}</p>}
                    {(h.condition_at_issue || h.condition_at_return) && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {h.condition_at_issue && `Issued: ${h.condition_at_issue}`}
                        {h.condition_at_issue && h.condition_at_return && " · "}
                        {h.condition_at_return && `Returned: ${h.condition_at_return}`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <aside className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Currently held by</h3>
          {holder ? (
            <div className="mt-3 flex items-center gap-2">
              <UserAvatar userId={holder.id} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{holder.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{holder.designation}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">In stock — not assigned to anyone right now.</p>
          )}
        </aside>
      </div>

      {issueOpen && (
        <IssueDialog
          assetId={asset.id}
          onClose={() => setIssueOpen(false)}
          onIssued={() => { setIssueOpen(false); void load(); }}
        />
      )}
      {returnOpen && (
        <ReturnDialog
          assetId={asset.id}
          onClose={() => setReturnOpen(false)}
          onReturned={() => { setReturnOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | number | null; mono?: boolean }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <p className={`mt-0.5 ${mono ? "font-mono" : ""} ${value ? "" : "text-muted-foreground"}`}>{value || "—"}</p>
    </div>
  );
}

// ---------- Issue ----------

function IssueDialog({
  assetId, onClose, onIssued,
}: { assetId: string; onClose: () => void; onIssued: () => void }) {
  const { users } = useDataStore();
  const activeUsers = useMemo(() => users.filter((u) => u.isActive).sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<"new" | "good" | "fair" | "poor">("good");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId) return toast.error("Pick a person");
    setBusy(true);
    try {
      await api.issueAsset(assetId, { user_id: userId, issue_note: note.trim() || undefined, condition_at_issue: condition });
      toast.success("Asset issued");
      onIssued();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't issue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Issue asset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Issue to *</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick someone" /></SelectTrigger>
              <SelectContent>
                {activeUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} · {u.designation}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Condition at issue</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as typeof condition)}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="e.g. With 2 chargers, in original box"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !userId}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Return ----------

function ReturnDialog({
  assetId, onClose, onReturned,
}: { assetId: string; onClose: () => void; onReturned: () => void }) {
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<"new" | "good" | "fair" | "poor">("good");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.returnAsset(assetId, { return_note: note.trim() || undefined, condition_at_return: condition });
      toast.success("Asset returned to stock");
      onReturned();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't return");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Undo className="h-4 w-4" /> Return asset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Condition on return</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as typeof condition)}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="e.g. Charger missing · screen scratch"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
