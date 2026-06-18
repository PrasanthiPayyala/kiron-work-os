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
import { api, ApiError, type AssetRow } from "@/lib/api";
import { toast } from "sonner";
import {
  Laptop, Monitor, Smartphone, IdCard, Headphones, Mouse, Package,
  Plus, Search, Loader2,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";

const CATEGORY_OPTIONS = [
  "laptop", "monitor", "phone", "id_card", "headset", "keyboard",
  "mouse", "tablet", "router", "other",
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  laptop: "Laptops",
  monitor: "Monitors",
  phone: "Phones",
  id_card: "ID cards",
  headset: "Headsets",
  keyboard: "Keyboards",
  mouse: "Mice",
  tablet: "Tablets",
  router: "Routers / network",
  other: "Other",
};

const CATEGORY_ICON: Record<string, typeof Laptop> = {
  laptop: Laptop,
  monitor: Monitor,
  phone: Smartphone,
  id_card: IdCard,
  headset: Headphones,
  mouse: Mouse,
};

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In stock",
  issued: "Issued",
  in_repair: "In repair",
  retired: "Retired",
  lost: "Lost",
};

const STATUS_TONE: Record<string, string> = {
  in_stock: "bg-surface-muted text-muted-foreground",
  issued: "bg-primary-soft text-primary",
  in_repair: "bg-warning/10 text-warning",
  retired: "bg-muted text-muted-foreground",
  lost: "bg-destructive/10 text-destructive",
};

export default function Assets() {
  const navigate = useNavigate();
  const { getUser } = useDataStore();
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.listAssets());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load assets");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!term) return true;
      const holder = r.current_holder_id ? getUser(r.current_holder_id)?.name?.toLowerCase() ?? "" : "";
      return (
        (r.asset_tag ?? "").toLowerCase().includes(term) ||
        (r.brand ?? "").toLowerCase().includes(term) ||
        (r.model ?? "").toLowerCase().includes(term) ||
        (r.serial_number ?? "").toLowerCase().includes(term) ||
        holder.includes(term)
      );
    });
  }, [rows, q, statusFilter, getUser]);

  const byCategory = useMemo(() => {
    const m = new Map<string, AssetRow[]>();
    for (const r of filtered) {
      (m.get(r.category) ?? m.set(r.category, []).get(r.category)!).push(r);
    }
    return m;
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Assets"
        description="Laptops, monitors, phones, ID cards — issued, returned, in repair."
        icon={<Laptop className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New asset
          </Button>
        }
      />

      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by tag / brand / model / serial / holder"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 max-w-sm border-0 focus-visible:ring-0"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="in_stock">In stock</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="in_repair">In repair</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "asset" : "assets"}`}
          </span>
        </div>

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No assets registered yet. Click <b>New asset</b> to add the first one.
          </div>
        )}

        {CATEGORY_OPTIONS.map((cat) => {
          const list = byCategory.get(cat);
          if (!list || list.length === 0) return null;
          const Icon = CATEGORY_ICON[cat] ?? Package;
          return (
            <div key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABEL[cat] ?? cat}
                </h3>
                <span className="text-xs text-muted-foreground">· {list.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => {
                  const holder = r.current_holder_id ? getUser(r.current_holder_id) : null;
                  return (
                    <button
                      key={r.id}
                      onClick={() => navigate(`/assets/${r.id}`)}
                      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-card hover:border-primary/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.asset_tag || `${r.brand ?? ""} ${r.model ?? ""}`.trim() || "Untagged"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[r.brand, r.model, r.serial_number ? `SN ${r.serial_number}` : null]
                              .filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[r.status]}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      {holder ? (
                        <div className="flex items-center gap-1.5">
                          <UserAvatar userId={holder.id} size="xs" />
                          <span className="text-xs text-muted-foreground truncate">{holder.name}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">In stock</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <CreateAssetDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); void load(); navigate(`/assets/${id}`); }}
      />
    </div>
  );
}

// ---------- Create ----------

function CreateAssetDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { companies } = useDataStore();
  const [assetTag, setAssetTag] = useState("");
  const [category, setCategory] = useState("laptop");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [companyId, setCompanyId] = useState("__none__");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [condition, setCondition] = useState<"new" | "good" | "fair" | "poor">("good");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAssetTag(""); setCategory("laptop"); setBrand(""); setModel("");
      setSerial(""); setCompanyId("__none__"); setPurchaseDate(""); setPurchaseCost("");
      setSupplier(""); setCondition("good"); setNotes("");
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const created = await api.createAsset({
        asset_tag: assetTag.trim() || null,
        category,
        brand: brand.trim() || null,
        model: model.trim() || null,
        serial_number: serial.trim() || null,
        company_id: companyId === "__none__" ? null : companyId,
        purchase_date: purchaseDate || null,
        purchase_cost: purchaseCost ? Number(purchaseCost) : null,
        supplier: supplier.trim() || null,
        condition,
        notes: notes.trim() || null,
      });
      toast.success("Asset registered");
      onCreated(created.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Laptop className="h-4 w-4" /> New asset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Asset tag (optional)</Label>
              <Input value={assetTag} onChange={(e) => setAssetTag(e.target.value)} className="mt-1 h-9" placeholder="e.g. KIRON-LAPTOP-001" />
            </div>
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
              <Label className="text-xs">Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1 h-9" placeholder="e.g. Dell, Apple" />
            </div>
            <div>
              <Label className="text-xs">Model</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 h-9" placeholder="e.g. XPS 13" />
            </div>
            <div>
              <Label className="text-xs">Serial number</Label>
              <Input value={serial} onChange={(e) => setSerial(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Condition</Label>
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
              <Label className="text-xs">Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— unset —</SelectItem>
                  {companies.filter((c) => c.isActive).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Purchase date</Label>
              <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Purchase cost (₹)</Label>
              <Input type="number" step={0.01} min={0} value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Supplier</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="mt-1 h-9" placeholder="e.g. Croma, Amazon Business" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="e.g. Warranty until Jun 2027 · 2 chargers"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Register asset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
