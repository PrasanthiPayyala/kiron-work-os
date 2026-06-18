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
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError, type VendorRow } from "@/lib/api";
import { toast } from "sonner";
import {
  Store, Plus, Search, Loader2, Globe, Server, Zap, BookOpen,
  Scale, Calculator, MoreHorizontal,
} from "lucide-react";

const CATEGORY_OPTIONS = [
  "saas", "domain", "hosting", "utility",
  "consultant", "legal", "accounting", "marketing", "other",
] as const;
const CATEGORY_LABEL: Record<string, string> = {
  saas: "SaaS / software",
  domain: "Domain registrars",
  hosting: "Hosting / infra",
  utility: "Utilities",
  consultant: "Consultants",
  legal: "Legal",
  accounting: "Accounting / tax",
  marketing: "Marketing",
  other: "Other",
};
const CATEGORY_ICON: Record<string, typeof Store> = {
  saas: BookOpen, domain: Globe, hosting: Server, utility: Zap,
  consultant: Calculator, legal: Scale, accounting: Calculator,
  marketing: MoreHorizontal, other: Store,
};

export default function Vendors() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try { setRows(await api.listVendors()); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't load vendors"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) =>
      !term ||
      r.name.toLowerCase().includes(term) ||
      (r.primary_contact ?? "").toLowerCase().includes(term) ||
      (r.gstin ?? "").toLowerCase().includes(term)
    );
  }, [rows, q]);

  const byCategory = useMemo(() => {
    const m = new Map<string, VendorRow[]>();
    for (const r of filtered) {
      (m.get(r.category) ?? m.set(r.category, []).get(r.category)!).push(r);
    }
    return m;
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Domain registrars, SaaS subscriptions, hosting, consultants — and when they renew."
        icon={<Store className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New vendor
          </Button>
        }
      />
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name / primary contact / GSTIN"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 max-w-sm border-0 focus-visible:ring-0"
          />
          <span className="ml-auto text-xs text-muted-foreground">
            {loading ? "Loading…" : `${filtered.length} vendors`}
          </span>
        </div>

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No vendors yet. Click <b>New vendor</b> to add the first one.
          </div>
        )}

        {CATEGORY_OPTIONS.map((cat) => {
          const list = byCategory.get(cat);
          if (!list || list.length === 0) return null;
          const Icon = CATEGORY_ICON[cat];
          return (
            <div key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABEL[cat]}</h3>
                <span className="text-xs text-muted-foreground">· {list.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/vendors/${r.id}`)}
                    className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left shadow-card hover:border-primary/30"
                  >
                    <p className="truncate font-medium">{r.name}</p>
                    {r.primary_contact && <p className="truncate text-xs text-muted-foreground">{r.primary_contact}</p>}
                    {r.website && <p className="truncate text-[11px] text-muted-foreground">{r.website}</p>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <CreateVendorDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); void load(); navigate(`/vendors/${id}`); }}
      />
    </div>
  );
}

function CreateVendorDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { companies } = useDataStore();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("saas");
  const [website, setWebsite] = useState("");
  const [gstin, setGstin] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primaryPhone, setPrimaryPhone] = useState("");
  const [companyId, setCompanyId] = useState("__none__");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(""); setCategory("saas"); setWebsite(""); setGstin("");
      setPrimaryContact(""); setPrimaryEmail(""); setPrimaryPhone("");
      setCompanyId("__none__"); setNotes("");
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      const created = await api.createVendor({
        name: name.trim(),
        category,
        website: website.trim() || null,
        gstin: gstin.trim() || null,
        primary_contact: primaryContact.trim() || null,
        primary_email: primaryEmail.trim() || null,
        primary_phone: primaryPhone.trim() || null,
        company_id: companyId === "__none__" ? null : companyId,
        notes: notes.trim() || null,
      });
      toast.success("Vendor created");
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
          <DialogTitle className="flex items-center gap-2"><Store className="h-4 w-4" /> New vendor</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9" placeholder="e.g. Razorpay, GoDaddy, Tally" />
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
              <Label className="text-xs">Website</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} className="mt-1 h-9" placeholder="https://..." />
            </div>
            <div>
              <Label className="text-xs">GSTIN</Label>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Primary contact</Label>
              <Input value={primaryContact} onChange={(e) => setPrimaryContact(e.target.value)} className="mt-1 h-9" placeholder="Name of the person" />
            </div>
            <div>
              <Label className="text-xs">Primary email</Label>
              <Input value={primaryEmail} onChange={(e) => setPrimaryEmail(e.target.value)} className="mt-1 h-9" placeholder="support@vendor.com" />
            </div>
            <div>
              <Label className="text-xs">Primary phone</Label>
              <Input value={primaryPhone} onChange={(e) => setPrimaryPhone(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Buying entity</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
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
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="Account number, recovery email, anything else"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
