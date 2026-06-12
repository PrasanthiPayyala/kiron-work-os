// Create / edit a company profile. Used from Settings > Companies by anyone
// with `can.manageCompanies` (super_admin / founder / founder_office_coordinator
// / hr_admin).
//
// The dialog is tall — a full entity profile has ~25 fields across 5 tabs.
// Header + footer stay pinned; only the tab body scrolls so Save is always
// reachable (same pattern as UserDialog).
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { Company, Director } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, X } from "lucide-react";

// ---------- Repeatable string list (URLs, addresses, phones, certificates) ----------
function MultiInput({
  label, values, placeholder, onChange, inputType = "text",
}: {
  label: string;
  values: string[];
  placeholder?: string;
  onChange: (next: string[]) => void;
  inputType?: "text" | "tel" | "url";
}) {
  const update = (idx: number, val: string) => {
    const next = [...values];
    next[idx] = val;
    onChange(next);
  };
  const remove = (idx: number) => onChange(values.filter((_, i) => i !== idx));
  const add = () => onChange([...values, ""]);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="space-y-1.5">
        {values.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground">None added yet.</p>
        )}
        {values.map((v, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              type={inputType}
              value={v}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => remove(i)}
              aria-label="Remove"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}

// ---------- Directors (name + designation + optional DIN) ----------
function DirectorList({
  values, onChange,
}: {
  values: Director[];
  onChange: (next: Director[]) => void;
}) {
  const update = (idx: number, patch: Partial<Director>) => {
    const next = values.map((d, i) => i === idx ? { ...d, ...patch } : d);
    onChange(next);
  };
  const remove = (idx: number) => onChange(values.filter((_, i) => i !== idx));
  const add = () => onChange([...values, { name: "", designation: "", din: null }]);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Directors</Label>
      <div className="space-y-2">
        {values.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground">No directors added yet.</p>
        )}
        {values.map((d, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto] gap-1.5">
            <Input
              value={d.name}
              placeholder="Director name"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <Input
              value={d.designation}
              placeholder="Designation"
              onChange={(e) => update(i, { designation: e.target.value })}
            />
            <Input
              value={d.din ?? ""}
              placeholder="DIN (optional)"
              onChange={(e) => update(i, { din: e.target.value || null })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              onClick={() => remove(i)}
              aria-label="Remove director"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add director
      </Button>
    </div>
  );
}

// ---------- Local form state ----------
type FormState = {
  name: string;
  shortName: string;
  initials: string;
  color: string;
  domain: string;
  code: string;
  logoUrl: string;
  isActive: boolean;
  // Basics extras
  websiteUrls: string[];
  websiteTechnologies: string;
  natureOfBusiness: string;
  dateOfIncorporation: string;
  isStartup: boolean;
  // Registration
  cin: string;
  gst: string;
  pan: string;
  tan: string;
  tin: string;
  msmeUdyamNumber: string;
  msmeUdyamMobile: string;
  msmeUdyamEmail: string;
  dpiitStartupNumber: string;
  // Addresses + phones
  registeredAddress: string;
  corporateAddresses: string[];
  operationsAddresses: string[];
  phoneNumbers: string[];
  // Directors
  directors: Director[];
  kiranDesignation: string;
  prashantiDesignation: string;
  // Compliance
  certificates: string[];
  managingCaName: string;
  managingCaPhone: string;
  managingCaEmail: string;
  caDocumentsHeld: string[];
};

const blank = (): FormState => ({
  name: "", shortName: "", initials: "", color: "", domain: "", code: "",
  logoUrl: "", isActive: true,
  websiteUrls: [], websiteTechnologies: "", natureOfBusiness: "",
  dateOfIncorporation: "", isStartup: false,
  cin: "", gst: "", pan: "", tan: "", tin: "",
  msmeUdyamNumber: "", msmeUdyamMobile: "", msmeUdyamEmail: "",
  dpiitStartupNumber: "",
  registeredAddress: "",
  corporateAddresses: [], operationsAddresses: [], phoneNumbers: [],
  directors: [], kiranDesignation: "", prashantiDesignation: "",
  certificates: [],
  managingCaName: "", managingCaPhone: "", managingCaEmail: "",
  caDocumentsHeld: [],
});

const fromCompany = (c: Company): FormState => ({
  name: c.name,
  shortName: c.shortName,
  initials: c.initials,
  color: c.color,
  domain: c.domain ?? "",
  code: c.code ?? "",
  logoUrl: c.logoUrl ?? "",
  isActive: c.isActive,
  websiteUrls: c.profile.websiteUrls,
  websiteTechnologies: c.profile.websiteTechnologies ?? "",
  natureOfBusiness: c.profile.natureOfBusiness ?? "",
  dateOfIncorporation: c.profile.dateOfIncorporation ?? "",
  isStartup: c.profile.isStartup,
  cin: c.profile.cin ?? "",
  gst: c.profile.gst ?? "",
  pan: c.profile.pan ?? "",
  tan: c.profile.tan ?? "",
  tin: c.profile.tin ?? "",
  msmeUdyamNumber: c.profile.msmeUdyamNumber ?? "",
  msmeUdyamMobile: c.profile.msmeUdyamMobile ?? "",
  msmeUdyamEmail: c.profile.msmeUdyamEmail ?? "",
  dpiitStartupNumber: c.profile.dpiitStartupNumber ?? "",
  registeredAddress: c.profile.registeredAddress ?? "",
  corporateAddresses: c.profile.corporateAddresses,
  operationsAddresses: c.profile.operationsAddresses,
  phoneNumbers: c.profile.phoneNumbers,
  directors: c.profile.directors,
  kiranDesignation: c.profile.kiranDesignation ?? "",
  prashantiDesignation: c.profile.prashantiDesignation ?? "",
  certificates: c.profile.certificates,
  managingCaName: c.profile.managingCaName ?? "",
  managingCaPhone: c.profile.managingCaPhone ?? "",
  managingCaEmail: c.profile.managingCaEmail ?? "",
  caDocumentsHeld: c.profile.caDocumentsHeld,
});

/** Strip empty values from the form so the backend can NULL them, and
 * convert camelCase keys to the snake_case the API expects. */
function toPayload(f: FormState): Record<string, unknown> {
  // Trim empty strings out of multi lists so we don't persist blank rows.
  const cleanList = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);
  const cleanDirs = (xs: Director[]) =>
    xs
      .map((d) => ({
        name: d.name.trim(),
        designation: d.designation.trim(),
        din: d.din?.trim() || null,
      }))
      .filter((d) => d.name || d.designation);
  return {
    name: f.name.trim(),
    short_name: f.shortName.trim() || null,
    initials: f.initials.trim() || null,
    color: f.color.trim() || null,
    domain: f.domain.trim() || null,
    code: f.code.trim() || null,
    logo_url: f.logoUrl.trim() || null,
    is_active: f.isActive,
    website_urls: cleanList(f.websiteUrls),
    website_technologies: f.websiteTechnologies.trim() || null,
    nature_of_business: f.natureOfBusiness.trim() || null,
    date_of_incorporation: f.dateOfIncorporation || null,
    is_startup: f.isStartup,
    cin: f.cin.trim() || null,
    gst: f.gst.trim() || null,
    pan: f.pan.trim() || null,
    tan: f.tan.trim() || null,
    tin: f.tin.trim() || null,
    msme_udyam_number: f.msmeUdyamNumber.trim() || null,
    msme_udyam_mobile: f.msmeUdyamMobile.trim() || null,
    msme_udyam_email: f.msmeUdyamEmail.trim() || null,
    dpiit_startup_number: f.dpiitStartupNumber.trim() || null,
    registered_address: f.registeredAddress.trim() || null,
    corporate_addresses: cleanList(f.corporateAddresses),
    operations_addresses: cleanList(f.operationsAddresses),
    phone_numbers: cleanList(f.phoneNumbers),
    directors: cleanDirs(f.directors),
    kiran_designation: f.kiranDesignation.trim() || null,
    prashanti_designation: f.prashantiDesignation.trim() || null,
    certificates: cleanList(f.certificates),
    managing_ca_name: f.managingCaName.trim() || null,
    managing_ca_phone: f.managingCaPhone.trim() || null,
    managing_ca_email: f.managingCaEmail.trim() || null,
    ca_documents_held: cleanList(f.caDocumentsHeld),
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  company?: Company;     // required for edit
  onSaved?: () => void;
};

export function CompanyDialog({ open, onOpenChange, mode, company, onSaved }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && company ? fromCompany(company) : blank());
  }, [open, mode, company]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((cur) => ({ ...cur, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (mode === "create") {
        await api.createCompany(payload as { name: string });
        toast({ title: "Company created", description: form.name.trim() });
      } else if (company) {
        await api.updateCompany(company.id, payload);
        toast({ title: "Company updated", description: form.name.trim() });
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
      <DialogContent className="max-h-[92vh] flex flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add company" : `Edit ${company?.shortName ?? company?.name ?? "company"}`}</DialogTitle>
          <DialogDescription>
            Capture the entity profile — registration, addresses, directors, and compliance.
            Only the name is required; everything else can be filled in over time.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="registration">Registration</TabsTrigger>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
          </TabsList>

          {/* The body is the scrollable region. min-h-0 + overflow-y-auto is
              the standard flex-child scroll recipe (UserDialog uses the same). */}
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
            <TabsContent value="basics" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-name">Full legal name *</Label>
                  <Input id="cd-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Innomax IT Solutions Pvt Ltd" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-short">Short name (badge)</Label>
                  <Input id="cd-short" value={form.shortName} onChange={(e) => set("shortName", e.target.value)} placeholder="Innomax IT" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-ini">Initials</Label>
                  <Input id="cd-ini" maxLength={3} value={form.initials} onChange={(e) => set("initials", e.target.value.toUpperCase())} placeholder="II" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-code">Code</Label>
                  <Input id="cd-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="INNO-IT" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-color">Color (HSL token)</Label>
                  <Input id="cd-color" value={form.color} onChange={(e) => set("color", e.target.value)} placeholder="210 50% 50%" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-domain">Email domain</Label>
                  <Input id="cd-domain" value={form.domain} onChange={(e) => set("domain", e.target.value)} placeholder="innomaxsol.com" />
                </div>
                <div className="grid gap-1.5 col-span-2">
                  <Label htmlFor="cd-logo">Logo URL</Label>
                  <Input id="cd-logo" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://..." />
                </div>
              </div>

              <MultiInput
                label="Website URLs"
                values={form.websiteUrls}
                placeholder="https://example.com"
                onChange={(v) => set("websiteUrls", v)}
                inputType="url"
              />

              <div className="grid gap-1.5">
                <Label htmlFor="cd-techs">Website technologies</Label>
                <Input id="cd-techs" value={form.websiteTechnologies} onChange={(e) => set("websiteTechnologies", e.target.value)} placeholder="React, Next.js, PostgreSQL" />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cd-nature">Nature of business</Label>
                <Textarea id="cd-nature" value={form.natureOfBusiness} onChange={(e) => set("natureOfBusiness", e.target.value)} placeholder="Software services and product development" rows={2} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-doi">Date of incorporation</Label>
                  <Input id="cd-doi" type="date" value={form.dateOfIncorporation} onChange={(e) => set("dateOfIncorporation", e.target.value)} />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <input
                    id="cd-startup"
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.isStartup}
                    onChange={(e) => set("isStartup", e.target.checked)}
                  />
                  <Label htmlFor="cd-startup" className="text-sm font-normal">Recognised StartUp</Label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="cd-active"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.isActive}
                  onChange={(e) => set("isActive", e.target.checked)}
                />
                <Label htmlFor="cd-active" className="text-sm font-normal">Company is active</Label>
              </div>
            </TabsContent>

            <TabsContent value="registration" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-cin">CIN</Label>
                  <Input id="cd-cin" value={form.cin} onChange={(e) => set("cin", e.target.value.toUpperCase())} placeholder="U72900AP2018PTC108XXX" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-gst">GST</Label>
                  <Input id="cd-gst" value={form.gst} onChange={(e) => set("gst", e.target.value.toUpperCase())} placeholder="37AAFCS1234A1Z5" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-pan">PAN</Label>
                  <Input id="cd-pan" value={form.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} placeholder="AAFCS1234A" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-tan">TAN</Label>
                  <Input id="cd-tan" value={form.tan} onChange={(e) => set("tan", e.target.value.toUpperCase())} placeholder="HYDS12345A" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-tin">TIN</Label>
                  <Input id="cd-tin" value={form.tin} onChange={(e) => set("tin", e.target.value)} placeholder="If applicable" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-msme">MSME / Udyam number</Label>
                  <Input id="cd-msme" value={form.msmeUdyamNumber} onChange={(e) => set("msmeUdyamNumber", e.target.value)} placeholder="UDYAM-AP-XX-0001234" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-msme-mob">Udyam mobile</Label>
                  <Input id="cd-msme-mob" type="tel" value={form.msmeUdyamMobile} onChange={(e) => set("msmeUdyamMobile", e.target.value)} placeholder="+91 ..." />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-msme-em">Udyam email</Label>
                  <Input id="cd-msme-em" type="email" value={form.msmeUdyamEmail} onChange={(e) => set("msmeUdyamEmail", e.target.value)} placeholder="contact@example.com" />
                </div>
                <div className="grid gap-1.5 col-span-2">
                  <Label htmlFor="cd-dpiit">DPIIT StartUp registration number</Label>
                  <Input id="cd-dpiit" value={form.dpiitStartupNumber} onChange={(e) => set("dpiitStartupNumber", e.target.value)} placeholder="DIPP12345" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="addresses" className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cd-reg-addr">Registered address</Label>
                <Textarea id="cd-reg-addr" rows={3} value={form.registeredAddress} onChange={(e) => set("registeredAddress", e.target.value)} placeholder="Door no, street, city, state, PIN" />
              </div>
              <MultiInput
                label="Corporate addresses"
                values={form.corporateAddresses}
                placeholder="Office address — one per row"
                onChange={(v) => set("corporateAddresses", v)}
              />
              <MultiInput
                label="Operations addresses"
                values={form.operationsAddresses}
                placeholder="Operations site — one per row"
                onChange={(v) => set("operationsAddresses", v)}
              />
              <MultiInput
                label="Phone numbers"
                values={form.phoneNumbers}
                placeholder="+91 ..."
                onChange={(v) => set("phoneNumbers", v)}
                inputType="tel"
              />
            </TabsContent>

            <TabsContent value="people" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-kiran">Designation — Kiran Babu</Label>
                  <Input id="cd-kiran" value={form.kiranDesignation} onChange={(e) => set("kiranDesignation", e.target.value)} placeholder="Director / Promoter" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-pras">Designation — Prashanti</Label>
                  <Input id="cd-pras" value={form.prashantiDesignation} onChange={(e) => set("prashantiDesignation", e.target.value)} placeholder="Founder & CEO" />
                </div>
              </div>
              <DirectorList values={form.directors} onChange={(v) => set("directors", v)} />
            </TabsContent>

            <TabsContent value="compliance" className="space-y-3">
              <MultiInput
                label="Certificates available"
                values={form.certificates}
                placeholder="ISO 9001, ISMS, etc."
                onChange={(v) => set("certificates", v)}
              />
              <div className="rounded-md border border-border bg-surface-muted/40 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Managing CA</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="cd-ca-name">CA name</Label>
                    <Input id="cd-ca-name" value={form.managingCaName} onChange={(e) => set("managingCaName", e.target.value)} placeholder="CA firm or individual" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cd-ca-phone">CA phone</Label>
                    <Input id="cd-ca-phone" type="tel" value={form.managingCaPhone} onChange={(e) => set("managingCaPhone", e.target.value)} placeholder="+91 ..." />
                  </div>
                  <div className="grid gap-1.5 col-span-2">
                    <Label htmlFor="cd-ca-email">CA email</Label>
                    <Input id="cd-ca-email" type="email" value={form.managingCaEmail} onChange={(e) => set("managingCaEmail", e.target.value)} placeholder="ca@example.com" />
                  </div>
                </div>
                <MultiInput
                  label="Documents held by the CA"
                  values={form.caDocumentsHeld}
                  placeholder="DSC, MOA, AOA, etc."
                  onChange={(v) => set("caDocumentsHeld", v)}
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create company" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
