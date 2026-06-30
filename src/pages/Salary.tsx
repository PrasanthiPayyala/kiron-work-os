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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import {
  api, ApiError,
  type SalaryStructureRow, type PayrollRunRow, type PayslipRow,
} from "@/lib/api";
import { toast } from "sonner";
import {
  IndianRupee, Plus, Loader2, CheckCircle2, Wallet, Trash2, Pencil, ExternalLink,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";

const MANAGE_ROLES = new Set([
  "super_admin", "founder", "founder_office_coordinator", "hr_admin",
]);

const STATUS_TONE: Record<string, string> = {
  draft: "bg-warning/10 text-warning",
  finalized: "bg-primary-soft text-primary",
  paid: "bg-success/10 text-success",
};

function inr(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  if (!v) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function Salary() {
  const { user, role } = useAuth();
  const isManage = role ? MANAGE_ROLES.has(role) : false;

  if (!isManage) return <EmployeeSelfView userId={user?.id ?? ""} />;
  return <ManageView />;
}

// ====== Employee read-only view ======

function EmployeeSelfView({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { setRows(await api.listPayslips()); }
      catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't load"); }
      finally { setLoading(false); }
    })();
  }, []);
  return (
    <div>
      <PageHeader
        title="My salary"
        description="Your past payslips. Use Print on the detail page to save as PDF."
        icon={<IndianRupee className="h-5 w-5" />}
      />
      <div className="space-y-4 p-6">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No payslips yet.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/salary/payslips/${p.id}`)}
              className="rounded-xl border border-border bg-surface p-4 text-left shadow-card hover:border-primary/30"
            >
              <p className="font-display text-lg font-semibold">{p.period}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Net pay
              </p>
              <p className="font-display text-2xl font-semibold">₹{inr(p.net_pay)}</p>
              <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[p.status]}`}>
                {p.status}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ====== Manage view (HR / founder / super_admin) ======

