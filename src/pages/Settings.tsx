import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { useAuth, can } from "@/lib/auth";
import { Settings as SettingsIcon, Pencil, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompanyBadge } from "@/components/CompanyBadge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { WorkingHoursSection } from "@/pages/settings/WorkingHours";
import { HolidaysSection } from "@/pages/settings/Holidays";
import { CompanyDialog } from "@/components/companies/CompanyDialog";
import type { Company } from "@/types";

// Mail Accounts tab is hidden for v1 alongside the sidebar item — see
// roleNavAccess in src/lib/auth.tsx. Re-add the trigger + TabsContent when
// the mail module is rebuilt on FastAPI.

export default function Settings() {
  const { companies, departments, refresh } = useDataStore();
  const { role } = useAuth();
  const canManageCompanies = role ? can.manageCompanies(role) : false;
  // Company create/edit dialog state — single dialog reused for both flows.
  const [companyDialog, setCompanyDialog] = useState<{ mode: "create" | "edit"; company?: Company } | null>(null);
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
            <div className="flex items-center justify-between border-b border-border p-3.5">
              <p className="text-xs text-muted-foreground">{companies.length} {companies.length === 1 ? "entity" : "entities"} registered</p>
              {canManageCompanies && (
                <Button size="sm" className="gap-1.5" onClick={() => setCompanyDialog({ mode: "create" })}>
                  <Plus className="h-3.5 w-3.5" /> Add company
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border">
              {companies.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <CompanyBadge companyId={c.id} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.domain ?? "—"}
                        {c.profile.cin ? ` · CIN ${c.profile.cin}` : ""}
                        {c.profile.gst ? ` · GST ${c.profile.gst}` : ""}
                      </p>
                    </div>
                  </div>
                  {canManageCompanies && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCompanyDialog({ mode: "edit", company: c })}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </li>
              ))}
              {companies.length === 0 && (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  No companies yet. {canManageCompanies ? "Add the first one to get started." : "An admin needs to add the first entity."}
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
    </div>
  );
}
