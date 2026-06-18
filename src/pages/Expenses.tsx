import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError, type ExpenseClaimRow } from "@/lib/api";
import { toast } from "sonner";
import {
  Receipt, Plus, Loader2, Check, X, Wallet, AlertTriangle, FileText,
} from "lucide-react";
import { CompanyBadge } from "@/components/CompanyBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { AttachmentList } from "@/components/attachments/AttachmentList";

const FINANCE_ROLES = new Set([
  "super_admin", "founder", "founder_office_coordinator",
  "founder_office_support", "hr_admin",
]);

const CATEGORY_OPTIONS = [
  "travel", "conveyance", "fuel", "food", "courier",
  "office_supplies", "internet_phone", "marketing",
  "professional_fees", "training", "software", "utility", "other",
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  travel: "Travel", conveyance: "Conveyance", fuel: "Fuel",
  food: "Food / meals", courier: "Courier",
  office_supplies: "Office supplies", internet_phone: "Internet / phone",
  marketing: "Marketing", professional_fees: "Professional fees",
  training: "Training", software: "Software", utility: "Utility",
  other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  submitted: "bg-warning/10 text-warning",
  approved: "bg-primary-soft text-primary",
  rejected: "bg-destructive/10 text-destructive",
  reimbursed: "bg-success/10 text-success",
};

