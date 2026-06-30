// Create / edit a user account. Used from People page by super_admin & hr_admin.
//
// Mode `create` calls POST /users (full row + temporary password).
// Mode `edit` calls PATCH /users/{id} for profile fields and PUT
// /users/{id}/roles when the role changes.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { roleLabel, employmentLabel } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { useToast } from "@/hooks/use-toast";
import type { Role, EmploymentType, User } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLES: Role[] = [
  "super_admin","founder","founder_office_coordinator","founder_office_support",
  "manager","hr_admin","employee","intern",
];
const EMPLOYMENT_TYPES: EmploymentType[] = ["full_time","part_time","contract","intern","temporary"];
// ISO day numbers (1=Mon..7=Sun) with the single-letter labels we render on
// the day-picker pills. Single-letter rather than "Mon" keeps the dialog narrow.
const DAY_LABELS: { iso: number; short: string; full: string }[] = [
  { iso: 1, short: "M", full: "Mon" },
  { iso: 2, short: "T", full: "Tue" },
  { iso: 3, short: "W", full: "Wed" },
  { iso: 4, short: "T", full: "Thu" },
  { iso: 5, short: "F", full: "Fri" },
  { iso: 6, short: "S", full: "Sat" },
  { iso: 7, short: "S", full: "Sun" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  user?: User; // required for edit
  onSaved?: () => void;
};

export function UserDialog({ open, onOpenChange, mode, user, onSaved }: Props) {
  const { companies, users, offices } = useDataStore();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [designation, setDesignation] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [role, setRole] = useState<Role>("employee");
  const [companyId, setCompanyId] = useState("");
  // Optional per-employee office. "none" = no office assigned (geofence
  // skipped on check-in). Auto-selects when the chosen company has
  // exactly one active office; otherwise renders a dropdown.
  const [officeId, setOfficeId] = useState<string>("none");
  const [managerId, setManagerId] = useState<string>("none");
  const [reviewerId, setReviewerId] = useState<string>("none");
  const [doj, setDoj] = useState("");
  const [followupAccess, setFollowupAccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Working-schedule override (off by default — most employees follow the
  // company default; HR opts a person in to a different schedule).
  const [customSchedule, setCustomSchedule] = useState(false);
  const [workDays, setWorkDays] = useState<number[]>([1,2,3,4,5,6]);
  const [workStart, setWorkStart] = useState("09:30");
  const [workEnd, setWorkEnd] = useState("18:30");
  // null = "every Saturday is a working day". The UI keeps the full 1..5 set
  // visible so the user can simply uncheck the off-Saturdays; on save we
  // collapse "all five" back to null.
  const [satWeeks, setSatWeeks] = useState<number[]>([1,2,3,4,5]);

  // Default the override editor to the company's current schedule so toggling
  // "custom" doesn't drop the user straight onto unrelated values.
  const selectedCompany = companies.find((c) => c.id === companyId);

  // Active offices belonging to the picked company. Memoising would be
  // overkill — offices is a small list and recomputing on each render
  // keeps the auto-select behaviour deterministic.
  const companyOffices = offices.filter((o) => o.companyId === companyId && o.isActive);

  // Auto-select the office when there's exactly one. If the picked
  // office no longer belongs to the company (e.g. company changed in
  // edit mode), reset to 'none' so we don't send a stale FK.
  useEffect(() => {
    if (!companyId) {
      if (officeId !== "none") setOfficeId("none");
      return;
    }
    if (officeId !== "none" && !companyOffices.some((o) => o.id === officeId)) {
      setOfficeId("none");
      return;
    }
    if (officeId === "none" && companyOffices.length === 1) {
      setOfficeId(companyOffices[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, companyOffices.length]);

  // Reset / hydrate every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && user) {
      setFullName(user.name);
      setEmail(user.email);
      setPassword("");
      setDesignation(user.designation);
      setEmploymentType(user.employmentType);
      setRole(user.role);
      setCompanyId(user.homeCompanyId);
      setOfficeId(user.officeId ?? "none");
      setManagerId(user.reportingManagerId ?? "none");
      setReviewerId(user.reviewerId ?? "none");
      setDoj(user.joinedAt ?? "");
      setFollowupAccess(user.attendanceFollowupAccess === true);
      const o = user.scheduleOverride;
      const hasAny = !!(o && (o.workDays || o.workStart || o.workEnd || o.saturdayWeeksWorking));
      setCustomSchedule(hasAny);
      const co = companies.find((c) => c.id === user.homeCompanyId);
      setWorkDays(o?.workDays ?? co?.schedule.workDays ?? [1,2,3,4,5,6]);
      setWorkStart(o?.workStart ?? co?.schedule.workStart ?? "09:30");
      setWorkEnd(o?.workEnd ?? co?.schedule.workEnd ?? "18:30");
      setSatWeeks(o?.saturdayWeeksWorking ?? co?.schedule.saturdayWeeksWorking ?? [1,2,3,4,5]);
    } else {
      setFullName("");
      setEmail("");
      setPassword("");
      setDesignation("");
      setEmploymentType("full_time");
      setRole("employee");
      const firstCo = companies[0];
      setCompanyId(firstCo?.id ?? "");
      setOfficeId("none");
      setManagerId("none");
      setReviewerId("none");
      setDoj("");
      setFollowupAccess(false);
      setCustomSchedule(false);
      setWorkDays(firstCo?.schedule.workDays ?? [1,2,3,4,5,6]);
      setWorkStart(firstCo?.schedule.workStart ?? "09:30");
      setWorkEnd(firstCo?.schedule.workEnd ?? "18:30");
      setSatWeeks(firstCo?.schedule.saturdayWeeksWorking ?? [1,2,3,4,5]);
    }
  }, [open, mode, user, companies]);

  const toggleDay = (iso: number) => {
    setWorkDays((cur) => cur.includes(iso) ? cur.filter((d) => d !== iso) : [...cur, iso].sort((a,b) => a-b));
  };
  const toggleSatWeek = (w: number) => {
    setSatWeeks((cur) => cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort((a,b) => a-b));
  };

  const submit = async () => {
    if (!fullName.trim() || !companyId) {
      toast({ title: "Missing fields", description: "Full name and company are required.", variant: "destructive" });
      return;
    }
    if (mode === "create" && (!email.trim() || password.length < 6)) {
      toast({ title: "Missing fields", description: "Email and a 6+ char password are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        await api.createUser({
          full_name: fullName.trim(),
          email: email.trim(),
          password,
          home_company_id: companyId,
          office_id: officeId === "none" ? null : officeId,
          designation: designation.trim(),
          employment_type: employmentType,
          role,
          reporting_manager_id: managerId === "none" ? null : managerId,
          reviewer_id: reviewerId === "none" ? null : reviewerId,
          doj: doj || null,
        });
        toast({ title: "User created", description: `${fullName} can now sign in.` });
      } else if (user) {
        // Patch the profile, then sync roles if they changed. Two calls because
        // user_roles lives in a separate table; the order matters only if the
        // first fails — keep them sequential so we don't strand roles.
        // email is editable in edit mode — backend uniqueness-checks and
        // updates both users.email (auth identity) and profiles.email.
        const patch: Record<string, unknown> = {
          full_name: fullName.trim(),
          designation: designation.trim(),
          employment_type: employmentType,
          home_company_id: companyId,
          office_id: officeId === "none" ? null : officeId,
          reporting_manager_id: managerId === "none" ? null : managerId,
          reviewer_id: reviewerId === "none" ? null : reviewerId,
          doj: doj || null,
          // Custom schedule on -> persist explicit values. Off -> NULL them
          // so the profile reverts to the company default.
          work_days: customSchedule ? workDays : null,
          work_start: customSchedule ? workStart : null,
          work_end: customSchedule ? workEnd : null,
          // Saturday-of-month override only meaningful when Sat is in
          // workDays. "Every Saturday" (all 5 ticked) collapses to null.
          saturday_weeks_working: !customSchedule
            ? null
            : workDays.includes(6) && satWeeks.length < 5
              ? satWeeks
              : null,
          attendance_followup_access: followupAccess,
        };
        // Only include email when it actually changed — sending it on every
        // save would waste a uniqueness query, and changes are rare.
        if (email.trim() && email.trim().toLowerCase() !== user.email.toLowerCase()) {
          patch.email = email.trim();
        }
        await api.updateUser(user.id, patch);
        if (role !== user.role) {
          await api.setUserRoles(user.id, [role]);
        }
        toast({ title: "User updated", description: `${fullName} saved.` });
      }
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Save failed";
      toast({ title: "Couldn't save", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h-[90vh] + flex-col so the body scrolls inside the dialog
          (header + footer stay pinned). Without this, the long custom-schedule
          block pushes Save/Cancel below the viewport. */}
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add user" : "Edit user"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create an account. The person can sign in immediately with this temporary password."
              : "Update profile fields. Changing employment type or role does not affect their existing project access."}
          </DialogDescription>
        </DialogHeader>

        {/* flex-1 + min-h-0 + overflow-y-auto is the standard recipe for a
            scrollable middle row inside a fixed-height flex column. min-h-0
            is the non-obvious bit — without it the body refuses to shrink
            and overflow-y-auto is a no-op. */}
        <div className="grid gap-3 py-2 overflow-y-auto flex-1 min-h-0">
          <div className="grid gap-1.5">
            <Label htmlFor="ud-name">Full name</Label>
            <Input id="ud-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ud-email">
                Email
                {mode === "edit" && <span className="ml-1 text-xs text-muted-foreground">— login identity, change with care</span>}
              </Label>
              <Input id="ud-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ud-pw">{mode === "create" ? "Temporary password" : "Password (use reset link instead)"}</Label>
              <Input id="ud-pw" type="text" value={password} disabled={mode === "edit"} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "create" ? "min 6 chars" : "—"} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ud-des">Designation / job title</Label>
            <Input id="ud-des" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Software Developer, FSD, UI/Front-end Developer" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Employment type</Label>
              <Select value={employmentType} onValueChange={(v) => setEmploymentType(v as EmploymentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{employmentLabel(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Role (capabilities)</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Per-user grant: gives plain employees access to the Team
              Attendance page so TA / recruitment staff can follow up
              with people who haven't checked in. Only meaningful in
              edit mode — new users get the flag via a follow-up edit. */}
          {mode === "edit" && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-surface-muted/40 p-3">
              <input
                id="ud-followup"
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={followupAccess}
                onChange={(e) => setFollowupAccess(e.target.checked)}
              />
              <div className="flex-1">
                <Label htmlFor="ud-followup" className="text-sm font-medium">Can view Team Attendance</Label>
                <p className="text-[11px] text-muted-foreground">
                  Grants access to the Team Attendance / Follow-up page even on plain employee role.
                  Use for HR / TA / recruitment staff who chase missed check-ins.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>Home company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies
                  // Inactive companies stay selectable for existing users
                  // whose home is one (so editing them isn't broken), but
                  // are hidden from the picker for fresh assignments.
                  .filter((c) => c.isActive || c.id === companyId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{!c.isActive ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Office picker — only rendered when the chosen company actually
              has any offices configured. With one office we auto-selected
              it above; the user can still override here. */}
          {companyOffices.length > 0 && (
            <div className="grid gap-1.5">
              <Label>Office (geofence)</Label>
              <Select value={officeId} onValueChange={setOfficeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No office assigned —</SelectItem>
                  {companyOffices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}{o.latitude == null ? " (no geofence)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Drives the geo check at check-in. No office = geofence off.
                Office without coordinates = address-only, no warn.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Reporting manager</Label>
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {users.filter((u) => u.id !== user?.id && u.isActive).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Reviewer</Label>
              <Select value={reviewerId} onValueChange={setReviewerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {users.filter((u) => u.id !== user?.id && u.isActive).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ud-doj">Date of joining</Label>
            <Input id="ud-doj" type="date" value={doj} onChange={(e) => setDoj(e.target.value)} />
          </div>

          <div className="rounded-md border border-border bg-surface-muted/40 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5"
                checked={customSchedule}
                onChange={(e) => setCustomSchedule(e.target.checked)}
              />
              <span>
                <span className="font-medium">Custom working schedule</span>
                <span className="block text-xs text-muted-foreground">
                  {customSchedule
                    ? "Pick the working days + hours that apply to this person."
                    : selectedCompany
                      ? `Inherits ${selectedCompany.shortName}'s default (${selectedCompany.schedule.workStart}–${selectedCompany.schedule.workEnd}, ${selectedCompany.schedule.workDays.length} days/week).`
                      : "Inherits the company default."}
                </span>
              </span>
            </label>

            {customSchedule && (
              <div className="mt-3 space-y-3">
                <div>
                  <Label className="text-xs">Working days</Label>
                  <div className="mt-1.5 flex gap-1">
                    {DAY_LABELS.map((d) => {
                      const on = workDays.includes(d.iso);
                      return (
                        <button
                          key={d.iso}
                          type="button"
                          onClick={() => toggleDay(d.iso)}
                          className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-medium transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
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
                    <Input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">End</Label>
                    <Input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
                  </div>
                </div>
                {workDays.includes(6) && (
                  <div>
                    <Label className="text-xs">Working Saturdays</Label>
                    <div className="mt-1.5 flex gap-1">
                      {[
                        { week: 1, label: "1st" },
                        { week: 2, label: "2nd" },
                        { week: 3, label: "3rd" },
                        { week: 4, label: "4th" },
                        { week: 5, label: "5th" },
                      ].map(({ week, label }) => {
                        const on = satWeeks.includes(week);
                        return (
                          <button
                            key={week}
                            type="button"
                            onClick={() => toggleSatWeek(week)}
                            className={`flex h-8 min-w-[2.25rem] items-center justify-center rounded-md border px-1.5 text-xs font-medium transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                            title={`${label} Saturday of the month`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Uncheck the Saturdays this person has off (e.g. 2nd & 4th).
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : (mode === "create" ? "Create user" : "Save changes")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
