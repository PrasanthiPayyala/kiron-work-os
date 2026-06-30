// PT Slabs editor for the Settings page. Lets HR / super_admin / founder
// maintain the Professional Tax slab table that the payroll-run generator
// uses to compute pt_employee per payslip. One row per (state, min_gross).
//
// Why a dedicated tab: PT rates differ by state and the state changes
// them every few years (AP/TG last revised the slab thresholds in 2025).
// Karunya needs a place to confirm and update without DB access.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useDataStore } from "@/lib/dataStore";
import { mapPtSlab } from "@/lib/mappers";
import type { PtSlab } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Draft = { state: string; min_gross: string; max_gross: string; amount: string };

const blankDraft = (): Draft => ({ state: "", min_gross: "", max_gross: "", amount: "" });

const inr = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export function PtSlabsTab() {
  const { ptSlabs: cachedSlabs, refresh } = useDataStore();
  // Live-fetch on mount so deactivated slabs surface (bootstrap only ships
  // active ones). Falls back to cached on error so the tab still renders.
  const [slabs, setSlabs] = useState<PtSlab[]>(cachedSlabs);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.listPtSlabs();
      setSlabs(rows.map(mapPtSlab));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load PT slabs");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const addSlab = async () => {
    if (!draft.state.trim()) return toast.error("State code is required (e.g. AP, TG)");
    const min = Number(draft.min_gross);
    if (Number.isNaN(min) || min < 0) return toast.error("min_gross must be >= 0");
    const max = draft.max_gross.trim() === "" ? null : Number(draft.max_gross);
    if (max !== null && (Number.isNaN(max) || max <= min)) {
      return toast.error("max_gross must be greater than min_gross (or blank for top slab)");
    }
    const amount = Number(draft.amount);
    if (Number.isNaN(amount) || amount < 0) return toast.error("amount must be >= 0");
    setAdding(true);
    try {
      await api.createPtSlab({
        state: draft.state.trim().toUpperCase(),
        min_gross: min,
        max_gross: max,
        amount,
      });
      toast.success("Slab added");
      setDraft(blankDraft());
      await load();
      void refresh();   // rehydrate dataStore so other screens see the new slab
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't add slab");
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (slab: PtSlab) => {
    try {
      await api.updatePtSlab(slab.id, { is_active: !slab.isActive });
      await load();
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update");
    }
  };

  const remove = async (slab: PtSlab) => {
    if (!confirm(`Deactivate ${slab.state} ₹${inr(slab.minGross)}+ slab?`)) return;
    try {
      await api.deactivatePtSlab(slab.id);
      await load();
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't deactivate");
    }
  };

  const grouped = slabs.reduce<Record<string, PtSlab[]>>((acc, s) => {
    (acc[s.state] ||= []).push(s);
    return acc;
  }, {});
  const states = Object.keys(grouped).sort();

  return (
    <div>
      <div className="border-b border-border p-4">
        <h3 className="font-display text-sm font-semibold">Professional Tax slabs</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          One row per (state, min gross). The payroll-run generator picks the
          first matching slab when computing pt_employee. Mark a slab inactive
          (or delete) when a state revises rates — history stays in the DB.
        </p>
      </div>

      <div className="p-4">
        {loading && slabs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : slabs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PT slabs configured yet.</p>
        ) : (
          <div className="space-y-4">
            {states.map((state) => (
              <div key={state} className="overflow-hidden rounded-md border border-border">
                <div className="border-b border-border bg-surface-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {state}
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Min gross (₹)</th>
                      <th className="px-3 py-2 text-left font-medium">Max gross (₹)</th>
                      <th className="px-3 py-2 text-right font-medium">Amount / month (₹)</th>
                      <th className="px-3 py-2 text-center font-medium">Active</th>
                      <th className="px-3 py-2 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[state]
                      .slice()
                      .sort((a, b) => a.minGross - b.minGross)
                      .map((s) => (
                        <tr key={s.id} className="border-t border-border">
                          <td className="px-3 py-2 tabular-nums">{inr(s.minGross)}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {s.maxGross == null ? "and above" : inr(s.maxGross)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">₹{inr(s.amount)}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={s.isActive}
                              onChange={() => void toggle(s)}
                              className="h-3.5 w-3.5"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => void remove(s)}>
                              <Trash2 className="h-3 w-3" /> Deactivate
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-md border border-dashed border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add a slab</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div>
              <Label htmlFor="pt-state" className="text-xs">State code</Label>
              <Input id="pt-state" maxLength={8} placeholder="AP" value={draft.state}
                     onChange={(e) => setDraft({ ...draft, state: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label htmlFor="pt-min" className="text-xs">Min gross (₹)</Label>
              <Input id="pt-min" inputMode="numeric" placeholder="0" value={draft.min_gross}
                     onChange={(e) => setDraft({ ...draft, min_gross: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pt-max" className="text-xs">Max gross (₹, blank = top)</Label>
              <Input id="pt-max" inputMode="numeric" placeholder="" value={draft.max_gross}
                     onChange={(e) => setDraft({ ...draft, max_gross: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pt-amt" className="text-xs">Amount (₹/mo)</Label>
              <Input id="pt-amt" inputMode="numeric" placeholder="200" value={draft.amount}
                     onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </div>
            <div className="flex items-end">
              <Button onClick={addSlab} disabled={adding} className="w-full gap-1.5">
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add slab
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
