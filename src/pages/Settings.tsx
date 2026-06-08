import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { Settings as SettingsIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompanyBadge } from "@/components/CompanyBadge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { WorkingHoursSection } from "@/pages/settings/WorkingHours";
import { HolidaysSection } from "@/pages/settings/Holidays";

// Mail Accounts tab is hidden for v1 alongside the sidebar item — see
// roleNavAccess in src/lib/auth.tsx. Re-add the trigger + TabsContent when
// the mail module is rebuilt on FastAPI.

export default function Settings() {
  const { companies, departments } = useDataStore();
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
            <p className="mt-1 text-sm text-muted-foreground">Kiron Group · 14 companies · 30+ employees</p>
          </TabsContent>
          <TabsContent value="companies" className="rounded-xl border border-border bg-surface shadow-card">
            <ul className="divide-y divide-border">
              {companies.map((c) => (
                <li key={c.id} className="flex items-center justify-between p-3.5"><CompanyBadge companyId={c.id} /><span className="text-xs text-muted-foreground">{c.name}</span></li>
              ))}
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
    </div>
  );
}
