// Bank accounts management for the company edit dialog. Inline list +
// add/edit form. Finance-scoped — only renders for users who pass
// can.editCompanyFinance (HR sees nothing here).
//
// Loads on mount, then the section keeps its own list in state. Add /
// Edit / Delete hit the API and refetch.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { CompanyBankAccount } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Star } from "lucide-react";

function mapAccount(r: any): CompanyBankAccount {
  return {
    id: r.id,
    companyId: r.company_id,
    bankName: r.bank_name,
    accountNumber: r.account_number,
    ifsc: r.ifsc ?? null,
    branch: r.branch ?? null,
    accountType: r.account_type ?? null,
    isPrimary: !!r.is_primary,
    notes: r.notes ?? null,
  };
}

type Draft = {
  bank_name: string;
  account_number: string;
  ifsc: string;
  branch: string;
  account_type: string;
  is_primary: boolean;
  notes: string;
};

const blankDraft = (): Draft => ({
  bank_name: "", account_number: "", ifsc: "", branch: "",
  account_type: "current", is_primary: false, notes: "",
});

const fromAccount = (a: CompanyBankAccount): Draft => ({
  bank_name: a.bankName,
  account_number: a.accountNumber,
  ifsc: a.ifsc ?? "",
  branch: a.branch ?? "",
  account_type: a.accountType ?? "current",
  is_primary: a.isPrimary,
  notes: a.notes ?? "",
});

export function BankAccountsSection({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<CompanyBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = await api.listBankAccounts(companyId);
      setAccounts(rows.map(mapAccount));
    } catch (e) {
      toast({
        title: "Couldn't load bank accounts",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [companyId]);

  const openCreate = () => {
    setDraft(blankDraft());
    setEditingId("new");
  };
  const openEdit = (a: CompanyBankAccount) => {
    setDraft(fromAccount(a));
    setEditingId(a.id);
  };
  const cancel = () => {
    setEditingId(null);
    setDraft(blankDraft());
  };

  const save = async () => {
    if (!draft.bank_name.trim() || !draft.account_number.trim()) {
      toast({ title: "Bank name and account number are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        bank_name: draft.bank_name.trim(),
        account_number: draft.account_number.trim(),
        ifsc: draft.ifsc.trim() || null,
        branch: draft.branch.trim() || null,
        account_type: draft.account_type.trim() || null,
        is_primary: draft.is_primary,
        notes: draft.notes.trim() || null,
      };
      if (editingId === "new") {
        await api.createBankAccount(companyId, payload);
        toast({ title: "Bank account added", description: payload.bank_name });
      } else if (editingId) {
        await api.updateBankAccount(editingId, payload);
        toast({ title: "Bank account updated", description: payload.bank_name });
      }
      cancel();
      await refresh();
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: CompanyBankAccount) => {
    if (!confirm(`Delete ${a.bankName} account ${a.accountNumber}?`)) return;
    setBusy(true);
    try {
      await api.deleteBankAccount(a.id);
      toast({ title: "Bank account deleted" });
      await refresh();
    } catch (e) {
      toast({
        title: "Couldn't delete",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">Bank accounts</Label>
          <p className="text-[11px] text-muted-foreground">
            One row per account. Mark one as Primary — used as the default for invoices and payroll.
          </p>
        </div>
        {editingId === null && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Add bank account
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-xs italic text-muted-foreground">Loading…</p>
      ) : accounts.length === 0 && editingId !== "new" ? (
        <p className="text-xs italic text-muted-foreground">No bank accounts added yet.</p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => editingId === a.id ? (
            <li key={a.id}><DraftRow draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} busy={busy} /></li>
          ) : (
            <li key={a.id} className="rounded-md border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{a.bankName}</p>
                  {a.isPrimary && <Badge variant="secondary" className="gap-1 text-[10px]"><Star className="h-2.5 w-2.5" />Primary</Badge>}
                  {a.accountType && <Badge variant="outline" className="text-[10px]">{a.accountType}</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => openEdit(a)} disabled={busy}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => void remove(a)} disabled={busy}>
                    <Trash2 className="h-3 w-3" /> Delete
                  </Button>
                </div>
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {a.accountNumber}{a.ifsc ? ` · IFSC ${a.ifsc}` : ""}{a.branch ? ` · ${a.branch}` : ""}
              </p>
              {a.notes && <p className="mt-1 text-xs text-muted-foreground">{a.notes}</p>}
            </li>
          ))}
          {editingId === "new" && (
            <li><DraftRow draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} busy={busy} /></li>
          )}
        </ul>
      )}
    </div>
  );
}

function DraftRow({
  draft, setDraft, onSave, onCancel, busy,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="ba-bank" className="text-xs">Bank *</Label>
          <Input id="ba-bank" value={draft.bank_name} onChange={(e) => set("bank_name", e.target.value)} placeholder="HDFC Bank" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ba-acct" className="text-xs">Account number *</Label>
          <Input id="ba-acct" value={draft.account_number} onChange={(e) => set("account_number", e.target.value)} placeholder="50100…" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ba-ifsc" className="text-xs">IFSC</Label>
          <Input id="ba-ifsc" value={draft.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase())} placeholder="HDFC0001234" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ba-branch" className="text-xs">Branch</Label>
          <Input id="ba-branch" value={draft.branch} onChange={(e) => set("branch", e.target.value)} placeholder="Banjara Hills" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ba-type" className="text-xs">Account type</Label>
          <Input id="ba-type" value={draft.account_type} onChange={(e) => set("account_type", e.target.value)} placeholder="current / savings / OD" />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <input
            id="ba-primary"
            type="checkbox"
            className="h-4 w-4"
            checked={draft.is_primary}
            onChange={(e) => set("is_primary", e.target.checked)}
          />
          <Label htmlFor="ba-primary" className="text-xs font-normal">Primary account</Label>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ba-notes" className="text-xs">Notes</Label>
        <Textarea id="ba-notes" rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="RM name, special instructions, etc." />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="button" size="sm" onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save bank account"}
        </Button>
      </div>
    </div>
  );
}
