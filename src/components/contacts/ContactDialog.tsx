// Create / edit a contact. Capable of creating an organization inline
// when the user types a new org name (auto-create on save).
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useDataStore } from "@/lib/dataStore";
import { useAuth, canEditCategory } from "@/lib/auth";
import type { Contact, ContactCategory, Organization } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";

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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  contact?: Contact;
  organizations: Organization[];
  /** Only categories the current user can VIEW are passed in; the form
   * still re-checks edit permission per category for the Save button. */
  visibleCategories: string[];
  onSaved?: () => void;
};

type FormState = {
  fullName: string;
  category: ContactCategory;
  role: string;
  email: string;
  phone: string;
  organizationId: string;    // "" = none; "__new__" = inline create
  newOrgName: string;        // only used when organizationId === "__new__"
  /** Mirrors organizations.website. Edits here PATCH the linked org on save
   *  so multiple contacts at the same firm share one source of truth. */
  companyWebsite: string;
  /** Mirrors organizations.address — same wire-through as website. */
  companyAddress: string;
  notes: string;
  isActive: boolean;
  companyIds: string[];
};

const blank = (): FormState => ({
  fullName: "", category: "other", role: "", email: "", phone: "",
  organizationId: "", newOrgName: "",
  companyWebsite: "", companyAddress: "",
  notes: "", isActive: true, companyIds: [],
});

const fromContact = (c: Contact, organizations: Organization[]): FormState => {
  const org = c.organizationId ? organizations.find((o) => o.id === c.organizationId) : null;
  return {
    fullName: c.fullName,
    category: c.category,
    role: c.role ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    organizationId: c.organizationId ?? "",
    newOrgName: "",
    companyWebsite: org?.website ?? "",
    companyAddress: org?.address ?? "",
    notes: c.notes ?? "",
    isActive: c.isActive,
    companyIds: [...c.companyIds],
  };
};

