import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useDataStore } from "@/lib/dataStore";
import { useAuth, can, canViewCategory, canEditCategory, visibleCategories } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { mapContact, mapOrganization } from "@/lib/mappers";
import { useToast } from "@/hooks/use-toast";
import type { Contact, ContactCategory, Organization } from "@/types";
import { BookUser, UserPlus, Pencil, Trash2, Building2, Mail, Phone, Upload, Download, Globe, MapPin } from "lucide-react";
import { ContactDialog } from "@/components/contacts/ContactDialog";
import { ContactsImportDialog, downloadContactsTemplate } from "@/components/contacts/ContactsImportDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

// Category groups for the filter dropdown — same order/grouping as the
// access matrix in src/lib/auth.tsx and backend authz.py.
const CATEGORY_GROUPS: { label: string; categories: { value: ContactCategory; label: string }[] }[] = [
  { label: "Compliance", categories: [
    { value: "ca",            label: "CA" },
    { value: "cs",            label: "Company Secretary" },
    { value: "auditor",       label: "Statutory auditor" },
    { value: "lawyer",        label: "Lawyer" },
    { value: "banker",        label: "Banker / RM" },
    { value: "insurance",     label: "Insurance agent" },
    { value: "investor",      label: "Investor / shareholder" },
    { value: "govt_official", label: "Government official" },
  ]},
  { label: "Business", categories: [
    { value: "client_poc",      label: "Client POC" },
    { value: "vendor_poc",      label: "Vendor POC" },
    { value: "channel_partner", label: "Channel partner" },
    { value: "collaborator",    label: "Collaborator" },
    { value: "advisor",         label: "Advisor" },
    { value: "mentor",          label: "Mentor" },
    { value: "press",           label: "Press / PR" },
    { value: "industry_body",   label: "Industry body" },
  ]},
  { label: "Recruitment", categories: [
    { value: "college",            label: "College" },
    { value: "tpo",                label: "TPO" },
    { value: "training_institute", label: "Training institute" },
    { value: "recruitment_agency", label: "Recruitment agency" },
  ]},
  { label: "IT / Vendor", categories: [
    { value: "domain_registrar", label: "Domain registrar" },
    { value: "hosting_saas",     label: "Hosting / SaaS" },
    { value: "agency",           label: "Agency / consultant" },
  ]},
  { label: "Other", categories: [
    { value: "other", label: "Other" },
  ]},
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => [c.value, c.label]))
);

export default function Contacts() {
  const { role: myRole } = useAuth();
  const { companies, getCompany } = useDataStore();
  const { toast } = useToast();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState<string>("all");
  const [company, setCompany] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editTarget, setEditTarget] = useState<Contact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const canCreateAny = myRole ? can.editContacts(myRole) : false;
  const myVisibleCats = myRole ? visibleCategories(myRole) : [];

  const refresh = async () => {
    setLoading(true);
    try {
      const [cRows, oRows] = await Promise.all([
        api.listContacts({
          category: category === "all" ? undefined : category,
          companyId: company === "all" ? undefined : company,
          search: search.trim() || undefined,
        }),
        api.listOrganizations(),
      ]);
      setContacts(cRows.map(mapContact));
      setOrgs(oRows.map(mapOrganization));
    } catch (e) {
      toast({
        title: "Couldn't load contacts",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, company]);

  // Debounce search a touch so we don't fetch on every keystroke
  useEffect(() => {
    const t = setTimeout(() => { void refresh(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filteredGroups = useMemo(
    () => CATEGORY_GROUPS
      .map((g) => ({
        ...g,
        categories: g.categories.filter((c) => myRole && canViewCategory(myRole, c.value)),
      }))
      .filter((g) => g.categories.length > 0),
    [myRole]
  );

  const orgsById = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o])), [orgs]);

  const openCreate = () => {
    setDialogMode("create");
    setEditTarget(null);
    setDialogOpen(true);
  };
  const openEdit = (c: Contact) => {
    setDialogMode("edit");
    setEditTarget(c);
    setDialogOpen(true);
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteContact(deleteTarget.id);
      toast({ title: "Contact deleted", description: deleteTarget.fullName });
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      toast({
        title: "Couldn't delete",
        description: e instanceof ApiError ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Shared directory of CAs, bankers, clients, vendors, colleges, and more — linked to one or many group entities."
        icon={<BookUser className="h-5 w-5" />}
        actions={
          canCreateAny && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={downloadContactsTemplate} className="gap-1.5"
                      title="Download the Excel template with the right column names + a sample row">
                <Download className="h-4 w-4" /> Download format
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
                <Upload className="h-4 w-4" /> Import from Excel
              </Button>
              <Button size="sm" onClick={openCreate} className="gap-1.5">
                <UserPlus className="h-4 w-4" /> Add contact
              </Button>
            </div>
          )
        }
      />

      <div className="space-y-4 p-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {filteredGroups.map((g) => (
                <div key={g.label}>
                  <div className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                  {g.categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>

          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="All companies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.shortName || c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-[260px]"
          />
        </div>

        {loading && contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : contacts.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
            {canCreateAny && (
              <Button size="sm" variant="outline" onClick={openCreate} className="mt-3 gap-1.5">
                <UserPlus className="h-4 w-4" /> Add the first contact
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((c) => {
              const editable = myRole ? canEditCategory(myRole, c.category) : false;
              const org = c.organizationId ? orgsById[c.organizationId] : null;
              return (
                <div key={c.id} className="rounded-lg border bg-surface p-3 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-medium">{c.fullName}</p>
                        {!c.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {c.role && <>{c.role}{org && " · "}</>}
                        {org && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{org.name}</span>}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-[10px]">
                      {CATEGORY_LABELS[c.category] ?? c.category}
                    </Badge>
                  </div>

                  <div className="mt-2 space-y-0.5 text-xs">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                        <Mail className="h-3 w-3" /> {c.email}
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                        <Phone className="h-3 w-3" /> {c.phone}
                      </a>
                    )}
                    {org?.website && (
                      <a
                        href={/^https?:\/\//i.test(org.website) ? org.website : `https://${org.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        <span className="truncate">{org.website}</span>
                      </a>
                    )}
                    {org?.address && (
                      <p className="flex items-start gap-1.5 text-muted-foreground">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="line-clamp-2">{org.address}</span>
                      </p>
                    )}
                  </div>

                  {c.companyIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.companyIds.map((cid) => {
                        const co = getCompany(cid);
                        if (!co) return null;
                        return (
                          <Badge key={cid} variant="outline" className="text-[10px]">
                            {co.shortName || co.name}
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  {editable && (
                    <div className="mt-2 flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => openEdit(c)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(c)}>
                        <Trash2 className="h-3 w-3" /> Delete
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ContactDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        contact={editTarget ?? undefined}
        organizations={orgs}
        visibleCategories={myVisibleCats}
        onSaved={() => { void refresh(); }}
      />

      <ContactsImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => { void refresh(); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.fullName} and all their company links will be removed.
              The activity log stays for audit. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
