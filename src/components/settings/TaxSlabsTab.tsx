// Income tax slabs + per-regime config (standard deduction / 87A rebate
// / cess) editor for Settings. Drives the auto-TDS computation in the
// payroll-run draft generator.
//
// Why a dedicated tab: slabs and the supporting constants change every
// Union Budget. Karunya needs a place to update the table without
// touching code or DB.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useDataStore } from "@/lib/dataStore";
import { mapTaxSlab, mapTaxRegimeConfig } from "@/lib/mappers";
import type { TaxSlab, TaxRegimeConfig, TaxRegime } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type SlabDraft = { regime: TaxRegime; fy_label: string; min_income: string; max_income: string; rate_pct: string };
type CfgDraft = { regime: TaxRegime; fy_label: string; standard_deduction: string; rebate_threshold: string; cess_pct: string };

const inr = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const blankSlab = (): SlabDraft => ({ regime: "new", fy_label: "FY 2025-26", min_income: "", max_income: "", rate_pct: "" });
const blankCfg = (): CfgDraft => ({ regime: "new", fy_label: "FY 2025-26", standard_deduction: "75000", rebate_threshold: "1200000", cess_pct: "4" });

export function TaxSlabsTab() {
  const { taxSlabs: cachedSlabs, taxRegimeConfigs: cachedCfgs, refresh } = useDataStore();
  const [slabs, setSlabs] = useState<TaxSlab[]>(cachedSlabs);
  const [cfgs, setCfgs] = useState<TaxRegimeConfig[]>(cachedCfgs);
  const [loading, setLoading] = useState(false);
  const [slabDraft, setSlabDraft] = useState<SlabDraft>(blankSlab);
  const [cfgDraft, setCfgDraft] = useState<CfgDraft>(blankCfg);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [sRows, cRows] = await Promise.all([
        api.listTaxSlabs(),
        api.listTaxRegimeConfigs(),
      ]);
      setSlabs(sRows.map(mapTaxSlab));
      setCfgs(cRows.map(mapTaxRegimeConfig));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load tax slabs");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  // Group slabs by (fy_label, regime) for display.
  const grouped = useMemo(() => {
    const out: Record<string, Record<TaxRegime, TaxSlab[]>> = {};
    for (const s of slabs) {
      const fy = (out[s.fyLabel] ||= { new: [], old: [] });
      fy[s.regime].push(s);
    }
    for (const fy of Object.values(out)) {
      fy.new.sort((a, b) => a.minIncome - b.minIncome);
      fy.old.sort((a, b) => a.minIncome - b.minIncome);
    }
    return out;
  }, [slabs]);
  const cfgByKey = useMemo(() => {
    const m: Record<string, TaxRegimeConfig> = {};
    for (const c of cfgs) m[`${c.fyLabel}|${c.regime}`] = c;
    return m;
  }, [cfgs]);

  const fyLabels = useMemo(
    () => Object.keys(grouped).sort().reverse(),
    [grouped],
  );

  const addSlab = async () => {
    if (!slabDraft.fy_label.trim()) return toast.error("FY label required");
    const min = Number(slabDraft.min_income);
    if (Number.isNaN(min) || min < 0) return toast.error("min_income must be >= 0");
    const max = slabDraft.max_income.trim() === "" ? null : Number(slabDraft.max_income);
    if (max !== null && (Number.isNaN(max) || max <= min)) {
      return toast.error("max_income must be greater than min_income (or blank for top slab)");
    }
    const rate = Number(slabDraft.rate_pct);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) return toast.error("rate_pct must be 0-100");
    setAdding(true);
    try {
      await api.createTaxSlab({
        regime: slabDraft.regime,
        fy_label: slabDraft.fy_label.trim(),
        min_income: min,
        max_income: max,
        rate_pct: rate,
      });
      toast.success("Slab added");
      setSlabDraft({ ...slabDraft, min_income: "", max_income: "", rate_pct: "" });
      await load();
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't add slab");
    } finally {
      setAdding(false);
    }
  };

  const addCfg = async () => {
    if (!cfgDraft.fy_label.trim()) return toast.error("FY label required");
    try {
      await api.createTaxRegimeConfig({
        regime: cfgDraft.regime,
        fy_label: cfgDraft.fy_label.trim(),
        standard_deduction: Number(cfgDraft.standard_deduction) || 0,
        rebate_threshold: cfgDraft.rebate_threshold.trim() === "" ? null : Number(cfgDraft.rebate_threshold),
        cess_pct: Number(cfgDraft.cess_pct) || 0,
      });
      toast.success("Config added");
      setCfgDraft(blankCfg());
      await load();
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't add config");
    }
  };

  const removeSlab = async (slab: TaxSlab) => {
    if (!confirm(`Deactivate ${slab.regime} ${slab.fyLabel} ₹${inr(slab.minIncome)}+ slab?`)) return;
    try {
      await api.deactivateTaxSlab(slab.id);
      await load();
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't deactivate");
    }
  };

  const removeCfg = async (cfg: TaxRegimeConfig) => {
    if (!confirm(`Deactivate ${cfg.regime} ${cfg.fyLabel} config?`)) return;
    try {
      await api.deactivateTaxRegimeConfig(cfg.id);
      await load();
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't deactivate");
    }
  };

  return (
    <div>
      <div className="border-b border-border p-4">
        <h3 className="font-display text-sm font-semibold">Income tax slabs</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Per-regime, per-FY slabs + the supporting constants (standard deduction,
          87A rebate threshold, cess %). The payroll-run generator computes monthly
          TDS using these. Update when Budget revises rates — history stays in the DB.
        </p>
      </div>

      <div className="space-y-6 p-4">
        {loading && slabs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : slabs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tax slabs configured yet.</p>
        ) : (
          fyLabels.map((fy) => (
            <div key={fy} className="space-y-2">
              <h4 className="font-display text-sm font-semibold">{fy}</h4>
              {(["new", "old"] as TaxRegime[]).map((regime) => {
                const rows = grouped[fy][regime];
                if (rows.length === 0) return null;
                const cfg = cfgByKey[`${fy}|${regime}`];
                return (
                  <div key={regime} className="overflow-hidden rounded-md border border-border">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-muted/40 px-3 py-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {regime === "new" ? "New regime" : "Old regime"}
                      </span>
                      {cfg ? (
                        <span className="text-[11px] text-muted-foreground">
                          Std ded ₹{inr(cfg.standardDeduction)} · 87A rebate
                          {cfg.rebateThreshold == null ? " none" : ` ≤ ₹${inr(cfg.rebateThreshold)}`}
                          {" · "}Cess {cfg.cessPct}%
                          <Button size="sm" variant="ghost" className="ml-2 h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                                  onClick={() => void removeCfg(cfg)}>
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        </span>
                      ) : (
                        <span className="text-[11px] text-destructive">No config row yet — add one below.</span>
                      )}
                    </div>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-right font-medium">Min income (₹)</th>
                          <th className="px-3 py-2 text-right font-medium">Max income (₹)</th>
                          <th className="px-3 py-2 text-right font-medium">Rate %</th>
                          <th className="px-3 py-2 text-right font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((s) => (
                          <tr key={s.id} className="border-t border-border">
                            <td className="px-3 py-2 text-right tabular-nums">{inr(s.minIncome)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {s.maxIncome == null ? "and above" : inr(s.maxIncome)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.ratePct}%</td>
                            <td className="px-3 py-2 text-right">
                              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                                      onClick={() => void removeSlab(s)}>
                                <Trash2 className="h-3 w-3" /> Deactivate
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          ))
        )}

        <div className="rounded-md border border-dashed border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add a slab</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div>
              <Label className="text-xs">Regime</Label>
              <Select value={slabDraft.regime} onValueChange={(v) => setSlabDraft({ ...slabDraft, regime: v as TaxRegime })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="old">Old</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ts-fy" className="text-xs">FY label</Label>
              <Input id="ts-fy" placeholder="FY 2026-27" value={slabDraft.fy_label}
                     onChange={(e) => setSlabDraft({ ...slabDraft, fy_label: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ts-min" className="text-xs">Min income (₹)</Label>
              <Input id="ts-min" inputMode="numeric" placeholder="0" value={slabDraft.min_income}
                     onChange={(e) => setSlabDraft({ ...slabDraft, min_income: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ts-max" className="text-xs">Max income (₹, blank = top)</Label>
              <Input id="ts-max" inputMode="numeric" placeholder="" value={slabDraft.max_income}
                     onChange={(e) => setSlabDraft({ ...slabDraft, max_income: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ts-rate" className="text-xs">Rate %</Label>
              <Input id="ts-rate" inputMode="numeric" placeholder="5" value={slabDraft.rate_pct}
                     onChange={(e) => setSlabDraft({ ...slabDraft, rate_pct: e.target.value })} />
            </div>
            <div className="flex items-end">
              <Button onClick={addSlab} disabled={adding} className="w-full gap-1.5">
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-dashed border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add a regime config (standard deduction · 87A rebate · cess)</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div>
              <Label className="text-xs">Regime</Label>
              <Select value={cfgDraft.regime} onValueChange={(v) => setCfgDraft({ ...cfgDraft, regime: v as TaxRegime })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="old">Old</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tc-fy" className="text-xs">FY label</Label>
              <Input id="tc-fy" placeholder="FY 2026-27" value={cfgDraft.fy_label}
                     onChange={(e) => setCfgDraft({ ...cfgDraft, fy_label: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tc-sd" className="text-xs">Std deduction (₹)</Label>
              <Input id="tc-sd" inputMode="numeric" value={cfgDraft.standard_deduction}
                     onChange={(e) => setCfgDraft({ ...cfgDraft, standard_deduction: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tc-rb" className="text-xs">87A rebate ≤ (₹)</Label>
              <Input id="tc-rb" inputMode="numeric" placeholder="blank = none" value={cfgDraft.rebate_threshold}
                     onChange={(e) => setCfgDraft({ ...cfgDraft, rebate_threshold: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tc-cess" className="text-xs">Cess %</Label>
              <Input id="tc-cess" inputMode="numeric" value={cfgDraft.cess_pct}
                     onChange={(e) => setCfgDraft({ ...cfgDraft, cess_pct: e.target.value })} />
            </div>
            <div className="flex items-end">
              <Button onClick={addCfg} className="w-full gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