export function ContactDialog({ open, onOpenChange, mode, contact, organizations, visibleCategories, onSaved }: Props) {
  const { toast } = useToast();
  const { companies } = useDataStore();
  const { role: myRole } = useAuth();
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && contact ? fromContact(contact, organizations) : blank());
  }, [open, mode, contact, organizations]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((cur) => ({ ...cur, [k]: v }));

  /** Pick a different existing organization → prefill website/address from
   *  that org so the user isn't re-typing what's already on file. */
  const pickOrganization = (v: string) => {
    if (v === "__none__" || v === "__new__") {
      setForm((cur) => ({
        ...cur,
        organizationId: v === "__none__" ? "" : v,
        companyWebsite: "", companyAddress: "",
      }));
      return;
    }
    const org = organizations.find((o) => o.id === v);
    setForm((cur) => ({
      ...cur,
      organizationId: v,
      companyWebsite: org?.website ?? "",
      companyAddress: org?.address ?? "",
    }));
  };

  const allowedCategoryToEdit = myRole && canEditCategory(myRole, form.category);

  const toggleCompany = (id: string) => {
    setForm((cur) => ({
      ...cur,
      companyIds: cur.companyIds.includes(id)
        ? cur.companyIds.filter((c) => c !== id)
        : [...cur.companyIds, id],
    }));
  };

  const submit = async () => {
    if (!form.fullName.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!allowedCategoryToEdit) {
      toast({ title: "Not allowed to edit this category", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Auto-create the organization if the user typed a new one. Capture
      // website + address with the create so the org row is complete on
      // first save instead of needing a follow-up patch.
      let orgId: string | null = form.organizationId || null;
      const websiteClean = form.companyWebsite.trim();
      const addressClean = form.companyAddress.trim();
      if (form.organizationId === "__new__") {
        const name = form.newOrgName.trim();
        if (!name) {
          toast({ title: "Type the new organization's name", variant: "destructive" });
          setSaving(false);
          return;
        }
        const created = await api.createOrganization({
          name,
          website: websiteClean || null,
          address: addressClean || null,
        });
        orgId = (created as any).id;
      } else if (orgId) {
        // Existing org — patch it if the user edited website/address.
        // Multiple contacts at the same firm share this row, so this
        // updates everyone's view simultaneously.
        const currentOrg = organizations.find((o) => o.id === orgId);
        const orgWebsite = currentOrg?.website ?? "";
        const orgAddress = currentOrg?.address ?? "";
        const patch: Record<string, unknown> = {};
        if (websiteClean !== orgWebsite) patch.website = websiteClean || null;
        if (addressClean !== orgAddress) patch.address = addressClean || null;
        if (Object.keys(patch).length > 0) {
          await api.updateOrganization(orgId, patch);
        }
      }

      const payload: Record<string, unknown> = {
        full_name: form.fullName.trim(),
        category: form.category,
        role: form.role.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        organization_id: orgId,
        notes: form.notes.trim() || null,
        is_active: form.isActive,
      };

      if (mode === "create") {
        payload.company_ids = form.companyIds;
        await api.createContact(payload);
        toast({ title: "Contact added", description: form.fullName.trim() });
      } else if (contact) {
        await api.updateContact(contact.id, payload);
        // Sync company links: figure out what changed.
        const prev = new Set(contact.companyIds);
        const next = new Set(form.companyIds);
        const toAdd = [...next].filter((x) => !prev.has(x));
        const toRemove = [...prev].filter((x) => !next.has(x));
        await Promise.all([
          ...toAdd.map((cid) => api.linkContactCompany(contact.id, cid)),
          ...toRemove.map((cid) => api.unlinkContactCompany(contact.id, cid)),
        ]);
        toast({ title: "Contact updated", description: form.fullName.trim() });
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
      <DialogContent className="max-h-[90vh] flex flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add contact" : `Edit ${contact?.fullName ?? "contact"}`}</DialogTitle>
          <DialogDescription>
            Shared directory entry. Linked group entities decide whose company
            page surfaces this contact.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="cn-name">Full name *</Label>
              <Input id="cn-name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="A. Sharma" />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="cn-cat">Category *</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v as ContactCategory)}>
                <SelectTrigger id="cn-cat"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_GROUPS
                    .map((g) => ({ ...g, categories: g.categories.filter((c) => visibleCategories.includes(c.value)) }))
                    .filter((g) => g.categories.length > 0)
                    .map((g) => (
                      <div key={g.label}>
                        <div className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                        {g.categories.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </div>
                    ))}
                </SelectContent>
              </Select>
              {!allowedCategoryToEdit && (
                <p className="text-[11px] text-destructive">You cannot edit this category — pick another or ask founder office.</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="cn-role">Designation / role</Label>
              <Input id="cn-role" value={form.role} onChange={(e) => set("role", e.target.value)} placeholder="Senior Partner" />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="cn-email">Email</Label>
              <Input id="cn-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@firm.com" />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="cn-phone">Phone</Label>
              <Input id="cn-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 …" />
            </div>

            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="cn-org">Organization (firm / company)</Label>
              <Select value={form.organizationId || "__none__"} onValueChange={pickOrganization}>
                <SelectTrigger id="cn-org"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  <SelectItem value="__new__">+ New organization…</SelectItem>
                  {organizations.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.organizationId === "__new__" && (
                <Input
                  value={form.newOrgName}
                  onChange={(e) => set("newOrgName", e.target.value)}
                  placeholder="New organization name"
                  className="mt-1"
                />
              )}
            </div>

            {(form.organizationId && form.organizationId !== "__none__") && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="cn-cwebsite">Company website</Label>
                  <Input
                    id="cn-cwebsite"
                    type="url"
                    value={form.companyWebsite}
                    onChange={(e) => set("companyWebsite", e.target.value)}
                    placeholder="https://firm.com"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cn-caddress">Company address</Label>
                  <Input
                    id="cn-caddress"
                    value={form.companyAddress}
                    onChange={(e) => set("companyAddress", e.target.value)}
                    placeholder="Street, City"
                  />
                </div>
                <p className="col-span-2 -mt-1 text-[11px] text-muted-foreground">
                  Saved on the organization — other contacts at the same firm
                  will see the same address and website.
                </p>
              </>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Linked to these group entities</Label>
            <div className="flex flex-wrap gap-1.5">
              {companies.map((c) => {
                const active = form.companyIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCompany(c.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-muted-foreground hover:border-foreground"
                    }`}
                  >
                    {c.shortName || c.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              The same person can serve multiple group entities — click each that applies.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cn-notes">Notes</Label>
            <Textarea id="cn-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Best contact times, areas of expertise, history…" />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="cn-active"
              type="checkbox"
              className="h-4 w-4"
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
            />
            <Label htmlFor="cn-active" className="text-sm font-normal">Contact is active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !allowedCategoryToEdit}>
            {saving ? "Saving…" : mode === "create" ? "Add contact" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
