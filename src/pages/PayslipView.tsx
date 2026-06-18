import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError, type PayslipRow } from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Printer, Pencil, Wallet, Check,
} from "lucide-react";

const MANAGE_ROLES = new Set([
  "super_admin", "founder", "founder_office_coordinator", "hr_admin",
]);

function inr(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function PayslipView() {
  const { id } = useParams<{ id: string }>();
  const { role } = useAuth();
  const { getUser, getCompany } = useDataStore();
  const navigate = useNavigate();
  const isManage = role ? MANAGE_ROLES.has(role) : false;

  const [ps, setPs] = useState<PayslipRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try { setPs(await api.getPayslip(id)); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);

  if (loading || !ps) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/salary")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "Payslip not found."}
        </p>
      </div>
    );
  }

  const employee = getUser(ps.user_id);
  const company = employee ? getCompany(employee.homeCompanyId) : null;

  return (
    <div>
      {/* Header bar — hidden when printing */}
      <div className="flex items-center gap-2 border-b border-border bg-surface p-3 print:hidden">
        <Button size="sm" variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        <span className="ml-2 text-sm font-medium">Payslip · {ps.period}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
          ps.status === "paid" ? "bg-success/10 text-success" :
          ps.status === "finalized" ? "bg-primary-soft text-primary" :
          "bg-warning/10 text-warning"
        }`}>{ps.status}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print / Save as PDF
          </Button>
          {isManage && ps.status !== "paid" && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* Printable payslip */}
      <div className="mx-auto max-w-3xl p-6 print:p-0">
        <div className="rounded-xl border border-border bg-surface p-8 shadow-card print:border-0 print:shadow-none">
          {/* Letterhead */}
          <div className="mb-6 flex items-start justify-between border-b border-border pb-4">
            <div>
              <h1 className="font-display text-xl font-semibold">{company?.name ?? "—"}</h1>
              <p className="text-xs text-muted-foreground">{company?.address ?? ""}</p>
              {company?.gstin && <p className="text-[11px] text-muted-foreground">GSTIN {company.gstin}</p>}
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Payslip</p>
              <p className="font-display text-lg">{ps.period}</p>
            </div>
          </div>

          {/* Employee info */}
          <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Employee</p>
              <p className="font-medium">{employee?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{employee?.designation}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="text-xs">{employee?.email ?? "—"}</p>
            </div>
          </div>

          {/* Earnings + Deductions side-by-side */}
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earnings</h3>
              <table className="w-full">
                <tbody>
                  <Row label="Basic" value={ps.basic} />
                  <Row label="HRA" value={ps.hra} />
                  <Row label="Conveyance" value={ps.conveyance} />
                  <Row label="Medical" value={ps.medical} />
                  <Row label="LTA" value={ps.lta} />
                  <Row label="Special allowance" value={ps.special_allowance} />
                  <Row label="Other" value={ps.other_earnings} />
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1.5">Gross earnings</td>
                    <td className="py-1.5 text-right font-mono">₹{inr(ps.gross_earnings)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deductions</h3>
              <table className="w-full">
                <tbody>
                  <Row label="PF (employee)" value={ps.pf_employee} />
                  <Row label="ESI (employee)" value={ps.esi_employee} />
                  <Row label="Professional tax" value={ps.pt_employee} />
                  <Row label="TDS" value={ps.tds} />
                  <Row label="Other" value={ps.other_deductions} />
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1.5">Total deductions</td>
                    <td className="py-1.5 text-right font-mono">₹{inr(ps.total_deductions)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Net pay banner */}
          <div className="mt-6 rounded-md bg-primary-soft p-4 text-center">
            <p className="text-[10px] uppercase tracking-wide text-primary">Net pay</p>
            <p className="font-display text-3xl font-semibold text-primary">₹{inr(ps.net_pay)}</p>
          </div>

          {/* Payment info */}
          {ps.status === "paid" && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Paid {ps.paid_at?.slice(0, 10)}
              {ps.payment_mode && ` · ${ps.payment_mode.replace("_", " ")}`}
              {ps.payment_reference && ` · ref ${ps.payment_reference}`}
            </p>
          )}

          {ps.notes && (
            <p className="mt-4 text-xs text-muted-foreground whitespace-pre-wrap">{ps.notes}</p>
          )}

          <p className="mt-6 border-t border-border pt-3 text-center text-[10px] text-muted-foreground">
            This is a system-generated payslip and does not require a signature.
          </p>
        </div>
      </div>

      {editing && isManage && (
        <EditPayslipDialog
          payslip={ps}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setPs(updated); setEditing(false); }}
        />
      )}

      {/* Print-only styles */}
      <style>{`
        @media print {
          body { background: white; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td className="py-1 text-muted-foreground">{label}</td>
      <td className="py-1 text-right font-mono">{Number(value || 0) ? `₹${inr(value)}` : "—"}</td>
    </tr>
  );
}