export default function Expenses() {
  const { user, role } = useAuth();
  const { getUser, companies } = useDataStore();
  const isFinance = role ? FINANCE_ROLES.has(role) : false;

  const [rows, setRows] = useState<ExpenseClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "submitted" | "approved" | "reimbursed" | "rejected">(
    isFinance ? "submitted" : "all",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [detailFor, setDetailFor] = useState<ExpenseClaimRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.listExpenses(tab === "all" ? undefined : { status: tab }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [tab]);

  const stats = useMemo(() => {
    const mine = rows.filter((r) => r.user_id === user?.id);
    const pending = rows.filter((r) => r.status === "submitted").length;
    const approvedSum = rows
      .filter((r) => r.status === "approved")
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthSum = rows
      .filter((r) => r.expense_date.startsWith(thisMonth))
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    return {
      mineCount: mine.length,
      pending,
      approvedSum,
      monthSum,
    };
  }, [rows, user?.id]);

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Submit reimbursement claims with bills. Finance approves + pays back."
        icon={<Receipt className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Submit claim
          </Button>
        }
      />

      <div className="space-y-6 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="My claims" value={stats.mineCount} />
          <Stat label="Awaiting approval" value={stats.pending} tone="warning" />
          <Stat label="Approved (₹ to pay)" value={`₹${stats.approvedSum.toLocaleString("en-IN")}`} tone="primary" />
          <Stat label="This month total" value={`₹${stats.monthSum.toLocaleString("en-IN")}`} />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="submitted">Awaiting</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="reimbursed">Reimbursed</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
          {(["submitted", "approved", "reimbursed", "rejected", "all"] as const).map((s) => (
            <TabsContent key={s} value={s} className="mt-4">
              <List rows={rows} loading={loading} onPick={setDetailFor} />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {createOpen && (
        <SubmitDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(); }}
        />
      )}
      {detailFor && (
        <ClaimDetail
          claim={detailFor}
          isFinance={isFinance}
          onClose={() => setDetailFor(null)}
          onChanged={() => { setDetailFor(null); void load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "primary" | "warning" }) {
  const accent = tone === "primary" ? "text-primary" : tone === "warning" ? "text-warning" : "";
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function List({
  rows, loading, onPick,
}: { rows: ExpenseClaimRow[]; loading: boolean; onPick: (r: ExpenseClaimRow) => void }) {
  const { getUser } = useDataStore();
  if (loading) return <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      Nothing here.
    </div>
  );
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Claimant</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 font-medium">Description</th>
            <th className="px-4 py-2.5 font-medium text-right">Amount</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = getUser(r.user_id);
            return (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40"
                onClick={() => onPick(r)}
              >
                <td className="px-4 py-2.5 font-mono text-xs">{r.expense_date}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <UserAvatar userId={r.user_id} size="xs" />
                    <span className="text-xs">{u?.name ?? "—"}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                <td className="px-4 py-2.5">{r.description}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {r.currency} {Number(r.amount).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[r.status]}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Submit dialog ----------

function SubmitDialog({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
  const { user, role } = useAuth();
  const { companies, users } = useDataStore();
  const isFinance = role ? FINANCE_ROLES.has(role) : false;
  // "On behalf of" picker — only finance can change this; everyone
  // else has it pinned to themselves implicitly.
  const [claimantId, setClaimantId] = useState(user?.id ?? "");
  const claimant = useMemo(
    () => users.find((u) => u.id === claimantId),
    [users, claimantId],
  );
  const [companyId, setCompanyId] = useState(user?.homeCompanyId ?? companies[0]?.id ?? "");
  const [category, setCategory] = useState("travel");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Track the claim id after creation so the user can attach bills
  // before closing the dialog (otherwise they'd have to reopen the
  // detail panel to upload).
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Auto-default the billing entity to whoever the claim is for —
  // matters when HR files for someone in a different group company.
  useEffect(() => {
    if (claimant?.homeCompanyId) setCompanyId(claimant.homeCompanyId);
  }, [claimant?.homeCompanyId]);

  const submit = async () => {
    if (!description.trim()) return toast.error("Description is required");
    if (!amount || Number(amount) <= 0) return toast.error("Amount must be > 0");
    if (!expenseDate) return toast.error("Pick a date");
    setBusy(true);
    try {
      const created = await api.createExpense({
        // Only send user_id when filing on behalf — keeps the API
        // call simple for employees doing their own.
        user_id: isFinance && claimantId !== user?.id ? claimantId : null,
        company_id: companyId || null,
        category,
        description: description.trim(),
        amount: Number(amount),
        expense_date: expenseDate,
        notes: notes.trim() || null,
      });
      setCreatedId(created.id);
      toast.success(
        claimantId === user?.id
          ? "Claim submitted — attach bills below"
          : `Claim filed for ${claimant?.name ?? "employee"} — attach bills below`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't submit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && (createdId ? onCreated() : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Receipt className="h-4 w-4" /> {createdId ? "Attach bills" : "Submit claim"}</DialogTitle>
          {!createdId && <DialogDescription>You can attach bills after the first save.</DialogDescription>}
        </DialogHeader>
        {createdId ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your claim is saved. Drop bills below — finance will see them when they review.
            </p>
            <AttachmentList entityType="expense_claim" entityId={createdId} />
            <DialogFooter>
              <Button onClick={onCreated}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {isFinance && (
                <div>
                  <Label className="text-xs">Claimant (who's being reimbursed)</Label>
                  <Select value={claimantId} onValueChange={setClaimantId}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {user && (
                        <SelectItem value={user.id}>{user.name} (me)</SelectItem>
                      )}
                      {users
                        .filter((u) => u.isActive && u.id !== user?.id)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.name} · {u.designation}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Default is yourself. Pick a colleague to enter a reimbursement on their behalf.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Date *</Label>
                  <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="mt-1 h-9" />
                </div>
                <div>
                  <Label className="text-xs">Amount (₹) *</Label>
                  <Input type="number" step={0.01} min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
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
                  <Label className="text-xs">Bill to (entity)</Label>
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {companies.filter((c) => c.isActive).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Description *</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 h-9" placeholder="What was this for?" />
              </div>
              <div>
                <Label className="text-xs">Notes (optional)</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
                  placeholder="Anything finance should know"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Submit
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Detail / approval dialog ----------

function ClaimDetail({
  claim, isFinance, onClose, onChanged,
}: {
  claim: ExpenseClaimRow;
  isFinance: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { getUser } = useDataStore();
  const claimant = getUser(claim.user_id);
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showReimburse, setShowReimburse] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Expense claim
            <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[claim.status]}`}>
              {claim.status}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-surface-muted/30 p-3">
            <div className="flex items-center gap-2">
              {claimant && <UserAvatar userId={claimant.id} size="sm" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{claimant?.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {claim.expense_date} · {CATEGORY_LABEL[claim.category] ?? claim.category}
                  {claim.company_id && (
                    <span className="ml-1.5 inline-flex"><CompanyBadge companyId={claim.company_id} size="xs" /></span>
                  )}
                </p>
              </div>
              <p className="text-right font-mono text-lg font-semibold">
                {claim.currency} {Number(claim.amount).toLocaleString("en-IN")}
              </p>
            </div>
            <p className="mt-3 text-sm">{claim.description}</p>
            {claim.notes && <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{claim.notes}</p>}
            {claim.reject_reason && (
              <p className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mr-1 inline h-3 w-3" /> Rejected: {claim.reject_reason}
              </p>
            )}
            {claim.reimbursed_at && (
              <p className="mt-2 text-xs text-muted-foreground">
                Reimbursed {claim.reimbursed_at.slice(0, 16).replace("T", " ")}
                {claim.reimbursement_reference && ` · ref ${claim.reimbursement_reference}`}
                {claim.reimbursement_mode && ` · ${claim.reimbursement_mode}`}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground"><FileText className="mr-1 inline h-3 w-3" /> Bills / receipts</Label>
            <div className="mt-2">
              <AttachmentList entityType="expense_claim" entityId={claim.id} />
            </div>
          </div>
        </div>
        <DialogFooter>
          {isFinance && claim.status === "submitted" && (
            <>
              <Button variant="outline" onClick={() => setShowReject(true)} disabled={busy}>
                <X className="mr-1.5 h-4 w-4" /> Reject
              </Button>
              <Button onClick={() => void run(() => api.approveExpense(claim.id), "Approved")} disabled={busy}>
                <Check className="mr-1.5 h-4 w-4" /> Approve
              </Button>
            </>
          )}
          {isFinance && claim.status === "approved" && (
            <>
              <Button variant="outline" onClick={() => setShowReject(true)} disabled={busy}>
                <X className="mr-1.5 h-4 w-4" /> Reject
              </Button>
              <Button onClick={() => setShowReimburse(true)} disabled={busy}>
                <Wallet className="mr-1.5 h-4 w-4" /> Mark reimbursed
              </Button>
            </>
          )}
          {!isFinance || (claim.status !== "submitted" && claim.status !== "approved") ? (
            <Button variant="outline" onClick={onClose}>Close</Button>
          ) : null}
        </DialogFooter>

        {showReject && (
          <RejectDialog
            onClose={() => setShowReject(false)}
            onSubmit={(reason) => void run(() => api.rejectExpense(claim.id, reason), "Rejected")}
            busy={busy}
          />
        )}
        {showReimburse && (
          <ReimburseDialog
            onClose={() => setShowReimburse(false)}
            onSubmit={(payload) => void run(() => api.reimburseExpense(claim.id, payload), "Marked reimbursed")}
            busy={busy}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  onClose, onSubmit, busy,
}: { onClose: () => void; onSubmit: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject claim</DialogTitle>
        </DialogHeader>
        <Label className="text-xs">Reason (visible to claimant) *</Label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
          placeholder="Why is this being rejected?"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => reason.trim() && onSubmit(reason.trim())} disabled={busy || !reason.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReimburseDialog({
  onClose, onSubmit, busy,
}: {
  onClose: () => void;
  onSubmit: (payload: { reference?: string; mode?: string; notes?: string }) => void;
  busy: boolean;
}) {
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState<string>("bank_transfer");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark reimbursed</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Reference (txn id)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit_card">Credit card</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
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
          <Button onClick={() => onSubmit({
            reference: reference.trim() || undefined,
            mode: mode || undefined,
            notes: notes.trim() || undefined,
          })} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Mark reimbursed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
