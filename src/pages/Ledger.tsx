import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import {
  api, ApiError,
  type LedgerEntryRow, type LedgerSummary, type FounderDueRow,
} from "@/lib/api";
import { toast } from "sonner";
import {
  BookOpen, Plus, Loader2, ArrowUp, ArrowDown, Paperclip,
  ExternalLink, Pencil, Trash2, Wallet, Download, X,
} from "lucide-react";
import { CompanyBadge } from "@/components/CompanyBadge";
import { UserAvatar } from "@/components/UserAvatar";

const MANAGE_ROLES = new Set([
  "super_admin", "founder",
  "founder_office_coordinator", "founder_office_support",
  "hr_admin",
]);

const CATEGORY_OPTIONS = [
  "food", "travel", "stationery", "utilities", "compliance",
  "salary", "vendor", "capex", "marketing", "professional_fees",
  "rent", "repairs", "internet_phone", "fuel", "cleaning",
  "reimbursement", "other",
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  food: "Food / meals", travel: "Travel", stationery: "Stationery",
  utilities: "Utilities", compliance: "Compliance / tax",
  salary: "Salary", vendor: "Vendor", capex: "Capex / assets",
  marketing: "Marketing", professional_fees: "Professional fees",
  rent: "Rent", repairs: "Repairs", internet_phone: "Internet / phone",
  fuel: "Fuel", cleaning: "Cleaning", reimbursement: "Reimbursement",
  other: "Other",
};

const PAYMENT_MODES = [
  "upi", "bank_transfer", "neft", "rtgs", "imps",
  "cash", "credit_card", "debit_card", "cheque", "wallet",
  "foreign_card", "other",
] as const;

const SOURCE_BADGES: Record<string, { label: string; tone: string }> = {
  manual: { label: "Manual", tone: "bg-surface-muted text-muted-foreground" },
  vendor_payment: { label: "Vendor", tone: "bg-primary-soft text-primary" },
  expense_claim: { label: "Reimburse", tone: "bg-primary-soft text-primary" },
  payslip: { label: "Salary", tone: "bg-primary-soft text-primary" },
  compliance: { label: "Compliance", tone: "bg-primary-soft text-primary" },
  asset: { label: "Asset", tone: "bg-primary-soft text-primary" },
};