// ---------- Edit dialog ----------

function EditPayslipDialog({
  payslip, onClose, onSaved,
}: { payslip: PayslipRow; onClose: () => void; onSaved: (p: PayslipRow) => void }) {
  const [d, setD] = useState({
    basic: String(payslip.basic), hra: String(payslip.hra),
    conveyance: String(payslip.conveyance), medical: String(payslip.medical),
    lta: String(payslip.lta), special_allowance: String(payslip.special_allowance),
    other_earnings: String(payslip.other_earnings),
    pf_employee: String(payslip.pf_employee), esi_employee: String(payslip.esi_employee),
    pt_employee: String(payslip.pt_employee), tds: String(payslip.tds),
    other_deductions: String(payslip.other_deductions),
    notes: payslip.notes ?? "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const updated = await api.updatePayslip(payslip.id, {
        basic: Number(d.basic), hra: Number(d.hra),
        conveyance: Number(d.conveyance), medical: Number(d.medical),
        lta: Number(d.lta), special_allowance: Number(d.special_allowance),
        other_earnings: Number(d.other_earnings),
        pf_employee: Number(d.pf_employee), esi_employee: Number(d.esi_employee),
        pt_employee: Number(d.pt_employee), tds: Number(d.tds),
        other_deductions: Number(d.other_deductions),
        notes: d.notes,
      });
      toast.success("Saved");
      onSaved(updated);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const F = (k: keyof typeof d) => ({
    value: d[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 print:hidden">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface p-5 shadow-elevated">
        <h2 className="mb-3 font-display text-lg font-semibold">Edit payslip · {payslip.period}</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earnings</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Basic"><Input type="number" min={0} {...F("basic")} className="h-9" /></Field>
              <Field label="HRA"><Input type="number" min={0} {...F("hra")} className="h-9" /></Field>
              <Field label="Conveyance"><Input type="number" min={0} {...F("conveyance")} className="h-9" /></Field>
              <Field label="Medical"><Input type="number" min={0} {...F("medical")} className="h-9" /></Field>
              <Field label="LTA"><Input type="number" min={0} {...F("lta")} className="h-9" /></Field>
              <Field label="Special"><Input type="number" min={0} {...F("special_allowance")} className="h-9" /></Field>
              <Field label="Other"><Input type="number" min={0} {...F("other_earnings")} className="h-9" /></Field>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deductions</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="PF (employee)"><Input type="number" min={0} {...F("pf_employee")} className="h-9" /></Field>
              <Field label="ESI (employee)"><Input type="number" min={0} {...F("esi_employee")} className="h-9" /></Field>
              <Field label="PT"><Input type="number" min={0} {...F("pt_employee")} className="h-9" /></Field>
              <Field label="TDS"><Input type="number" min={0} {...F("tds")} className="h-9" /></Field>
              <Field label="Other"><Input type="number" min={0} {...F("other_deductions")} className="h-9" /></Field>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs">Notes</Label>
          <Input value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} className="mt-1 h-9" />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            <Check className="mr-1.5 h-4 w-4" /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
