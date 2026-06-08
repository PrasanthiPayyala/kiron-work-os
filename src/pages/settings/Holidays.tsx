// Holiday calendar editor — Settings > Holidays.
// HR / super_admin can add/edit/delete rows and bulk-import a year's list.
// Everyone else (the tab is gated by Settings nav access) gets read-only.
//
// The bulk-import textarea accepts tab-separated lines copy-pasted from
// any HR doc:  YYYY-MM-DD <tab> Name <tab> type? <tab> notes?
// The type defaults to gazetted; "optional" / "informational" can be set
// per row. The form helpfully expands a free-text day-of-week if pasted in
// — we just ignore extra columns.
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useDataStore } from "@/lib/dataStore";
import { useAuth, can } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import type { Holiday, HolidayType } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CalendarDays, Plus, Pencil, Trash2, Upload, Loader2 } from "lucide-react";
import { CompanyBadge } from "@/components/CompanyBadge";

const TYPES: HolidayType[] = ["gazetted", "optional", "informational"];
const TYPE_LABEL: Record<HolidayType, string> = {
  gazetted: "Company holiday",
  optional: "Optional",
  informational: "Informational",
};
const TYPE_HINT: Record<HolidayType, string> = {
  gazetted: "Everyone off, attendance counts as holiday.",
  optional: "Visible on calendar; employees may apply for leave on the day.",
  informational: "Shown on calendar but not observed by the company.",
};

const dayName = (iso: string): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  // Local-time Date so the displayed weekday matches the user's calendar.
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: "short" });
};

function HolidayDialog({ open, onOpenChange, holiday, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  holiday?: Holiday;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(holiday?.date ?? "");
  const [name, setName] = useState(holiday?.name ?? "");
  const [type, setType] = useState<HolidayType>(holiday?.type ?? "gazetted");
  const [notes, setNotes] = useState(holiday?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const isEdit = !!holiday;

  // Reset every time the dialog opens so leftover state doesn't bleed
  // between add / edit.
  useMemo(() => {
    if (open) {
      setDate(holiday?.date ?? "");
      setName(holiday?.name ?? "");
      setType(holiday?.type ?? "gazetted");
      setNotes(holiday?.notes ?? "");
    }
  }, [open, holiday]);

  const submit = async () => {
    if (!date || !name.trim()) {
      toast({ title: "Date and name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isEdit && holiday) {
        await api.updateHoliday(holiday.id, { date, name: name.trim(), type, notes: notes || null });
      } else {
        await api.createHoliday({ date, name: name.trim(), type, notes: notes || null });
      }
      toast({ title: isEdit ? "Holiday updated" : "Holiday added" });
      onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit holiday" : "Add holiday"}</DialogTitle>
          <DialogDescription>{TYPE_HINT[type]}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="hd-date">Date {date && <span className="text-xs text-muted-foreground">· {dayName(date)}</span>}</Label>
            <Input id="hd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hd-name">Name</Label>
            <Input id="hd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as HolidayType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hd-notes">Notes (optional)</Label>
            <Input id="hd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. only for Muslim employees" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : (isEdit ? "Save" : "Add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkImportDialog({ open, onOpenChange, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);

  const parseLines = (s: string) => {
    const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: { date: string; name: string; type: HolidayType; notes?: string | null }[] = [];
    for (const line of lines) {
      // Accept tab-separated or comma-separated.
      const parts = line.includes("\t") ? line.split("\t") : line.split(",").map((p) => p.trim());
      const [date, name, t, ...rest] = parts;
      if (!date || !name) continue;
      const typeVal = (t || "").toLowerCase().trim();
      const type: HolidayType =
        typeVal === "optional" ? "optional" :
        typeVal === "informational" || typeVal === "info" ? "informational" :
        "gazetted";
      out.push({ date, name, type, notes: rest.length ? rest.join(", ") : null });
    }
    return out;
  };

  const run = async () => {
    const rows = parseLines(raw);
    if (!rows.length) {
      toast({ title: "Nothing to import", description: "Paste at least one line as `date<TAB>name<TAB>type`." });
      return;
    }
    setSaving(true);
    try {
      const result = await api.bulkImportHolidays({ holidays: rows, replace });
      toast({
        title: "Import complete",
        description: `${result.inserted} added, ${result.updated} updated, ${result.skipped} skipped (duplicates).`,
      });
      onOpenChange(false);
      setRaw("");
      await onSaved();
    } catch (e) {
      toast({
        title: "Import failed",
        description: e instanceof ApiError ? e.message : "Check the format and try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk import holidays</DialogTitle>
          <DialogDescription>
            One line per holiday. Format: <code>date</code> · <code>name</code> · <code>type</code> (optional, defaults to "gazetted") · <code>notes</code> (optional). Tab or comma between columns.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <textarea
            className="h-64 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"2026-01-14\tPongal\n2026-01-15\tSankranthi\n2026-03-21\tRamzan\toptional\tonly for Muslim employees\n2026-12-25\tChristmas\tinformational\tnot observed"}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace duplicates (update type / notes) instead of skipping
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={run} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HolidaysSection() {
  const { holidays, refresh } = useDataStore();
  const { role } = useAuth();
  const { toast } = useToast();
  const canEdit = role ? can.manageUsers(role) : false;

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const h of holidays) {
      const y = Number(h.date.slice(0, 4));
      if (Number.isFinite(y)) set.add(y);
    }
    const thisYear = new Date().getFullYear();
    set.add(thisYear);
    set.add(thisYear + 1);
    return [...set].sort((a, b) => b - a);
  }, [holidays]);

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Holiday | undefined>(undefined);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleting, setDeleting] = useState<Holiday | null>(null);

  const list = useMemo(() => {
    return holidays
      .filter((h) => h.date.startsWith(String(year)))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [holidays, year]);

  const runDelete = async () => {
    if (!deleting) return;
    try {
      await api.deleteHoliday(deleting.id);
      toast({ title: "Holiday removed" });
      setDeleting(null);
      await refresh();
    } catch (e) {
      toast({
        title: "Couldn't remove",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold">Holiday calendar</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Visible to every employee on the Attendance page. Re-add the list each year — dates shift in India.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Bulk import
            </Button>
            <Button size="sm" onClick={() => { setEditTarget(undefined); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add holiday
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Year</Label>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{list.length} {list.length === 1 ? "holiday" : "holidays"}</span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <CalendarDays className="mx-auto mb-2 h-6 w-6" />
          No holidays set for {year}.
          {canEdit && <p className="mt-1">Click <b>Bulk import</b> to paste the year's list.</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Day</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                {canEdit && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{h.date}</td>
                  <td className="px-3 py-2 text-muted-foreground">{dayName(h.date)}</td>
                  <td className="px-3 py-2 font-medium">{h.name}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                      h.type === "gazetted" ? "bg-accent-soft text-accent" :
                      h.type === "optional" ? "bg-warning/15 text-warning" :
                      "bg-surface-muted text-muted-foreground"
                    }`}>
                      {TYPE_LABEL[h.type]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {h.companyId ? <CompanyBadge companyId={h.companyId} size="xs" /> : <span className="text-xs text-muted-foreground">All companies</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{h.notes ?? ""}</td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditTarget(h); setDialogOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => setDeleting(h)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HolidayDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        holiday={editTarget}
        onSaved={refresh}
      />
      <BulkImportDialog open={bulkOpen} onOpenChange={setBulkOpen} onSaved={refresh} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this holiday?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} on {deleting?.date} will no longer appear on the attendance calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
