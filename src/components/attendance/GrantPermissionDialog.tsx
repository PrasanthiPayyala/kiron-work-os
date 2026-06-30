// HR-facing dialog to grant an attendance permission on behalf of an
// employee. Same fields as the employee-facing
// RequestPermissionDialog plus an employee picker. Submits with
// pre_approve=true so the row lands in 'approved' state (no separate
// review step), and the minutes immediately subtract from the
// employee's expected hours for the month.
//
// Backend gates pre_approve on HR_ROLES, so this dialog can be safely
// imported anywhere and the API will reject non-HR callers.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useDataStore } from "@/lib/dataStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Kind = "late_in" | "early_out" | "mid_out";

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "late_in",   label: "Late arrival" },
  { value: "early_out", label: "Early logout" },
  { value: "mid_out",   label: "Mid-day step-out" },
];

export function GrantPermissionDialog({
  open, onClose, onGranted,
}: {
  open: boolean;
  onClose: () => void;
  onGranted?: () => void;
}) {
  const { users } = useDataStore();
  const [userId, setUserId] = useState<string>("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("late_in");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState<string>("0");
  const [minutes, setMinutes] = useState<string>("20");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setUserId(""); setQ(""); setKind("late_in");
      setDate(new Date().toISOString().slice(0, 10));
      setHours("0"); setMinutes("20"); setReason(""); setBusy(false);
    }
  }, [open]);

  const filteredUsers = useMemo(() => {
    const hay = q.toLowerCase();
    return users
      .filter((u) => u.isActive)
      .filter((u) => !hay || u.name.toLowerCase().includes(hay) || u.email.toLowerCase().includes(hay))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, q]);

  const totalMinutes = useMemo(() => {
    const h = Math.max(0, Math.min(12, Number(hours) || 0));
    const m = Math.max(0, Math.min(59, Number(minutes) || 0));
    return h * 60 + m;
  }, [hours, minutes]);

  const submit = async () => {
    if (!userId) { toast.error("Pick an employee"); return; }
    if (!date) { toast.error("Pick a date"); return; }
    if (totalMinutes <= 0) { toast.error("Duration must be > 0"); return; }
    setBusy(true);
    try {
      const target = users.find((u) => u.id === userId);
      await api.createAttendancePermission({
        user_id: userId,
        pre_approve: true,
        date,
        kind,
        minutes: totalMinutes,
        reason: reason.trim() || null,
      });
      toast.success(
        `Granted ${totalMinutes}m ${kind.replace("_", " ")} to ${target?.name ?? "employee"} for ${date}`,
      );
      onGranted?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't grant permission");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col">
        <DialogHeader>
          <DialogTitle>Grant attendance permission</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pre-approved: lands in the employee's approved permissions immediately
            and subtracts from their expected hours for the month. Use when an
            employee pinged you on WhatsApp ("I'll be 20 min late") and you want
            to record it without making them open the app.
          </p>

          <div>
            <Label className="text-xs">Employee</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teammates by name or email"
              className="mt-1 h-9"
            />
            <ul className="mt-1.5 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {filteredUsers.length === 0 && (
                <li className="px-3 py-3 text-center text-xs text-muted-foreground">No one matches.</li>
              )}
              {filteredUsers.map((u) => (
                <li
                  key={u.id}
                  onClick={() => setUserId(u.id)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${userId === u.id ? "bg-primary-soft" : "hover:bg-surface-muted"}`}
                >
                  <UserAvatar userId={u.id} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{u.designation} · {u.email}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

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
            </div>
          </div>

          <div>
            <Label className="text-xs">Duration</Label>
            <div className="mt-1 flex items-center gap-1.5">
              <Input type="number" min={0} max={12} step={1}
                     value={hours} onChange={(e) => setHours(e.target.value)}
                     className="h-9 w-16 text-right" inputMode="numeric" />
              <span className="text-xs text-muted-foreground">hrs</span>
              <Input type="number" min={0} max={59} step={5}
                     value={minutes} onChange={(e) => setMinutes(e.target.value)}
                     className="h-9 w-16 text-right" inputMode="numeric" />
              <span className="text-xs text-muted-foreground">min</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {totalMinutes > 0 ? `${totalMinutes} min total` : "Set a duration"}
              </span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="WhatsApp: bank work, doctor visit..."
              className="mt-1 h-9"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !userId || totalMinutes <= 0}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Grant permission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
