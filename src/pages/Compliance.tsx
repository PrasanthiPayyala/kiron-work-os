import { useEffect, useMemo, useState } from "react";
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
  api, ApiError,
  type ComplianceObligationRow, type ComplianceOccurrenceRow,
} from "@/lib/api";
import { toast } from "sonner";
import {
  Scale, Plus, Loader2, AlertTriangle, CheckCircle2, Clock,
  Settings as SettingsIcon, RefreshCw, X,
} from "lucide-react";
import { CompanyBadge } from "@/components/CompanyBadge";
import { UserAvatar } from "@/components/UserAvatar";

// Common Indian filings — picked from a dropdown when creating an
// obligation. Free-form "other" stays available.
const COMMON_KINDS = [
  { kind: "gstr_3b",          name: "GSTR-3B monthly",         cadence: "monthly",   due_day: 20, dmo: 1 },
  { kind: "gstr_1",           name: "GSTR-1 monthly",          cadence: "monthly",   due_day: 11, dmo: 1 },
  { kind: "tds_payment",      name: "TDS payment",             cadence: "monthly",   due_day: 7,  dmo: 1 },
  { kind: "tds_return",       name: "TDS quarterly return",    cadence: "quarterly", due_day: 31, dmo: 1 },
  { kind: "pf",               name: "PF deposit",              cadence: "monthly",   due_day: 15, dmo: 1 },
  { kind: "esi",              name: "ESI deposit",             cadence: "monthly",   due_day: 15, dmo: 1 },
  { kind: "pt_employee",      name: "Professional tax (employee)", cadence: "monthly", due_day: 10, dmo: 1 },
  { kind: "pt_employer",      name: "Professional tax (employer)", cadence: "yearly",  due_day: 30, dmo: 0 },
  { kind: "roc_annual",       name: "ROC annual filing",       cadence: "yearly",    due_day: 30, dmo: 6 },
  { kind: "advance_tax",      name: "Advance tax",             cadence: "quarterly", due_day: 15, dmo: 0 },
  { kind: "income_tax_return",name: "Income tax return",       cadence: "yearly",    due_day: 31, dmo: 4 },
];

const STATUS_TONE: Record<string, string> = {
  pending: "text-warning",
  filed: "text-success",
  skipped: "text-muted-foreground",
};

export default function Compliance() {
  const { role } = useAuth();
  const { companies, getUser } = useDataStore();
  const canManage = role && [
    "super_admin", "founder", "founder_office_coordinator",
    "founder_office_support", "hr_admin",
  ].includes(role);

  const [occurrences, setOccurrences] = useState<ComplianceOccurrenceRow[]>([]);
  const [obligations, setObligations] = useState<ComplianceObligationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [fileTarget, setFileTarget] = useState<ComplianceOccurrenceRow | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [occ, obs] = await Promise.all([
        api.listComplianceOccurrences({
          company_id: companyFilter === "all" ? undefined : companyFilter,
        }),
        api.listComplianceObligations(),
      ]);
      setOccurrences(occ);
      setObligations(obs);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [companyFilter]);

  const today = new Date().toISOString().slice(0, 10);

  const overdue = useMemo(
    () => occurrences.filter((o) => o.status === "pending" && o.due_date < today)
                     .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [occurrences, today],
  );
  const upcoming = useMemo(
    () => occurrences.filter((o) => o.status === "pending" && o.due_date >= today)
                     .sort((a, b) => a.due_date.localeCompare(b.due_date))
                     .slice(0, 60),
    [occurrences, today],
  );
  const filed = useMemo(
    () => occurrences.filter((o) => o.status === "filed")
                     .sort((a, b) => (b.filed_at ?? "").localeCompare(a.filed_at ?? ""))
                     .slice(0, 50),
    [occurrences],
  );

  const runGenerate = async () => {
    setGenerating(true);
    try {
      const r = await api.generateComplianceOccurrences();
      toast.success(`Generated ${r.created} new occurrence${r.created === 1 ? "" : "s"}`);
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't generate");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Compliance"
        description="GST, PF, ESI, TDS, PT, ROC — per entity, on the clock."
        icon={<Scale className="h-5 w-5" />}
        actions={
          canManage && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
                <SettingsIcon className="mr-1.5 h-4 w-4" /> Templates
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runGenerate()} disabled={generating}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${generating ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Add filing
              </Button>
            </div>
          )
        }
      />

      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Label className="text-xs text-muted-foreground">Company:</Label>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="h-9 max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.filter((c) => c.isActive).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {!loading && occurrences.length === 0 && obligations.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No compliance templates yet. Click <b>Add filing</b> to set one up
            (e.g. GSTR-3B for one of your entities) — occurrences will auto-generate
            for the next 120 days.
          </div>
        )}

        {/* Overdue */}
        {overdue.length > 0 && (
          <Section
            title="Overdue"
            icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
            tone="border-destructive/30 bg-destructive/5"
            count={overdue.length}
          >
            <OccurrenceList rows={overdue} canManage={!!canManage} onAction={() => void load()} setFileTarget={setFileTarget} getUser={getUser} today={today} />
          </Section>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <Section
            title="Upcoming"
            icon={<Clock className="h-4 w-4 text-warning" />}
            tone="border-warning/30 bg-warning/5"
            count={upcoming.length}
          >
            <OccurrenceList rows={upcoming} canManage={!!canManage} onAction={() => void load()} setFileTarget={setFileTarget} getUser={getUser} today={today} />
          </Section>
        )}

        {/* Filed (recent) */}
        {filed.length > 0 && (
          <Section
            title="Recently filed"
            icon={<CheckCircle2 className="h-4 w-4 text-success" />}
            tone="border-success/20 bg-success/5"
            count={filed.length}
          >
            <OccurrenceList rows={filed} canManage={!!canManage} onAction={() => void load()} setFileTarget={setFileTarget} getUser={getUser} today={today} />
          </Section>
        )}
      </div>

      {createOpen && (
        <CreateObligationDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(); }}
        />
      )}
      {manageOpen && (
        <ManageObligationsDialog
          obligations={obligations}
          onClose={() => setManageOpen(false)}
          onChanged={() => void load()}
        />
      )}
      {fileTarget && (
        <FileDialog
          occurrence={fileTarget}
          onClose={() => setFileTarget(null)}
          onFiled={() => { setFileTarget(null); void load(); }}
        />
      )}
    </div>
  );
}

