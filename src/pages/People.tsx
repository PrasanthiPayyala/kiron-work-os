import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";
import { useDataStore } from "@/lib/dataStore";
import { roleLabel, employmentLabel, can } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Users, LayoutGrid, Table as TableIcon, UserPlus, Pencil, UserMinus, UserCheck, KeyRound, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate } from "react-router-dom";
import { UserDialog } from "@/components/people/UserDialog";
import type { User } from "@/types";

export default function People() {
  const navigate = useNavigate();
  const { users, getUser, companies, refresh } = useDataStore();
  const { role: myRole } = useAuth();
  const { toast } = useToast();
  const canManage = myRole ? can.manageUsers(myRole) : false;

  const [view, setView] = useState<"cards"|"table">("cards");
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editTarget, setEditTarget] = useState<User | undefined>(undefined);

  // Deactivate confirmation
  const [confirmUser, setConfirmUser] = useState<User | null>(null);
  const [confirmAction, setConfirmAction] = useState<"deactivate" | "reactivate">("deactivate");

  // HR-triggered reset link — fire-and-toast, no confirmation dialog needed
  // (non-destructive, just sends an email). Per-user busy id disables the
  // button on the row being sent so a double-click can't fire it twice.
  const [sendingResetId, setSendingResetId] = useState<string | null>(null);
  const sendResetLink = async (u: User) => {
    setSendingResetId(u.id);
    try {
      const res = await api.sendResetLink(u.id);
      toast({ title: "Reset link sent", description: `Emailed to ${res.email}` });
    } catch (e) {
      toast({
        title: "Couldn't send reset link",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSendingResetId(null);
    }
  };

  // Toggle is an exclusive switch — "Show deactivated" on means ONLY
  // deactivated; off means ONLY active. Previously it was OR (which
  // showed everyone when toggled on).
  const filtered = useMemo(() => users.filter((u) =>
    (showInactive ? !u.isActive : u.isActive) &&
    (company === "all" || u.homeCompanyId === company) &&
    (!q || u.name.toLowerCase().includes(q.toLowerCase()) || u.designation.toLowerCase().includes(q.toLowerCase()))
  ), [users, q, company, showInactive]);

  const openCreate = () => {
    setDialogMode("create");
    setEditTarget(undefined);
    setDialogOpen(true);
  };
  const openEdit = (u: User) => {
    setDialogMode("edit");
    setEditTarget(u);
    setDialogOpen(true);
  };
  const runConfirm = async () => {
    if (!confirmUser) return;
    try {
      if (confirmAction === "deactivate") {
        await api.deactivateUser(confirmUser.id);
        toast({ title: "Account deactivated", description: `${confirmUser.name} can no longer sign in.` });
      } else {
        await api.reactivateUser(confirmUser.id);
        toast({ title: "Account reactivated", description: `${confirmUser.name} can sign in again.` });
      }
      setConfirmUser(null);
      await refresh();
    } catch (e) {
      toast({
        title: "Couldn't update account",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="People"
        description="Directory across all Kiron Group companies."
        icon={<Users className="h-5 w-5" />}
        actions={canManage ? (
          <Button size="sm" onClick={openCreate}><UserPlus className="mr-1.5 h-4 w-4" /> Add user</Button>
        ) : undefined}
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Input placeholder="Search by name or role..." value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.shortName}</SelectItem>)}
            </SelectContent>
          </Select>
          {canManage && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" className="h-3.5 w-3.5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show deactivated
            </label>
          )}
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <button onClick={() => setView("cards")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
            <button onClick={() => setView("table")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><TableIcon className="h-3.5 w-3.5" /> Table</button>
          </div>
        </div>

        {view === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((u) => (
              <div key={u.id} className={`rounded-xl border border-border bg-surface p-4 shadow-card transition hover:border-primary/40 ${!u.isActive ? "opacity-60" : ""}`}>
                <button onClick={() => navigate(`/people/${u.id}`)} className="block w-full text-left">
                  <div className="flex items-center gap-3">
                    <UserAvatar userId={u.id} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate font-display font-semibold">{u.name}{!u.isActive && <span className="ml-1 text-xs text-muted-foreground">(deactivated)</span>}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.designation || "—"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <CompanyBadge companyId={u.homeCompanyId} size="xs" />
                    <span className="rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{employmentLabel(u.employmentType)}</span>
                  </div>
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{roleLabel(u.role)}</p>
                </button>
                {canManage && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEdit(u)}>
                      <Pencil className="mr-1 h-3 w-3" /> Edit
                    </Button>
                    {u.isActive && (
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        disabled={sendingResetId === u.id}
                        onClick={() => void sendResetLink(u)}
                        title="Email this employee a password reset link"
                      >
                        {sendingResetId === u.id
                          ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          : <KeyRound className="mr-1 h-3 w-3" />}
                        Reset link
                      </Button>
                    )}
                    {u.isActive ? (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={() => { setConfirmUser(u); setConfirmAction("deactivate"); }}>
                        <UserMinus className="mr-1 h-3 w-3" /> Deactivate
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-accent" onClick={() => { setConfirmUser(u); setConfirmAction("reactivate"); }}>
                        <UserCheck className="mr-1 h-3 w-3" /> Reactivate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Designation</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Manager</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                {canManage && <th className="px-4 py-2.5 font-medium text-right">Actions</th>}
              </tr></thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className={`border-b border-border last:border-0 hover:bg-surface-muted/40 ${!u.isActive ? "opacity-60" : ""}`}>
                    <td className="px-4 py-2.5 cursor-pointer" onClick={() => navigate(`/people/${u.id}`)}>
                      <div className="flex items-center gap-2"><UserAvatar userId={u.id} size="sm" /><span className="font-medium">{u.name}</span></div>
                    </td>
                    <td className="px-4 py-2.5">{u.designation || "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{employmentLabel(u.employmentType)}</td>
                    <td className="px-4 py-2.5"><CompanyBadge companyId={u.homeCompanyId} size="xs" /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{getUser(u.reportingManagerId)?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {u.isActive
                        ? <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">Active</span>
                        : <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Deactivated</span>}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(u)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {u.isActive && (
                            <Button
                              variant="ghost" size="sm" className="h-7 px-2"
                              disabled={sendingResetId === u.id}
                              onClick={() => void sendResetLink(u)}
                              title="Email this employee a password reset link"
                            >
                              {sendingResetId === u.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <KeyRound className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                          {u.isActive ? (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => { setConfirmUser(u); setConfirmAction("deactivate"); }}>
                              <UserMinus className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-accent" onClick={() => { setConfirmUser(u); setConfirmAction("reactivate"); }}>
                              <UserCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        user={editTarget}
        onSaved={() => { void refresh(); }}
      />

      <AlertDialog open={!!confirmUser} onOpenChange={(o) => { if (!o) setConfirmUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "deactivate" ? "Deactivate this account?" : "Reactivate this account?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "deactivate"
                ? `${confirmUser?.name} will be signed out and blocked from logging in. Their project memberships, tasks, and chat history are preserved — you can reactivate any time.`
                : `${confirmUser?.name} will be able to sign in again with their existing password. If forgotten, they can use the password reset link.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm}>
              {confirmAction === "deactivate" ? "Deactivate" : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