function inr(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  if (!v) return "0";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export default function Ledger() {
  const { role } = useAuth();
  const { companies, getUser, getCompany } = useDataStore();
  const navigate = useNavigate();
  const isManage = role ? MANAGE_ROLES.has(role) : false;

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.isActive),
    [companies],
  );

  const [companyId, setCompanyId] = useState(activeCompanies[0]?.id ?? "");
  const [month, setMonth] = useState(currentMonth);
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [category, setCategory] = useState<string>("all");
  const [sourceKind, setSourceKind] = useState<string>("all");

  const [rows, setRows] = useState<LedgerEntryRow[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [founderDues, setFounderDues] = useState<FounderDueRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LedgerEntryRow | null>(null);
  const [reimburseTarget, setReimburseTarget] = useState<LedgerEntryRow | null>(null);

  useEffect(() => {
    if (!companyId && activeCompanies[0]) setCompanyId(activeCompanies[0].id);
  }, [activeCompanies, companyId]);

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { from, to } = monthBounds(month);
      const [r, s, fd] = await Promise.all([
        api.listLedger({
          company_id: companyId,
          from, to,
          direction: direction === "all" ? undefined : direction,
          category: category === "all" ? undefined : category,
          source_kind: sourceKind === "all" ? undefined : sourceKind,
          limit: 1000,
        }),
        api.getLedgerSummary(companyId, month),
        api.getFounderDues(companyId),
      ]);
      setRows(r);
      setSummary(s);
      setFounderDues(fd);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load ledger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [companyId, month, direction, category, sourceKind]);

  // Click-through to the source module's view.
  const openSource = (r: LedgerEntryRow) => {
    if (r.source_kind === "manual" || !r.source_id) {
      setEditTarget(r);
      return;
    }
    if (r.source_kind === "vendor_payment" && r.payee_vendor_id) {
      navigate(`/vendors/${r.payee_vendor_id}`);
      return;
    }
    if (r.source_kind === "payslip") {
      navigate(`/salary/payslips/${r.source_id}`);
      return;
    }
    if (r.source_kind === "asset") {
      navigate(`/assets/${r.source_id}`);
      return;
    }
    if (r.source_kind === "expense_claim") {
      navigate("/expenses");
      return;
    }
    if (r.source_kind === "compliance") {
      navigate("/compliance");
    }
  };

  // CSV export — matches your old admin/ops sheet columns plus the
  // extras for tax + currency + source.
  const exportCsv = () => {
    const header = [
      "Date", "Detail", "Amount", "Currency", "INR",
      "Direction", "Category", "Sub-category", "Mode",
      "Paid By (bank / user / label)", "Send to (vendor / user / text / UPI)",
      "Reference", "GST", "TDS", "Reimbursable", "Reimbursed",
      "Source", "Notes",
    ];
    const lines = [header.join(",")];
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    for (const r of rows) {
      const payerLabel = r.bank_account_id
        ? `bank:${r.bank_account_id.slice(0, 8)}`
        : r.payer_user_id
          ? (getUser(r.payer_user_id)?.name ?? r.payer_user_id)
          : r.source_label ?? "";
      const payeeLabel = r.payee_vendor_id
        ? `vendor:${r.payee_vendor_id.slice(0, 8)}`
        : r.payee_user_id
          ? (getUser(r.payee_user_id)?.name ?? r.payee_user_id)
          : [r.payee_text, r.payee_identifier].filter(Boolean).join(" · ");
      lines.push([
        r.txn_date, r.description, Number(r.amount), r.currency, Number(r.amount_inr),
        r.direction, CATEGORY_LABEL[r.category] ?? r.category, r.sub_category ?? "", r.payment_mode ?? "",
        payerLabel, payeeLabel,
        r.reference ?? "", r.gst_amount ?? "", r.tds_amount ?? "",
        r.reimbursable ? "yes" : "no",
        r.reimbursed_at ? r.reimbursed_at.slice(0, 10) : "",
        r.source_kind, r.notes ?? "",
      ].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const co = getCompany(companyId);
    a.href = url;
    a.download = `ledger-${co?.shortName ?? co?.name ?? companyId}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const founderDuesTotal = founderDues.reduce((s, f) => s + Number(f.owed_inr || 0), 0);

  return (
    <div>
      <PageHeader
        title="Company ledger"
        description="Per-entity cash book — all money in and out, auto-pulled from vendors / expenses / salary."
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="mr-1.5 h-4 w-4" /> CSV
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add entry
            </Button>
          </div>
        }
      />

      <div className="space-y-6 p-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Label className="text-xs text-muted-foreground">Company:</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Pick" /></SelectTrigger>
            <SelectContent>
              {activeCompanies.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 w-40"
          />

          <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="in">IN only</SelectItem>
              <SelectItem value="out">OUT only</SelectItem>
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceKind} onValueChange={setSourceKind}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="vendor_payment">Vendor payments</SelectItem>
              <SelectItem value="expense_claim">Reimbursements</SelectItem>
              <SelectItem value="payslip">Salary</SelectItem>
              <SelectItem value="compliance">Compliance</SelectItem>
              <SelectItem value="asset">Assets</SelectItem>
            </SelectContent>
          </Select>

          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={`IN · ${month}`} value={`₹${inr(summary?.gross_in ?? 0)}`} tone="text-success" icon={ArrowDown} />
          <Stat label={`OUT · ${month}`} value={`₹${inr(summary?.gross_out ?? 0)}`} tone="text-destructive" icon={ArrowUp} />
          <Stat
            label="Net"
            value={`₹${inr(summary?.net ?? 0)}`}
            tone={(summary?.net ?? 0) >= 0 ? "text-primary" : "text-destructive"}
          />
          <FounderDuesCard
            total={founderDuesTotal}
            dues={founderDues}
            getUser={getUser}
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Paid by</th>
                <th className="px-3 py-2.5 font-medium">Send to</th>
                <th className="px-3 py-2.5 font-medium text-right">IN</th>
                <th className="px-3 py-2.5 font-medium text-right">OUT</th>
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">
                  No entries this month. {isManage && <>Click <b>Add entry</b> to record an ad-hoc payment.</>}
                </td></tr>
              )}
              {rows.map((r) => {
                const payerName = r.payer_user_id ? getUser(r.payer_user_id)?.name : null;
                const payeeUser = r.payee_user_id ? getUser(r.payee_user_id) : null;
                const isFounderDue = r.reimbursable && !r.reimbursed_at;
                return (
                  <tr
                    key={r.id}
                    className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40 ${
                      isFounderDue ? "bg-warning/5" : ""
                    }`}
                    onClick={() => openSource(r)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.txn_date}</td>
                    <td className="px-3 py-2 max-w-[280px]">
                      <p className="truncate">{r.description}</p>
                      {r.reference && <p className="truncate text-[11px] text-muted-foreground">ref {r.reference}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {CATEGORY_LABEL[r.category] ?? r.category}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {payerName ? (
                        <span className="inline-flex items-center gap-1">
                          <UserAvatar userId={r.payer_user_id!} size="xs" />
                          {payerName}
                          {isFounderDue && (
                            <span className="ml-1 rounded bg-warning/20 px-1 py-0.5 text-[9px] font-medium text-warning">DUE</span>
                          )}
                        </span>
                      ) : r.bank_account_id ? (
                        <span className="text-muted-foreground">Bank</span>
                      ) : r.source_label ? (
                        <span className="text-muted-foreground">{r.source_label}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {payeeUser ? (
                        <span className="inline-flex items-center gap-1">
                          <UserAvatar userId={payeeUser.id} size="xs" />
                          {payeeUser.name}
                        </span>
                      ) : r.payee_vendor_id ? (
                        <span className="text-muted-foreground">vendor</span>
                      ) : r.payee_text ? (
                        <span>
                          {r.payee_text}
                          {r.payee_identifier && <span className="text-[11px] text-muted-foreground"> · {r.payee_identifier}</span>}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.direction === "in" ? (
                        <span className="text-success">₹{inr(r.amount_inr)}</span>
                      ) : ""}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.direction === "out" ? (
                        <span className="text-destructive">₹{inr(r.amount_inr)}</span>
                      ) : ""}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${SOURCE_BADGES[r.source_kind]?.tone ?? "bg-surface-muted"}`}>
                        {SOURCE_BADGES[r.source_kind]?.label ?? r.source_kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isFounderDue && isManage && (
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={(e) => { e.stopPropagation(); setReimburseTarget(r); }}
                        >
                          <Wallet className="mr-1 h-3.5 w-3.5" /> Reimburse
                        </Button>
                      )}
                      {r.source_kind !== "manual" && (
                        <ExternalLink className="ml-auto inline h-3 w-3 text-muted-foreground" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <EntryDialog
          mode="create"
          companyId={companyId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); void load(); }}
        />
      )}
      {editTarget && (
        <EntryDialog
          mode="edit"
          companyId={editTarget.company_id}
          existing={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); void load(); }}
        />
      )}
      {reimburseTarget && (
        <ReimburseDialog
          entry={reimburseTarget}
          onClose={() => setReimburseTarget(null)}
          onSaved={() => { setReimburseTarget(null); void load(); }}
        />
      )}
    </div>
  );
}

function Stat({
  label, value, tone, icon: Icon,
}: { label: string; value: string; tone?: string; icon?: typeof ArrowDown }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${tone ?? ""}`}>
        {Icon && <Icon className="mr-1.5 inline h-5 w-5" />}
        {value}
      </p>
    </div>
  );
}

function FounderDuesCard({
  total, dues, getUser,
}: {
  total: number;
  dues: FounderDueRow[];
  getUser: (id?: string) => { id: string; name: string } | undefined;
}) {
  return (
    <div className={`rounded-xl border p-4 shadow-card ${total > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-surface"}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Founder dues</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${total > 0 ? "text-warning" : ""}`}>
        ₹{inr(total)}
      </p>
      {dues.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {dues.slice(0, 3).map((d) => (
            <li key={d.payer_user_id}>
              {getUser(d.payer_user_id)?.name ?? "—"}: ₹{inr(d.owed_inr)} ({d.rows} entr{d.rows === 1 ? "y" : "ies"})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===================== Entry create / edit dialog =====================

function EntryDialog({
  mode, companyId, existing, onClose, onSaved,
}: {
  mode: "create" | "edit";
  companyId: string;
  existing?: LedgerEntryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { users } = useDataStore();
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [direction, setDirection] = useState<"in" | "out">(existing?.direction ?? "out");
  const [txnDate, setTxnDate] = useState(existing?.txn_date ?? today);
  const [amount, setAmount] = useState(existing?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState(existing?.currency ?? "INR");
  const [fxRate, setFxRate] = useState(existing?.fx_rate?.toString() ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [category, setCategory] = useState(existing?.category ?? "other");
  const [subCategory, setSubCategory] = useState(existing?.sub_category ?? "");
  const [paymentMode, setPaymentMode] = useState(existing?.payment_mode ?? "");

  const [payerUserId, setPayerUserId] = useState(existing?.payer_user_id ?? "");
  const [sourceLabel, setSourceLabel] = useState(existing?.source_label ?? "");

  const [payeeMode, setPayeeMode] = useState<"user" | "text">(
    existing?.payee_user_id ? "user" : "text",
  );
  const [payeeUserId, setPayeeUserId] = useState(existing?.payee_user_id ?? "");
  const [payeeText, setPayeeText] = useState(existing?.payee_text ?? "");
  const [payeeIdentifier, setPayeeIdentifier] = useState(existing?.payee_identifier ?? "");

  const [reference, setReference] = useState(existing?.reference ?? "");
  const [gstAmount, setGstAmount] = useState(existing?.gst_amount?.toString() ?? "");
  const [hsnCode, setHsnCode] = useState(existing?.hsn_code ?? "");
  const [tdsAmount, setTdsAmount] = useState(existing?.tds_amount?.toString() ?? "");
  const [tdsSection, setTdsSection] = useState(existing?.tds_section ?? "");
  const [reimbursable, setReimbursable] = useState(existing?.reimbursable ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const submit = async () => {
    if (!txnDate) return toast.error("Pick a date");
    if (!amount || Number(amount) <= 0) return toast.error("Amount must be > 0");
    if (!description.trim()) return toast.error("Description is required");
    if (reimbursable && !payerUserId) return toast.error("Pick the payer (who fronted the money) when marking reimbursable");
    setBusy(true);
    try {
      const payload = {
        company_id: companyId,
        txn_date: txnDate,
        direction,
        amount: Number(amount),
        currency: currency || "INR",
        fx_rate: fxRate ? Number(fxRate) : null,
        description: description.trim(),
        category, sub_category: subCategory.trim() || null,
        payment_mode: paymentMode || null,
        payer_user_id: payerUserId || null,
        source_label: sourceLabel.trim() || null,
        payee_user_id: payeeMode === "user" ? (payeeUserId || null) : null,
        payee_text: payeeMode === "text" ? (payeeText.trim() || null) : null,
        payee_identifier: payeeMode === "text" ? (payeeIdentifier.trim() || null) : null,
        reference: reference.trim() || null,
        gst_amount: gstAmount ? Number(gstAmount) : null,
        hsn_code: hsnCode.trim() || null,
        tds_amount: tdsAmount ? Number(tdsAmount) : null,
        tds_section: tdsSection.trim() || null,
        reimbursable,
        notes: notes.trim() || null,
      } as any;
      if (mode === "create") {
        await api.createLedgerEntry(payload);
        toast.success("Entry added");
      } else {
        await api.updateLedgerEntry(existing!.id, payload);
        toast.success("Saved");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm("Delete this entry?")) return;
    setBusy(true);
    try {
      await api.deleteLedgerEntry(existing.id);
      toast.success("Deleted");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> {mode === "create" ? "Add ledger entry" : "Edit entry"}
          </DialogTitle>
          {mode === "edit" && existing?.source_kind !== "manual" && (
            <DialogDescription className="text-destructive">
              This row was generated from a {existing?.source_kind} — edit at the source instead.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3">
          {/* Direction + date + amount */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Direction *</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "in" | "out")}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="out">OUT (expense)</SelectItem>
                  <SelectItem value="in">IN (credit)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date *</Label>
              <Input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Amount *</Label>
              <Input type="number" step={0.01} min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="mt-1 h-9" maxLength={3} />
            </div>
            {currency !== "INR" && (
              <div className="col-span-4">
                <Label className="text-xs">FX rate (1 {currency} → ₹)</Label>
                <Input type="number" step={0.000001} min={0} value={fxRate} onChange={(e) => setFxRate(e.target.value)} className="mt-1 h-9" placeholder="e.g. 85.50" />
                {amount && fxRate && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    INR equivalent: ₹{inr(Number(amount) * Number(fxRate))}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Description *</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 h-9" placeholder="e.g. Carpenter — bathroom doors" />
          </div>

          {/* Category + payment mode */}
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
              <Label className="text-xs">Sub-category</Label>
              <Input value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="mt-1 h-9" placeholder="optional" />
            </div>
            <div>
              <Label className="text-xs">Payment mode</Label>
              <Select value={paymentMode || "__none__"} onValueChange={(v) => setPaymentMode(v === "__none__" ? "" : v)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Paid by */}
          <div className="rounded-md border border-border bg-surface-muted/30 p-3">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Paid by</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Payer (person who fronted)</Label>
                <Select value={payerUserId || "__none__"} onValueChange={(v) => setPayerUserId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— from company bank —</SelectItem>
                    {users.filter((u) => u.isActive).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Source label (free text)</Label>
                <Input
                  value={sourceLabel}
                  onChange={(e) => setSourceLabel(e.target.value)}
                  placeholder="e.g. Petty cash, Founder's card"
                  className="mt-1 h-9"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="reimbursable" type="checkbox"
                checked={reimbursable}
                onChange={(e) => setReimbursable(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="reimbursable" className="text-xs">
                Reimbursable — company owes the payer this back
              </Label>
            </div>
          </div>

          {/* Send to */}
          <div className="rounded-md border border-border bg-surface-muted/30 p-3">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Send to</p>
            <div className="mb-2 flex items-center gap-2 text-xs">
              <button
                onClick={() => setPayeeMode("user")}
                className={`rounded px-2 py-1 ${payeeMode === "user" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}
              >
                A teammate
              </button>
              <button
                onClick={() => setPayeeMode("text")}
                className={`rounded px-2 py-1 ${payeeMode === "text" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}
              >
                Ad-hoc (name + UPI / phone)
              </button>
            </div>
            {payeeMode === "user" ? (
              <Select value={payeeUserId || "__none__"} onValueChange={(v) => setPayeeUserId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Pick a teammate" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {users.filter((u) => u.isActive).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Input value={payeeText} onChange={(e) => setPayeeText(e.target.value)} placeholder="e.g. Bhaskar Reddy, Mohammed Abdul Aleem" className="h-9" />
                <Input value={payeeIdentifier} onChange={(e) => setPayeeIdentifier(e.target.value)} placeholder="UPI / phone (e.g. 9494638526@ybl)" className="h-9" />
              </div>
            )}
          </div>

          {/* Reference + tax */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Reference (UTR / UPI ref / invoice no.)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">HSN / SAC code</Label>
              <Input value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} className="mt-1 h-9" placeholder="optional" />
            </div>
            <div>
              <Label className="text-xs">GST amount (₹)</Label>
              <Input type="number" step={0.01} min={0} value={gstAmount} onChange={(e) => setGstAmount(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">TDS amount (₹)</Label>
              <Input type="number" step={0.01} min={0} value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} className="mt-1 h-9" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">TDS section</Label>
              <Input value={tdsSection} onChange={(e) => setTdsSection(e.target.value)} className="mt-1 h-9" placeholder="e.g. 194J, 194C" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="Free-text context (the 'Paid to / From' column from the old sheet)"
            />
          </div>
        </div>

        <DialogFooter>
          {mode === "edit" && existing?.source_kind === "manual" && (
            <Button variant="ghost" className="mr-auto text-muted-foreground hover:text-destructive" onClick={remove} disabled={busy}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (mode === "edit" && existing?.source_kind !== "manual")}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {mode === "create" ? "Add entry" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===================== Reimburse dialog =====================

function ReimburseDialog({
  entry, onClose, onSaved,
}: { entry: LedgerEntryRow; onClose: () => void; onSaved: () => void }) {
  const { getUser } = useDataStore();
  const payer = entry.payer_user_id ? getUser(entry.payer_user_id) : null;
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState("bank_transfer");
  const [sourceLabel, setSourceLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.reimburseLedgerEntry(entry.id, {
        reference: reference.trim() || undefined,
        payment_mode: mode || undefined,
        source_label: sourceLabel.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success("Marked reimbursed");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Reimburse</DialogTitle>
          <DialogDescription>
            Pay {payer?.name ?? "the payer"} ₹{inr(entry.amount_inr)} for "{entry.description}".
            A paired bank-out entry will appear in the cash book.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reference (txn id)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Source label (optional)</Label>
            <Input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="e.g. HDFC current — Heal" className="mt-1 h-9" />
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
            Mark reimbursed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
