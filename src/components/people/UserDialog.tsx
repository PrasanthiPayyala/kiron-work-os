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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  user?: User; // required for edit
  onSaved?: () => void;
};

export function UserDialog({ open, onOpenChange, mode, user, onSaved }: Props) {
  const { companies, users } = useDataStore();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [designation, setDesignation] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [role, setRole] = useState<Role>("employee");
  const [companyId, setCompanyId] = useState("");
  const [managerId, setManagerId] = useState<string>("none");
  const [reviewerId, setReviewerId] = useState<string>("none");
  const [doj, setDoj] = useState("");
  const [saving, setSaving] = useState(false);

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
      setManagerId(user.reportingManagerId ?? "none");
      setReviewerId(user.reviewerId ?? "none");
      setDoj(user.joinedAt ?? "");
    } else {
      setFullName("");
      setEmail("");
      setPassword("");
      setDesignation("");
      setEmploymentType("full_time");
      setRole("employee");
      setCompanyId(companies[0]?.id ?? "");
      setManagerId("none");
      setReviewerId("none");
      setDoj("");
    }
  }, [open, mode, user, companies]);

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
        await api.updateUser(user.id, {
          full_name: fullName.trim(),
          designation: designation.trim(),
          employment_type: employmentType,
          home_company_id: companyId,
          reporting_manager_id: managerId === "none" ? null : managerId,
          reviewer_id: reviewerId === "none" ? null : reviewerId,
          doj: doj || null,
        });
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add user" : "Edit user"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create an account. The person can sign in immediately with this temporary password."
              : "Update profile fields. Changing employment type or role does not affect their existing project access."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ud-name">Full name</Label>
            <Input id="ud-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ud-email">Email {mode === "edit" && <span className="text-xs text-muted-foreground">(read-only)</span>}</Label>
              <Input id="ud-email" type="email" value={email} disabled={mode === "edit"} onChange={(e) => setEmail(e.target.value)} />
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

          <div className="grid gap-1.5">
            <Label>Home company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : (mode === "create" ? "Create user" : "Save changes")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
