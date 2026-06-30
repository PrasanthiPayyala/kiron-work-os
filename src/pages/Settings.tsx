import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { useAuth, can } from "@/lib/auth";
import { Settings as SettingsIcon, Pencil, Plus, MoreHorizontal, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompanyBadge } from "@/components/CompanyBadge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { WorkingHoursSection } from "@/pages/settings/WorkingHours";
import { HolidaysSection } from "@/pages/settings/Holidays";
import { CompanyDialog } from "@/components/companies/CompanyDialog";
import { PtSlabsTab } from "@/components/settings/PtSlabsTab";
import { api, ApiError } from "@/lib/api";
import type { Company } from "@/types";

// Friendly labels for the FK groups returned in a 409 blocker payload.
const BLOCKER_LABELS: Record<string, string> = {
  employees: "employees",
  projects: "projects",
  tasks: "tasks",
  conversations: "chat conversations",
};

// Mail Accounts tab is hidden for v1 alongside the sidebar item — see
// roleNavAccess in src/lib/auth.tsx. Re-add the trigger + TabsContent when
// the mail module is rebuilt on FastAPI.

type DeleteState =
  | null
  | { phase: "confirm"; company: Company }
  | { phase: "blocked"; company: Company; blockers: Record<string, number> };

export default function Settings() {
  const { companies, departments, refresh } = useDataStore();
  const { role } = useAuth();
  const { toast } = useToast();
  const canManageCompanies = role ? can.manageCompanies(role) : false;
  // Company create/edit dialog state — single dialog reused for both flows.
  const [companyDialog, setCompanyDialog] = useState<{ mode: "create" | "edit"; company?: Company } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ company: Company; nextActive: boolean } | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>(null);
  const [busy, setBusy] = useState(false);

  const visibleCompanies = useMemo(
    () => companies.filter((c) => showInactive || c.isActive),
    [companies, showInactive],
  );
  const inactiveCount = useMemo(
    () => companies.filter((c) => !c.isActive).length,
    [companies],
  );

  const runArchive = async () => {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await api.updateCompany(archiveTarget.company.id, { is_active: archiveTarget.nextActive });
      toast({
        title: archiveTarget.nextActive ? "Company reactivated" : "Company marked inactive",
        description: archiveTarget.company.name,
      });
      setArchiveTarget(null);
      await refresh();
    } catch (e) {
      toast({
        title: "Couldn't update company",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (deleteState?.phase !== "confirm") return;
    const target = deleteState.company;
    setBusy(true);
    try {
      await api.deleteCompany(target.id);
      toast({ title: "Company deleted", description: target.name });
      setDeleteState(null);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.detail && typeof e.detail === "object" && "blockers" in e.detail) {
        const blockers = (e.detail as { blockers: Record<string, number> }).blockers;
        setDeleteState({ phase: "blocked", company: target, blockers });
      } else {
        toast({
          title: "Couldn't delete",
          description: e instanceof ApiError ? e.message : "Try again.",
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Settings" description="Workspace, companies, departments, working hours, roles, notifications." icon={<SettingsIcon className="h-5 w-5" />} />
      <div className="p-6">
        <Tabs defaultValue="workspace">
          <TabsList>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="companies">Companies</TabsTrigger>
            <TabsTrigger value="departments">Departments</TabsTrigger>
            <TabsTrigger value="hours">Working hours</TabsTrigger>
            <TabsTrigger value="holidays">Holidays</TabsTrigger>
            <TabsTrigger value="pt_slabs">PT slabs</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>
          <TabsContent value="workspace" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <h3 className="font-display text-sm font-semibold">Workspace</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Kiron Group · {companies.length} {companies.length === 1 ? "company" : "companies"}
            </p>
          </TabsContent>
          <TabsContent value="companies" className="rounded-xl border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-3.5">
              <p className="text-xs text-muted-foreground">
                {visibleCompanies.length} {visibleCompanies.length === 1 ? "entity" : "entities"}
                {inactiveCount > 0 && !showInactive && ` · ${inactiveCount} inactive hidden`}
              </p>
              <div className="flex items-center gap-3">
                {inactiveCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
                    <Label htmlFor="show-inactive" className="text-xs font-normal text-muted-foreground">Show inactive</Label>
                  </div>
                )}
                {canManageCompanies && (
                  <Button size="sm" className="gap-1.5" onClick={() => setCompanyDialog({ mode: "create" })}>
                    <Plus className="h-3.5 w-3.5" /> Add company
                  </Button>
                )}
              </div>
            </div>
            <ul className="divide-y divide-border">
              {visibleCompanies.map((c) => (
                <li key={c.id} className={`flex items-center justify-between gap-3 p-3.5 ${c.isActive ? "" : "opacity-60"}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <CompanyBadge companyId={c.id} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        {!c.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.domain ?? "—"}
                        {c.profile.cin ? ` · CIN ${c.profile.cin}` : ""}
                        {c.profile.gst ? ` · GST ${c.profile.gst}` : ""}
                      </p>
                    </div>
                  </div>
                  {canManageCompanies && (
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCompanyDialog({ mode: "edit", company: c })}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {c.isActive ? (
                            <DropdownMenuItem onClick={() => setArchiveTarget({ company: c, nextActive: false })}>
                              <Archive className="mr-2 h-4 w-4" /> Mark inactive
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setArchiveTarget({ company: c, nextActive: true })}>
                              <ArchiveRestore className="mr-2 h-4 w-4" /> Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteState({ phase: "confirm", company: c })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete permanently
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </li>
              ))}
              {visibleCompanies.length === 0 && (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  {companies.length === 0
                    ? canManageCompanies ? "No companies yet. Add the first one to get started." : "No companies yet. An admin needs to add the first entity."
                    : "All companies are inactive — toggle \"Show inactive\" to see them."}
                </li>
              )}
            </ul>
          </TabsContent>
          <TabsContent value="departments" className="rounded-xl border border-border bg-surface shadow-card">
            <ul className="divide-y divide-border">
              {departments.map((d) => (
                <li key={d.id} className="flex items-center justify-between p-3.5"><span className="text-sm font-medium">{d.name}</span><CompanyBadge companyId={d.companyId} size="xs" /></li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="hours" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <WorkingHoursSection />
          </TabsContent>
          <TabsContent value="holidays" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <HolidaysSection />
          </TabsContent>
          <TabsContent value="pt_slabs" className="rounded-xl border border-border bg-surface shadow-card">
            <PtSlabsTab />
          </TabsContent>
          <TabsContent value="roles" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <ul className="space-y-2 text-sm">
              {["Super Admin","Founder","Founder Office Coordinator","Founder Office Support","Manager","Employee","Intern","HR Admin"].map((r) => (
                <li key={r} className="flex items-center justify-between rounded-md border border-border p-3"><span className="font-medium">{r}</span><span className="text-xs text-muted-foreground">Permissions managed via role config</span></li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="notifications" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <div className="space-y-3">
              {["Due today","Overdue","No update for 1 day","No update for 3 days","Pending approval","Recurring upcoming"].map((n) => (
                <div key={n} className="flex items-center justify-between"><Label>{n}</Label><Switch defaultChecked /></div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="appearance" className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <p className="text-sm text-muted-foreground">Light mode (default). Dark theme available via design tokens.</p>
          </TabsContent>
        </Tabs>
      </div>

      {companyDialog && (
        <CompanyDialog
          open
          onOpenChange={(o) => { if (!o) setCompanyDialog(null); }}
          mode={companyDialog.mode}
          company={companyDialog.company}
          onSaved={() => { void refresh(); }}
        />
      )}

      {/* Mark inactive / Reactivate confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && !busy && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveTarget?.nextActive ? "Reactivate company?" : "Mark company inactive?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.nextActive ? (
                <><span className="font-medium text-foreground">{archiveTarget?.company.name}</span> will reappear in dropdowns and filters. Existing linked data is untouched.</>
              ) : (
                <><span className="font-medium text-foreground">{archiveTarget?.company.name}</span> will be hidden from company selectors but its linked employees, projects, and tasks stay intact. You can reactivate it later.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runArchive} disabled={busy}>
              {archiveTarget?.nextActive ? "Reactivate" : "Mark inactive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete permanently — two phases: confirm, then "blocked" fallback */}
      <AlertDialog open={!!deleteState} onOpenChange={(o) => !o && !busy && setDeleteState(null)}>
        <AlertDialogContent>
          {deleteState?.phase === "confirm" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this company permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="font-medium text-foreground">{deleteState.company.name}</span> will be removed entirely.
                  This is only allowed if no employees, projects, tasks, or chats reference it.
                  Cascading reference data (departments, holidays, bank accounts) is removed automatically.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={runDelete} disabled={busy} className="bg-destructive hover:bg-destructive/90">
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {deleteState?.phase === "blocked" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Can't delete — linked data exists</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      <span className="font-medium text-foreground">{deleteState.company.name}</span> is still referenced by:
                    </p>
                    <ul className="ml-4 list-disc text-sm text-foreground">
                      {Object.entries(deleteState.blockers).map(([key, n]) => (
                        <li key={key}>{n} {BLOCKER_LABELS[key] ?? key}</li>
                      ))}
                    </ul>
                    <p>
                      Mark it inactive instead — it stays out of dropdowns and filters while the linked data is preserved.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Close</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (deleteState?.phase !== "blocked") return;
                    setArchiveTarget({ company: deleteState.company, nextActive: false });
                    setDeleteState(null);
                  }}
                  disabled={busy}
                >
                  Mark inactive instead
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
