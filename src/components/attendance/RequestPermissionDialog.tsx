// Employee-facing dialog to file an hour-scale attendance permission
// (late-in / early-out / mid-out). Persists via POST
// /attendance-permissions with status='pending'. HR/manager decides
// from the Team Attendance permissions tab.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Kind = "late_in" | "early_out" | "mid_out";

const KIND_OPTIONS: { value: Kind; label: string; hint: string }[] = [
  { value: "late_in",   label: "Late arrival",        hint: "Coming in later than work_start" },
  { value: "early_out", label: "Early logout",        hint: "Leaving before work_end" },
  { value: "mid_out",   label: "Mid-day step-out",    hint: "Out for a chunk during the day" },
];

export function RequestPermissionDialog({
  open, onClose, defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
}) {
  const [kind, setKind] = useState<Kind>("late_in");
  const [date, setDate] = useState<string>(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState<string>("1");
  const [minutes, setMinutes] = useState<string>("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setKind("late_in");
      setDate(defaultDate ?? new Date().toISOString().slice(0, 10));
      setHours("1");
      setMinutes("0");
      setReason("");
      setBusy(false);
    }
  }, [open, defaultDate]);

  const totalMinutes = useMemo(() => {
    const h = Math.max(0, Math.min(12, Number(hours) || 0));
    const m = Math.max(0, Math.min(59, Number(minutes) || 0));
    return h * 60 + m;
  }, [hours, minutes]);

  const submit = async () => {
    if (!date) { toast.error("Pick a date"); return; }
    if (totalMinutes <= 0) { toast.error("Minutes must be > 0"); return; }
    const trimmed = reason.trim();
    if (!trimmed) { toast.error("Reason is required"); return; }
    setBusy(true);
    try {
      await api.createAttendancePermission({
        date,
        kind,
        minutes: totalMinutes,
        reason: trimmed,
      });
      toast.success("Permission requested — waiting on HR approval");
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't file permission");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col">
        <DialogHeader>
          <DialogTitle>Request attendance permission</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Use this for a sign-off on partial-day attendance — late arrival,
            early logout, or stepping out mid-day. Once approved by HR, the
            minutes are subtracted from your expected hours for the month.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {KIND_OPTIONS.find((o) => o.value === kind)?.hint}
              </p>
            </div>
          </div>

          <div>
            <Label className="text-xs">Duration</Label>
            <div className="mt-1 flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={12}
                step={1}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="h-9 w-16 text-right"
                inputMode="numeric"
              />
              <span className="text-xs text-muted-foreground">hrs</span>
              <Input
                type="number"
                min={0}
                max={59}
                step={5}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="h-9 w-16 text-right"
                inputMode="numeric"
              />
              <span className="text-xs text-muted-foreground">min</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {totalMinutes > 0 ? `${totalMinutes} min total` : "Set a duration"}
              </span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
            <Input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Bank work, doctor visit, picking up kids..."
              className="mt-1 h-9"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || totalMinutes <= 0 || !date || !reason.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
