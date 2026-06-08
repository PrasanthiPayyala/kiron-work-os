// Per-company working schedule editor. Lives in Settings > Working hours.
// Each company is a card; super_admin / hr_admin can edit; everyone else sees
// the rendered schedule (read-only).
//
// ISO day numbers: 1=Mon..7=Sun. The dialog above uses the same labels.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useDataStore } from "@/lib/dataStore";
import { useAuth, can } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompanyBadge } from "@/components/CompanyBadge";
import { Loader2 } from "lucide-react";

const DAY_LABELS: { iso: number; short: string; full: string }[] = [
  { iso: 1, short: "M", full: "Mon" },
  { iso: 2, short: "T", full: "Tue" },
  { iso: 3, short: "W", full: "Wed" },
  { iso: 4, short: "T", full: "Thu" },
  { iso: 5, short: "F", full: "Fri" },
  { iso: 6, short: "S", full: "Sat" },
  { iso: 7, short: "S", full: "Sun" },
];

const SAT_WEEK_LABELS = [
  { week: 1, label: "1st" },
  { week: 2, label: "2nd" },
  { week: 3, label: "3rd" },
  { week: 4, label: "4th" },
  { week: 5, label: "5th" },
];

function CompanyScheduleCard({ company, canEdit, onSaved }: { company: Company; canEdit: boolean; onSaved: () => Promise<void> | void }) {
  const { toast } = useToast();
  const [days, setDays] = useState<number[]>(company.schedule.workDays);
  const [start, setStart] = useState(company.schedule.workStart);
  const [end, setEnd] = useState(company.schedule.workEnd);
  // null in DB = every Saturday works. In UI we hold it as the full set of
  // five positions when "all" is chosen, and a subset when alternates are
  // off; on save we collapse "all five checked" back to null.
  const [satWeeks, setSatWeeks] = useState<number[]>(
    company.schedule.saturdayWeeksWorking ?? [1,2,3,4,5],
  );
  const [saving, setSaving] = useState(false);

  // Re-hydrate if the store refreshes underneath us (e.g. another tab saved).
  useEffect(() => {
    setDays(company.schedule.workDays);
    setStart(company.schedule.workStart);
    setEnd(company.schedule.workEnd);
    setSatWeeks(company.schedule.saturdayWeeksWorking ?? [1,2,3,4,5]);
  }, [company.id, company.schedule.workDays, company.schedule.workStart, company.schedule.workEnd, company.schedule.saturdayWeeksWorking]);

  const toggle = (iso: number) => {
    setDays((cur) => cur.includes(iso) ? cur.filter((d) => d !== iso) : [...cur, iso].sort((a,b) => a-b));
  };
  const toggleSatWeek = (w: number) => {
    setSatWeeks((cur) => cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort((a,b) => a-b));
  };

  const saturdayIncluded = days.includes(6);

  const save = async () => {
    if (!days.length) {
      toast({ title: "Pick at least one working day", variant: "destructive" });
      return;
    }
    if (start >= end) {
      toast({ title: "Start must be earlier than end", variant: "destructive" });
      return;
    }
    if (saturdayIncluded && !satWeeks.length) {
      toast({ title: "Pick at least one working Saturday", description: "Or remove Saturday from working days.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // All five Saturdays checked = "every Saturday works", which we encode
      // as null so existing-rows semantics (NULL = all) are preserved. Sat
      // not in work_days at all = nothing to encode, send null.
      const satOut = !saturdayIncluded || satWeeks.length === 5 ? null : satWeeks;
      await api.updateCompany(company.id, {
        work_days: days, work_start: start, work_end: end,
        saturday_weeks_working: satOut,
      });
      toast({ title: "Saved", description: `${company.shortName} schedule updated.` });
      await onSaved();
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <CompanyBadge companyId={company.id} />
        <span className="text-xs text-muted-foreground">{company.schedule.workDays.length} days · {company.schedule.workStart}–{company.schedule.workEnd}</span>
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <Label className="text-xs">Working days</Label>
          <div className="mt-1.5 flex gap-1">
            {DAY_LABELS.map((d) => {
              const on = days.includes(d.iso);
              return (
                <button
                  key={d.iso}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggle(d.iso)}
                  className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-medium transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"} ${canEdit ? "hover:text-foreground" : "cursor-not-allowed opacity-60"}`}
                  title={d.full}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Start</Label>
            <Input type="time" value={start} disabled={!canEdit} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">End</Label>
            <Input type="time" value={end} disabled={!canEdit} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {saturdayIncluded && (
          <div>
            <Label className="text-xs">Working Saturdays</Label>
            <div className="mt-1.5 flex gap-1">
              {SAT_WEEK_LABELS.map(({ week, label }) => {
                const on = satWeeks.includes(week);
                return (
                  <button
                    key={week}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleSatWeek(week)}
                    className={`flex h-8 min-w-[2.25rem] items-center justify-center rounded-md border px-1.5 text-xs font-medium transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"} ${canEdit ? "hover:text-foreground" : "cursor-not-allowed opacity-60"}`}
                    title={`${label} Saturday of the month`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Uncheck Saturdays that are off (e.g. uncheck 2nd & 4th).
            </p>
          </div>
        )}
        {canEdit && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkingHoursSection() {
  const { companies, refresh } = useDataStore();
  const { role } = useAuth();
  const canEdit = role ? can.manageUsers(role) : false;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-sm font-semibold">Working hours by company</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Default schedule each person inherits. Override per employee from the People page (Edit user).
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {companies.map((c) => (
          <CompanyScheduleCard key={c.id} company={c} canEdit={canEdit} onSaved={refresh} />
        ))}
      </div>
    </div>
  );
}
