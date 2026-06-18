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
import {
  api, ApiError, type VendorDetailRow, type VendorContractRow, type VendorPaymentRow,
} from "@/lib/api";
import { toast } from "sonner";
import {
  Store, ArrowLeft, Loader2, Plus, Trash2, FileSignature, Wallet, AlertTriangle, X,
} from "lucide-react";

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  subscription: "Subscription", retainer: "Retainer",
  one_time: "One-time", license: "License", other: "Other",
};
const CADENCE_LABEL: Record<string, string> = {
  monthly: "Monthly", quarterly: "Quarterly",
  half_yearly: "Half-yearly", yearly: "Yearly", one_time: "One-time",
};

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canDelete = role === "super_admin" || role === "founder";
  const [vendor, setVendor] = useState<VendorDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [contractOpen, setContractOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try { setVendor(await api.getVendor(id)); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);

  const deleteVendor = async () => {
    if (!vendor) return;
    if (!confirm("Delete this vendor? Contracts and payment history will also be lost.")) return;
    try {
      await api.deleteVendor(vendor.id);
      toast.success("Deleted");
      navigate("/vendors");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    }
  };

  if (loading || !vendor) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/vendors")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to vendors
        </Button>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "Vendor not found."}
        </p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title={vendor.name}
        description={vendor.category}
        icon={<Store className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate("/vendors")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Vendors
            </Button>
            <Button size="sm" onClick={() => setContractOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Contract
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPaymentOpen(true)}>
              <Wallet className="mr-1.5 h-4 w-4" /> Log payment
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void deleteVendor()}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <FileSignature className="mr-1 inline h-3.5 w-3.5" /> Contracts
            </h3>
            {vendor.contracts.length === 0 && (
              <p className="text-sm text-muted-foreground">No contracts yet — add one to start tracking renewals.</p>
            )}
            <ul className="space-y-2">
              {vendor.contracts.map((c) => {
                const due = c.end_date ? new Date(c.end_date) : null;
                const daysLeft = due ? Math.ceil((due.getTime() - new Date(today).getTime()) / (24 * 3600 * 1000)) : null;
                const urgent = daysLeft !== null && daysLeft <= (c.reminder_days_before ?? 30);
                return (
                  <li key={c.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{c.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {CONTRACT_TYPE_LABEL[c.contract_type] ?? c.contract_type} · {CADENCE_LABEL[c.billing_cadence] ?? c.billing_cadence}
                          {c.amount != null && ` · ${c.currency} ${Number(c.amount).toLocaleString("en-IN")}`}
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          if (!confirm("Delete this contract?")) return;
                          try { await api.deleteVendorContract(c.id); void load(); }
                          catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't delete"); }
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {c.end_date && (
                      <div className="mt-1.5 flex items-center gap-2 text-xs">
                        <span className={urgent ? "inline-flex items-center gap-1 text-warning" : "text-muted-foreground"}>
                          {urgent && <AlertTriangle className="h-3 w-3" />}
                          Renews {c.end_date}
                          {daysLeft !== null && ` (${daysLeft >= 0 ? `in ${daysLeft}d` : `${Math.abs(daysLeft)}d ago`})`}
                        </span>
                        <span className="text-muted-foreground">· reminder {c.reminder_days_before}d before</span>
                        {c.auto_renews && <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">auto-renews</span>}
                      </div>
                    )}
                    {c.notes && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{c.notes}</p>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Wallet className="mr-1 inline h-3.5 w-3.5" /> Payments
            </h3>
            {vendor.payments.length === 0 && <p className="text-sm text-muted-foreground">No payments logged yet.</p>}
            <ul className="space-y-1.5">
              {vendor.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                  <span className="font-mono text-xs">{p.paid_at}</span>
                  <span className="flex-1 truncate">
                    {p.currency} {Number(p.amount).toLocaleString("en-IN")}
                    {p.mode && <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{p.mode}</span>}
                    {p.reference && <span className="ml-2 text-[11px] text-muted-foreground">ref {p.reference}</span>}
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm("Delete this payment record?")) return;
                      try { await api.deleteVendorPayment(p.id); void load(); }
                      catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't delete"); }
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vendor info</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {vendor.primary_contact && <li><strong className="text-xs uppercase text-muted-foreground">Contact:</strong> {vendor.primary_contact}</li>}
              {vendor.primary_email && <li><strong className="text-xs uppercase text-muted-foreground">Email:</strong> {vendor.primary_email}</li>}
              {vendor.primary_phone && <li><strong className="text-xs uppercase text-muted-foreground">Phone:</strong> {vendor.primary_phone}</li>}
              {vendor.website && <li><strong className="text-xs uppercase text-muted-foreground">Website:</strong> <a href={vendor.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">{vendor.website}</a></li>}
              {vendor.gstin && <li><strong className="text-xs uppercase text-muted-foreground">GSTIN:</strong> {vendor.gstin}</li>}
            </ul>
            {vendor.notes && <p className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">{vendor.notes}</p>}
          </div>
        </aside>
      </div>

      {contractOpen && (
        <ContractDialog
          vendorId={vendor.id}
          onClose={() => setContractOpen(false)}
          onSaved={() => { setContractOpen(false); void load(); }}
        />
      )}
      {paymentOpen && (
        <PaymentDialog
          vendor={vendor}
          onClose={() => setPaymentOpen(false)}
          onSaved={() => { setPaymentOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

// ---------- Contract dialog ----------

function ContractDialog({
  vendorId, onClose, onSaved,
}: { vendorId: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [contractType, setContractType] = useState("subscription");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [cadence, setCadence] = useState("monthly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoRenews, setAutoRenews] = useState(false);
  const [reminderDays, setReminderDays] = useState(30);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setBusy(true);
    try {
      await api.createVendorContract(vendorId, {
        title: title.trim(),
        contract_type: contractType,
        amount: amount ? Number(amount) : null,
        currency,
        billing_cadence: cadence,
        start_date: startDate || null,
        end_date: endDate || null,
        auto_renews: autoRenews,
        reminder_days_before: reminderDays,
        notes: notes.trim() || null,
      });
      toast.success("Contract added");
      onSaved();
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
          <DialogTitle className="flex items-center gap-2"><FileSignature className="h-4 w-4" /> Add contract</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9" placeholder="e.g. Annual hosting plan, .com domain" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={contractType} onValueChange={setContractType}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CONTRACT_TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Billing cadence</Label>
              <Select value={cadence} onValueChange={setCadence}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CADENCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Amount</Label>
              <Input type="number" step={0.01} min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Renewal date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Reminder (days before)</Label>
              <Input type="number" min={0} max={365} value={reminderDays} onChange={(e) => setReminderDays(Math.max(0, Number(e.target.value) || 0))} className="mt-1 h-9" />
            </div>
            <div className="flex items-end gap-2">
              <input type="checkbox" id="auto" checked={autoRenews} onChange={(e) => setAutoRenews(e.target.checked)} className="h-4 w-4" />
              <Label htmlFor="auto" className="text-xs">Auto-renews</Label>
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="Account / SKU / anything else"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Payment dialog ----------

function PaymentDialog({
  vendor, onClose, onSaved,
}: { vendor: VendorDetailRow; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [contractId, setContractId] = useState<string>("__none__");
  const [mode, setMode] = useState<string>("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const activeContracts = useMemo(
    () => vendor.contracts.filter((c) => c.status === "active"),
    [vendor.contracts],
  );

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Amount must be > 0");
    if (!paidAt) return toast.error("Pick a paid-on date");
    setBusy(true);
    try {
      await api.createVendorPayment(vendor.id, {
        amount: amt,
        currency,
        paid_at: paidAt,
        contract_id: contractId === "__none__" ? null : contractId,
        mode: mode.trim() || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success("Payment logged");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't log");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Log payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Amount *</Label>
              <Input type="number" step={0.01} min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Paid on *</Label>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={mode || "__pick__"} onValueChange={(v) => setMode(v === "__pick__" ? "" : v)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__">—</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="credit_card">Credit card</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Against contract (optional)</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— ad-hoc / general —</SelectItem>
                  {activeContracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Reference (txn id, invoice no.)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Log payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