function ManageView() {
  const { companies, users, getUser } = useDataStore();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [structures, setStructures] = useState<SalaryStructureRow[]>([]);
  const [tab, setTab] = useState<"runs" | "structures">("runs");
  const [createRunOpen, setCreateRunOpen] = useState(false);
  const [createStructOpen, setCreateStructOpen] = useState(false);

  const load = async () => {
    try {
      const [r, s] = await Promise.all([api.listPayrollRuns(), api.listSalaryStructures()]);
      setRuns(r);
      setStructures(s);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load");
    }
  };
  useEffect(() => { void load(); }, []);

  // Index current structures by user for quick lookup.
  const currentByUser = useMemo(() => {
    const m = new Map<string, SalaryStructureRow>();
    structures.filter((s) => !s.effective_to).forEach((s) => m.set(s.user_id, s));
    return m;
  }, [structures]);

  return (
    <div>
      <PageHeader
        title="Salary & payroll"
        description="Set per-employee CTC, run monthly payroll, mark slips paid."
        icon={<IndianRupee className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreateStructOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Salary structure
            </Button>
            <Button size="sm" onClick={() => setCreateRunOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Payroll run
            </Button>
          </div>
        }
      />
      <div className="p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="runs">Payroll runs</TabsTrigger>
            <TabsTrigger value="structures">Salary structures</TabsTrigger>
          </TabsList>
          <TabsContent value="runs" className="mt-4 space-y-4">
            <RunsList runs={runs} onChanged={load} />
          </TabsContent>
          <TabsContent value="structures" className="mt-4">
            <StructuresList
              structures={structures}
              users={users}
              currentByUser={currentByUser}
              onChanged={load}
            />
          </TabsContent>
        </Tabs>
      </div>

      {createRunOpen && (
        <CreateRunDialog
          onClose={() => setCreateRunOpen(false)}
          onCreated={() => { setCreateRunOpen(false); void load(); }}
        />
      )}
      {createStructOpen && (
        <CreateStructureDialog
          onClose={() => setCreateStructOpen(false)}
          onSaved={() => { setCreateStructOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

// ---------- Runs list ----------

function RunsList({ runs, onChanged }: { runs: PayrollRunRow[]; onChanged: () => void }) {
  const { companies } = useDataStore();
  const [selected, setSelected] = useState<PayrollRunRow | null>(null);

  return (
    <>
      {runs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No payroll runs yet. Click <b>Payroll run</b> to create the first one — a draft is generated for every active employee in that company.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Period</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Notes</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40" onClick={() => setSelected(r)}>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.period}</td>
                  <td className="px-4 py-2.5"><CompanyBadge companyId={r.company_id} size="xs" /></td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.notes || ""}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground"><ExternalLink className="ml-auto h-3.5 w-3.5" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <RunDialog run={selected} onClose={() => setSelected(null)} onChanged={() => { onChanged(); }} />
      )}
    </>
  );
}

// ---------- Run dialog (payslips inside) ----------

function RunDialog({
  run, onClose, onChanged,
}: { run: PayrollRunRow; onClose: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const { getUser } = useDataStore();
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setPayslips(await api.listPayslips({ run_id: run.id })); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [run.id]);

  const totalGross = payslips.reduce((s, p) => s + Number(p.gross_earnings || 0), 0);
  const totalDeds = payslips.reduce((s, p) => s + Number(p.total_deductions || 0), 0);
  const totalNet = payslips.reduce((s, p) => s + Number(p.net_pay || 0), 0);

  const finalize = async () => {
    setBusy(true);
    try {
      await api.finalizePayrollRun(run.id);
      toast.success("Run finalized");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't finalize");
    } finally {
      setBusy(false);
    }
  };

  const deleteRun = async () => {
    if (!confirm("Delete this draft run? All draft payslips will go with it.")) return;
    setBusy(true);
    try {
      await api.deletePayrollRun(run.id);
      toast.success("Deleted");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-4 w-4" /> Payroll {run.period}
            <CompanyBadge companyId={run.company_id} size="xs" />
            <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[run.status]}`}>
              {run.status}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <Card label="Gross total" value={`₹${inr(totalGross)}`} />
          <Card label="Deductions" value={`₹${inr(totalDeds)}`} />
          <Card label="Net payable" value={`₹${inr(totalNet)}`} tone="text-primary" />
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Employee</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
                <th className="px-3 py-2 text-right font-medium">Deductions</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && payslips.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No payslips in this run.</td></tr>
              )}
              {payslips.map((p) => {
                const u = getUser(p.user_id);
                return (
                  <tr key={p.id} className="border-t border-border hover:bg-surface-muted/40">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <UserAvatar userId={p.user_id} size="xs" />
                        <span className="text-sm">{u?.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">₹{inr(p.gross_earnings)}</td>
                    <td className="px-3 py-2 text-right font-mono text-destructive">₹{inr(p.total_deductions)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">₹{inr(p.net_pay)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[p.status]}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/salary/payslips/${p.id}`)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2">
          {run.status === "draft" && (
            <>
              <Button variant="ghost" className="text-muted-foreground hover:text-destructive mr-auto" onClick={deleteRun} disabled={busy}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
              <Button onClick={finalize} disabled={busy || payslips.length === 0}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Finalize
              </Button>
            </>
          )}
          {run.status === "finalized" && (
            <Button onClick={() => setMarkPaidOpen(true)}>
              <Wallet className="mr-1 h-4 w-4" /> Mark run as paid
            </Button>
          )}
        </DialogFooter>

        {markPaidOpen && (
          <MarkPaidDialog
            title="Mark run as paid"
            onClose={() => setMarkPaidOpen(false)}
            onSubmit={async (payload) => {
              setBusy(true);
              try {
                await api.markPayrollRunPaid(run.id, payload);
                toast.success("Run marked paid");
                setMarkPaidOpen(false);
                onChanged();
                onClose();
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : "Couldn't update");
              } finally {
                setBusy(false);
              }
            }}
            busy={busy}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-display text-xl font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

// ---------- Structures ----------

function StructuresList({
  structures, users, currentByUser, onChanged,
}: {
  structures: SalaryStructureRow[];
  users: { id: string; name: string; isActive: boolean; designation: string }[];
  currentByUser: Map<string, SalaryStructureRow>;
  onChanged: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Employee</th>
            <th className="px-4 py-2.5 text-right font-medium">Gross / month</th>
            <th className="px-4 py-2.5 font-medium">Regime</th>
            <th className="px-4 py-2.5 font-medium">Effective from</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {users.filter((u) => u.isActive).map((u) => {
            const s = currentByUser.get(u.id);
            const gross = s
              ? Number(s.basic) + Number(s.hra) + Number(s.conveyance) + Number(s.medical)
                + Number(s.lta) + Number(s.special_allowance) + Number(s.other_earnings)
              : 0;
            return (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <UserAvatar userId={u.id} size="xs" />
                    <div>
                      <p className="text-sm">{u.name}</p>
                      <p className="text-[11px] text-muted-foreground">{u.designation}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {gross ? `₹${inr(gross)}` : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-2.5 text-xs uppercase">{s?.tds_regime ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs">{s?.effective_from ?? "—"}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                  {s ? "set" : "not set"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Create payroll run dialog ----------

function CreateRunDialog({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
  const { companies } = useDataStore();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!companyId) return toast.error("Pick a company");
    if (!/^\d{4}-\d{2}$/.test(period)) return toast.error("Period must be YYYY-MM");
    setBusy(true);
    try {
      const r = await api.createPayrollRun({ company_id: companyId, period, notes: notes.trim() || null });
      toast.success(`Run created — ${r.payslips_generated} draft payslip${r.payslips_generated === 1 ? "" : "s"} generated`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><IndianRupee className="h-4 w-4" /> New payroll run</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Company *</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {companies.filter((c) => c.isActive).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Period (YYYY-MM) *</Label>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 h-9" placeholder="2026-06" />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Drafts are generated using each active employee's current salary structure.
            Employees without a structure are skipped.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Create / update salary structure dialog ----------

function CreateStructureDialog({
  onClose, onSaved,
}: { onClose: () => void; onSaved: () => void }) {
  const { users, companies, ptSlabs } = useDataStore();
  const [userId, setUserId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [basic, setBasic] = useState("0");
  const [hra, setHra] = useState("0");
  const [conveyance, setConveyance] = useState("0");
  const [medical, setMedical] = useState("0");
  const [lta, setLta] = useState("0");
  const [specialAllowance, setSpecialAllowance] = useState("0");
  const [otherEarnings, setOtherEarnings] = useState("0");
  const [employerPf, setEmployerPf] = useState("0");
  const [employerEsi, setEmployerEsi] = useState("0");
  const [employerOther, setEmployerOther] = useState("0");
  const [tdsRegime, setTdsRegime] = useState<"old" | "new">("new");
  const [pfScheme, setPfScheme] = useState<"none" | "standard_12pct" | "capped_15000">("none");
  const [esiEligibility, setEsiEligibility] = useState<"auto" | "force_eligible" | "force_ineligible">("auto");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const total =
    Number(basic) + Number(hra) + Number(conveyance) + Number(medical) +
    Number(lta) + Number(specialAllowance) + Number(otherEarnings);

  // Live deduction preview — mirrors the backend helpers in salary.py so
  // HR can see exactly what the next payroll run will compute.
  const pfPreview = (() => {
    const b = Number(basic) || 0;
    if (pfScheme === "standard_12pct") return Math.round(b * 0.12 * 100) / 100;
    if (pfScheme === "capped_15000")   return Math.round(Math.min(b, 15000) * 0.12 * 100) / 100;
    return 0;
  })();
  const esiPreview = (() => {
    const g = total || 0;
    if (esiEligibility === "force_ineligible") return 0;
    if (esiEligibility === "force_eligible" || (esiEligibility === "auto" && g <= 21000)) {
      return Math.round(g * 0.0075 * 100) / 100;
    }
    return 0;
  })();
  // PT lookup: which company is this employee in? structure carries no
  // company; pull from the user's home company.
  const pickedUser = users.find((u) => u.id === userId);
  const company = pickedUser ? companies.find((c) => c.id === pickedUser.homeCompanyId) : undefined;
  const ptState = company?.profile?.ptState ?? null;
  const ptPreview = (() => {
    if (!ptState) return 0;
    const slab = ptSlabs
      .filter((s) => s.isActive && s.state === ptState
        && s.minGross <= total
        && (s.maxGross == null || s.maxGross > total))
      .sort((a, b) => b.minGross - a.minGross)[0];
    return slab?.amount ?? 0;
  })();

  const submit = async () => {
    if (!userId) return toast.error("Pick an employee");
    if (total <= 0) return toast.error("Enter at least one earnings component");
    setBusy(true);
    try {
      await api.createSalaryStructure({
        user_id: userId,
        effective_from: effectiveFrom,
        basic: Number(basic), hra: Number(hra),
        conveyance: Number(conveyance), medical: Number(medical),
        lta: Number(lta), special_allowance: Number(specialAllowance),
        other_earnings: Number(otherEarnings),
        employer_pf: Number(employerPf), employer_esi: Number(employerEsi),
        employer_other: Number(employerOther),
        tds_regime: tdsRegime,
        pf_scheme: pfScheme,
        esi_eligibility: esiEligibility,
        notes: notes.trim() || null,
      });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><IndianRupee className="h-4 w-4" /> Salary structure</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Employee *</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>
                  {users.filter((u) => u.isActive).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} · {u.designation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Effective from *</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="mt-1 h-9" />
            </div>
          </div>

          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Monthly earnings (₹)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Money label="Basic" value={basic} onChange={setBasic} />
            <Money label="HRA" value={hra} onChange={setHra} />
            <Money label="Conveyance" value={conveyance} onChange={setConveyance} />
            <Money label="Medical" value={medical} onChange={setMedical} />
            <Money label="LTA" value={lta} onChange={setLta} />
            <Money label="Special allowance" value={specialAllowance} onChange={setSpecialAllowance} />
            <Money label="Other earnings" value={otherEarnings} onChange={setOtherEarnings} />
            <div>
              <Label className="text-xs">Gross / month</Label>
              <p className="mt-1 font-mono text-sm font-semibold">₹{inr(total)}</p>
            </div>
          </div>

          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Statutory deductions (auto-computed each payroll run)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">PF scheme</Label>
              <Select value={pfScheme} onValueChange={(v) => setPfScheme(v as typeof pfScheme)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No PF (opted out)</SelectItem>
                  <SelectItem value="standard_12pct">Standard 12% on full basic</SelectItem>
                  <SelectItem value="capped_15000">Statutory cap (12% of min(basic, ₹15,000))</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {pfScheme === "none"
                  ? "No PF will be deducted."
                  : `Will deduct ₹${inr(pfPreview)} PF from each side (employee + employer).`}
              </p>
            </div>
            <div>
              <Label className="text-xs">ESI eligibility</Label>
              <Select value={esiEligibility} onValueChange={(v) => setEsiEligibility(v as typeof esiEligibility)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto by ₹21k gross rule</SelectItem>
                  <SelectItem value="force_eligible">Force eligible (always deduct)</SelectItem>
                  <SelectItem value="force_ineligible">Not eligible (never deduct)</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {esiPreview > 0
                  ? `Will deduct ₹${inr(esiPreview)} ESI (employee 0.75%).`
                  : esiEligibility === "auto" && total > 21000
                    ? "Gross above ₹21,000 — ESI auto-skipped."
                    : "No ESI will be deducted."}
              </p>
            </div>
          </div>

          {pickedUser && (
            <p className="text-[11px] text-muted-foreground">
              {ptState
                ? `Professional Tax (${ptState}): ₹${inr(ptPreview)} / month at this gross.`
                : "Professional Tax: company has no PT state set — no PT will deduct."}
            </p>
          )}

          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Employer contributions (CTC display only — separate from PF scheme above)</p>
          <div className="grid grid-cols-3 gap-3">
            <Money label="Employer PF" value={employerPf} onChange={setEmployerPf} />
            <Money label="Employer ESI" value={employerEsi} onChange={setEmployerEsi} />
            <Money label="Other employer" value={employerOther} onChange={setEmployerOther} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">TDS regime</Label>
              <Select value={tdsRegime} onValueChange={(v) => setTdsRegime(v as typeof tdsRegime)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New regime</SelectItem>
                  <SelectItem value="old">Old regime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 h-9" />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Saving creates a new version. The previous current row (if any) is closed automatically.
            PF / ESI / PT auto-compute when you next "Generate" a payroll run — HR can still override any cell on the draft payslip.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Money({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
    </div>
  );
}

// ---------- Mark paid (shared) ----------

function MarkPaidDialog({
  title, onClose, onSubmit, busy,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (payload: { payment_reference?: string; payment_mode?: string }) => void;
  busy: boolean;
}) {
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState("bank_transfer");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Reference (batch / txn id)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="neft">NEFT</SelectItem>
                <SelectItem value="rtgs">RTGS</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onSubmit({
            payment_reference: reference.trim() || undefined,
            payment_mode: mode || undefined,
          })} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
