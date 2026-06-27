import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { LeaveStatusBadge } from "@/components/StatusBadges";
import { UserAvatar } from "@/components/UserAvatar";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError, type LeaveBalanceRow, type LeavePolicyRow } from "@/lib/api";
import { Plane, Plus, RefreshCw, Settings as SettingsIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

// UI option key -> DB leave_type. 'comp_off_advance' collapses to
// 'comp_off' on the wire; the difference is encoded in the reason
// (see COMP_OFF_ADVANCE_PREFIX) so audit + reports can tell them apart.
const LEAVE_TYPE_DB: Record<string, string> = {
  casual: "casual_leave", sick: "sick_leave", loss_of_pay: "loss_of_pay",
  comp_off: "comp_off", comp_off_advance: "comp_off",
  optional_holiday: "optional_holiday",
};
const COMP_OFF_ADVANCE_PREFIX = "[Comp-off advance — repay later] ";

// Display label for a leave row in the lists. Distinguishes comp-off
// "advance" rows by sniffing the reason prefix the apply path writes,
// since the DB stores them as plain comp_off leaves.
function leaveRowLabel(t: string, reason?: string): string {
  if (t === "loss_of_pay") return "Unpaid leave";
  if (t === "comp_off") {
    return reason?.startsWith(COMP_OFF_ADVANCE_PREFIX)
      ? "Comp off (repay later)"
      : "Comp off";
  }
  if (t === "optional_holiday") return "Optional holiday";
  // casual / sick / wfh / earned / maternity / paternity — capitalize first letter.
  const s = t.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const BALANCED_TYPES = [
  "casual_leave", "sick_leave", "earned_leave",
  "maternity_leave", "paternity_leave", "comp_off",
] as const;
type BalancedType = typeof BALANCED_TYPES[number];
const LEAVE_TYPE_LABEL: Record<string, string> = {
  casual_leave: "Casual", sick_leave: "Sick", earned_leave: "Earned",
  maternity_leave: "Maternity", paternity_leave: "Paternity", comp_off: "Comp off",
};

export default function Leave() {
  const { user } = useAuth();
  const { leaveRequests, companies, getUser, refresh, attendance } = useDataStore();
  const [type, setType] = useState("casual");
  const [days, setDays] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  const myLeaves = leaveRequests.filter((l) => l.userId === user?.id);
  const isHR = user?.role === "hr_admin" || user?.role === "super_admin";

  // Balances ------------------------------------------------------------
  const [balances, setBalances] = useState<LeaveBalanceRow[]>([]);
  const [initializing, setInitializing] = useState(false);
  const loadBalances = async () => {
    try {
      setBalances(await api.listLeaveBalances());
    } catch {
      // Older deploys without the migration return 404; degrade gracefully.
      setBalances([]);
    }
  };
  useEffect(() => { void loadBalances(); }, [user?.id]);
  const balanceByType = useMemo(() => {
    const m = new Map<string, LeaveBalanceRow>();
    balances.forEach((b) => m.set(b.leave_type, b));
    return m;
  }, [balances]);
  const initializeBalances = async () => {
    setInitializing(true);
    try {
      const r = await api.initializeLeaveBalances();
      toast.success(`Initialized ${r.created} balance row${r.created === 1 ? "" : "s"} for ${r.year}`);
      void loadBalances();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't initialize");
    } finally {
      setInitializing(false);
    }
  };

  // Friendlier labels for stat cards. Order mirrors the typical
  // priority HR explains them: casual → sick → earned → comp_off.
  const BALANCE_DISPLAY: { type: string; label: string; accent: "primary" | "info" | "accent" | "warning" }[] = [
    { type: "casual_leave",    label: "Casual",       accent: "primary" },
    { type: "sick_leave",      label: "Sick",         accent: "info" },
    { type: "earned_leave",    label: "Earned",       accent: "accent" },
    { type: "comp_off",        label: "Comp off",     accent: "warning" },
  ];

  const [policyOpen, setPolicyOpen] = useState(false);

  const submit = async () => {
    if (!user || !from || !to) { toast.error("From and To dates required"); return; }
    const trimmed = reason.trim();
    const finalReason = type === "comp_off_advance"
      ? (COMP_OFF_ADVANCE_PREFIX + (trimmed || "—")).trim()
      : trimmed;
    try {
      await api.applyLeave({
        leave_type: LEAVE_TYPE_DB[type],
        start_date: from, end_date: to,
        days, reason: finalReason,
      });
      toast.success("Leave submitted");
      setFrom(""); setTo(""); setReason(""); refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to submit leave");
    }
  };

  const decide = async (id: string, status: "approved" | "rejected") => {
    if (!user) return;
    try {
      await api.updateLeave(id, { status });
      toast.success(`Leave ${status}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update leave");
    }
  };

  return (
    <div>
      <PageHeader
        title="Leave"
        description="Apply, track, and approve time off."
        icon={<Plane className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            {isHR && (
              <Button size="sm" variant="outline" onClick={() => setPolicyOpen(true)}>
                <SettingsIcon className="mr-1.5 h-4 w-4" /> Manage policies
              </Button>
            )}
            <Button size="sm" onClick={submit}><Plus className="h-4 w-4 mr-1.5" /> Apply leave</Button>
          </div>
        }
      />
      <div className="space-y-6 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          {BALANCE_DISPLAY.map((b) => {
            const row = balanceByType.get(b.type);
            // Comp-off can go negative (advance / IOU). Other types are
            // floored at 0 because going below means an accounting bug
            // we don't want to surface as "negative balance".
            const rawAvail = row ? row.available : 0;
            const isCompOff = b.type === "comp_off";
            const isOwed = isCompOff && rawAvail < 0;
            const display = isCompOff ? rawAvail : Math.max(0, rawAvail);
            const absDisplay = Math.abs(display);
            const valueStr = Number.isInteger(absDisplay)
              ? `${absDisplay}`
              : absDisplay.toFixed(1);

            // For comp-off, add a small "(+ X pending)" hint so the
            // employee knows what HR still has to approve.
            let hint: string | undefined;
            if (isCompOff && user) {
              const pending = attendance
                .filter((a) => a.userId === user.id && a.compOffStatus === "pending")
                .reduce((sum, a) => sum + (a.compOffEarned ?? 0), 0);
              if (pending > 0) {
                hint = `+ ${Number.isInteger(pending) ? pending : pending.toFixed(1)} pending HR approval`;
              }
            }
            return (
              <StatCard
                key={b.type}
                label={isOwed ? `${b.label} owed` : `${b.label} remaining`}
                value={isOwed ? `-${valueStr}` : valueStr}
                accent={isOwed ? "destructive" : b.accent}
                hint={hint}
              />
            );
          })}
        </div>
        {balances.length === 0 && isHR && (
          <div className="flex items-center justify-between rounded-xl border border-dashed border-border bg-surface p-4">
            <div>
              <p className="text-sm font-medium">No balances yet</p>
              <p className="text-xs text-muted-foreground">Click <b>Initialize balances</b> to seed every active employee's balance from the company's leave policies.</p>
            </div>
            <Button size="sm" onClick={initializeBalances} disabled={initializing}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${initializing ? "animate-spin" : ""}`} />
              Initialize balances
            </Button>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <h3 className="font-display text-sm font-semibold">Apply for leave</h3>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Leave type</label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="casual">Casual</SelectItem>
                      <SelectItem value="sick">Sick</SelectItem>
                      <SelectItem value="loss_of_pay">Unpaid leave</SelectItem>
                      <SelectItem value="comp_off">Comp off (already earned)</SelectItem>
                      <SelectItem value="comp_off_advance">Comp off (repay later)</SelectItem>
                      <SelectItem value="optional_holiday">Optional holiday</SelectItem>
                    </SelectContent>
                  </Select>
                  {type === "comp_off_advance" && (
                    <p className="mt-1 text-[11px] text-warning">
                      IOU — your comp-off balance will go negative. Settle it by working a future off-day.
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Working from home? Use the <b>WFH</b> option on the Attendance check-in
                    instead — WFH is a working state, not a leave.
                  </p>
                </div>
                <div><label className="text-xs text-muted-foreground">Days</label><Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 mt-1" /></div>
                <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 mt-1" /></div>
                <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 mt-1" /></div>
              </div>
              <div><label className="text-xs text-muted-foreground">Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" rows={3} /></div>
              <Button onClick={submit}>Submit request</Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface shadow-card">
            <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">My leave history</h3></div>
            <ul className="divide-y divide-border">
              {myLeaves.length === 0 && <p className="p-6 text-sm text-muted-foreground">No leaves yet.</p>}
              {myLeaves.map((l) => (
                <li key={l.id} className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{leaveRowLabel(l.type, l.reason)} · {l.days}d</p>
                    <p className="text-xs text-muted-foreground">{l.fromDate} → {l.toDate}</p>
                  </div>
                  <LeaveStatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {isHR && (
          <div className="rounded-xl border border-border bg-surface shadow-card">
            <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">HR approval queue</h3></div>
            <Tabs defaultValue="pending" className="p-4">
              <TabsList><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="approved">Approved</TabsTrigger><TabsTrigger value="rejected">Rejected</TabsTrigger></TabsList>
              {(["pending","approved","rejected"] as const).map((s) => (
                <TabsContent key={s} value={s}>
                  <ul className="divide-y divide-border">
                    {leaveRequests.filter((l) => l.status === s).map((l) => (
                      <li key={l.id} className="flex items-center gap-3 py-3">
                        <UserAvatar userId={l.userId} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{getUser(l.userId)?.name}</p>
                          <p className="text-xs text-muted-foreground">{leaveRowLabel(l.type, l.reason)} · {l.fromDate} → {l.toDate} · {l.reason}</p>
                        </div>
                        {s === "pending" && (<><Button size="sm" variant="outline" onClick={() => decide(l.id, "rejected")}>Reject</Button><Button size="sm" onClick={() => decide(l.id, "approved")}>Approve</Button></>)}
                      </li>
                    ))}
                  </ul>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </div>

      {isHR && (
        <LeavePolicyDialog
          open={policyOpen}
          onClose={() => setPolicyOpen(false)}
          companies={companies.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.shortName || c.name }))}
        />
      )}
    </div>
  );
}

// ---------- Leave policy editor (HR / super_admin only) ----------

function LeavePolicyDialog({
  open, onClose, companies,
}: {
  open: boolean;
  onClose: () => void;
  companies: { id: string; name: string }[];
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [policies, setPolicies] = useState<LeavePolicyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setPolicies(await api.listLeavePolicies());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void load();
      if (!companyId && companies.length) setCompanyId(companies[0].id);
    }
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  const rowsForCompany = useMemo(
    () => Object.fromEntries(
      policies.filter((p) => p.company_id === companyId).map((p) => [p.leave_type, p])
    ) as Record<string, LeavePolicyRow>,
    [policies, companyId],
  );

  const upsert = async (
    leaveType: string,
    field: "annual_quota" | "carry_forward_max" | "accrual_kind" | "is_paid",
    value: number | string | boolean,
  ) => {
    setSaving(true);
    try {
      const existing = rowsForCompany[leaveType];
      await api.upsertLeavePolicy(companyId, leaveType, {
        annual_quota: field === "annual_quota" ? Number(value) : Number(existing?.annual_quota ?? 0),
        carry_forward_max: field === "carry_forward_max" ? Number(value) : Number(existing?.carry_forward_max ?? 0),
        accrual_kind: (field === "accrual_kind" ? String(value) : existing?.accrual_kind ?? "upfront") as "upfront" | "monthly",
        is_paid: field === "is_paid" ? Boolean(value) : (existing?.is_paid ?? true),
        notes: existing?.notes ?? null,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><SettingsIcon className="h-4 w-4" /> Leave policies</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="h-9 max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Annual quota</th>
                  <th className="px-3 py-2 text-left font-medium">Carry-forward max</th>
                  <th className="px-3 py-2 text-left font-medium">Accrual</th>
                </tr>
              </thead>
              <tbody>
                {BALANCED_TYPES.map((t) => {
                  const row = rowsForCompany[t];
                  return (
                    <tr key={t} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{LEAVE_TYPE_LABEL[t]}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number" step={0.5} min={0} max={365}
                          defaultValue={row?.annual_quota ?? 0}
                          onBlur={(e) => {
                            const v = Number(e.target.value || 0);
                            if (v !== Number(row?.annual_quota ?? 0)) void upsert(t, "annual_quota", v);
                          }}
                          className="h-8 w-24"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number" step={0.5} min={0} max={365}
                          defaultValue={row?.carry_forward_max ?? 0}
                          onBlur={(e) => {
                            const v = Number(e.target.value || 0);
                            if (v !== Number(row?.carry_forward_max ?? 0)) void upsert(t, "carry_forward_max", v);
                          }}
                          className="h-8 w-24"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={row?.accrual_kind ?? "upfront"}
                          onValueChange={(v) => void upsert(t, "accrual_kind", v)}
                        >
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="upfront">Upfront (Jan 1)</SelectItem>
                            <SelectItem value="monthly">Monthly accrual</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Changes save on blur. Run <b>Initialize balances</b> on the Leave page after editing
            to apply quotas to existing employees.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