function Section({
  title, icon, tone, count, children,
}: { title: string; icon: React.ReactNode; tone: string; count: number; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 shadow-card ${tone}`}>
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        {icon} {title} <span className="text-muted-foreground">· {count}</span>
      </h3>
      {children}
    </div>
  );
}

function OccurrenceList({
  rows, canManage, onAction, setFileTarget, getUser, today,
}: {
  rows: ComplianceOccurrenceRow[];
  canManage: boolean;
  onAction: () => void;
  setFileTarget: (o: ComplianceOccurrenceRow) => void;
  getUser: (id?: string) => { id: string; name: string } | undefined;
  today: string;
}) {
  return (
    <ul className="space-y-2">
      {rows.map((o) => {
        const days = Math.round((new Date(o.due_date).getTime() - new Date(today).getTime()) / 86400000);
        const assignee = o.assigned_to_user_id ? getUser(o.assigned_to_user_id) : null;
        return (
          <li key={o.id} className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{o.obligation_name}</p>
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {o.period_label}
                </span>
                {o.company_id && <CompanyBadge companyId={o.company_id} size="xs" />}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className={STATUS_TONE[o.status]}>
                  {o.status === "pending"
                    ? (days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `Due in ${days}d`)
                    : o.status === "filed"
                      ? `Filed${o.filed_at ? ` ${o.filed_at.slice(0, 10)}` : ""}${o.reference ? ` · ${o.reference}` : ""}`
                      : "Skipped"}
                </span>
                <span>· due {o.due_date}</span>
                {assignee && (
                  <span className="inline-flex items-center gap-1">
                    · <UserAvatar userId={assignee.id} size="xs" /> {assignee.name}
                  </span>
                )}
              </div>
            </div>
            {canManage && o.status === "pending" && (
              <>
                <Button size="sm" onClick={() => setFileTarget(o)}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark filed
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={async () => {
                  try { await api.skipComplianceOccurrence(o.id); onAction(); }
                  catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't skip"); }
                }}>
                  Skip
                </Button>
              </>
            )}
            {canManage && o.status !== "pending" && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={async () => {
                try { await api.reopenComplianceOccurrence(o.id); onAction(); }
                catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't reopen"); }
              }}>
                Reopen
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Create obligation dialog ----------

function CreateObligationDialog({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
  const { companies, users } = useDataStore();
  const [template, setTemplate] = useState<string>(COMMON_KINDS[0].kind);
  const [kind, setKind] = useState(COMMON_KINDS[0].kind);
  const [name, setName] = useState(COMMON_KINDS[0].name);
  const [cadence, setCadence] = useState(COMMON_KINDS[0].cadence);
  const [dueDay, setDueDay] = useState(COMMON_KINDS[0].due_day);
  const [dmo, setDmo] = useState(COMMON_KINDS[0].dmo);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [assignee, setAssignee] = useState<string>("__none__");
  const [reminderDays, setReminderDays] = useState(7);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const useTemplate = (kindKey: string) => {
    setTemplate(kindKey);
    const t = COMMON_KINDS.find((x) => x.kind === kindKey);
    if (t) {
      setKind(t.kind);
      setName(t.name);
      setCadence(t.cadence);
      setDueDay(t.due_day);
      setDmo(t.dmo);
    } else {
      // "custom" — leave fields editable
    }
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Name is required");
    if (!companyId) return toast.error("Pick a company");
    setBusy(true);
    try {
      await api.createComplianceObligation({
        company_id: companyId,
        kind,
        name: name.trim(),
        cadence: cadence as any,
        due_day: dueDay,
        due_month_offset: dmo,
        assigned_to_user_id: assignee === "__none__" ? null : assignee,
        reminder_days_before: reminderDays,
        notes: notes.trim() || null,
      });
      toast.success("Filing added — occurrences generated for next 120 days");
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't add");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Scale className="h-4 w-4" /> Add compliance filing</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Common templates (auto-fills the fields below)</Label>
            <Select value={template} onValueChange={useTemplate}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMMON_KINDS.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.name}</SelectItem>)}
                <SelectItem value="custom">Custom (fill in below)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Kind (machine key)</Label>
              <Input value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 h-9" placeholder="e.g. gstr_3b" />
            </div>
            <div>
              <Label className="text-xs">Display name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Company *</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>
                  {companies.filter((c) => c.isActive).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cadence</Label>
              <Select value={cadence} onValueChange={setCadence}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="half_yearly">Half-yearly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Due day of month</Label>
              <Input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Months after period-end</Label>
              <Input type="number" min={0} max={12} value={dmo} onChange={(e) => setDmo(Math.max(0, Math.min(12, Number(e.target.value) || 0)))} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Assigned to (the CA / staff)</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— unassigned —</SelectItem>
                  {users.filter((u) => u.isActive).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reminder (days before due)</Label>
              <Input type="number" min={0} max={60} value={reminderDays} onChange={(e) => setReminderDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} className="mt-1 h-9" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="e.g. portal URL, what to do if interest applies"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- File dialog ----------

function FileDialog({
  occurrence, onClose, onFiled,
}: { occurrence: ComplianceOccurrenceRow; onClose: () => void; onFiled: () => void }) {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.fileComplianceOccurrence(occurrence.id, {
        reference: reference.trim() || undefined,
        amount: amount ? Number(amount) : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success("Marked filed");
      onFiled();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> Mark filed</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {occurrence.obligation_name} · {occurrence.period_label} · due {occurrence.due_date}
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Reference (acknowledgement no.)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Amount paid (optional)</Label>
              <Input type="number" step={0.01} min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
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
            Mark filed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Manage obligations dialog ----------

function ManageObligationsDialog({
  obligations, onClose, onChanged,
}: { obligations: ComplianceObligationRow[]; onClose: () => void; onChanged: () => void }) {
  const { companies, getUser } = useDataStore();

  const remove = async (id: string) => {
    if (!confirm("Delete this filing template? All its future occurrences will go with it.")) return;
    try {
      await api.deleteComplianceObligation(id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    }
  };

  const toggle = async (ob: ComplianceObligationRow) => {
    try {
      await api.updateComplianceObligation(ob.id, { is_active: !ob.is_active });
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><SettingsIcon className="h-4 w-4" /> Compliance templates</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Each template generates occurrences for the next 120 days. Deactivate one to stop new occurrences.
        </p>
        {obligations.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No templates yet.</p>
        ) : (
          <ul className="space-y-2">
            {obligations.map((o) => {
              const co = companies.find((c) => c.id === o.company_id);
              const u = o.assigned_to_user_id ? getUser(o.assigned_to_user_id) : null;
              return (
                <li key={o.id} className={`flex items-center gap-3 rounded-md border border-border p-3 ${!o.is_active ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{o.name}</p>
                      <span className="text-[11px] text-muted-foreground">{o.cadence} · due day {o.due_day} (+{o.due_month_offset}m)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {co?.shortName ?? co?.name}{u ? ` · assigned to ${u.name}` : ""} · remind {o.reminder_days_before}d before
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void toggle(o)}>
                    {o.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <button
                    onClick={() => void remove(o.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
