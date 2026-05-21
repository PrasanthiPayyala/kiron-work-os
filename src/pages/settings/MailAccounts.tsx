import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { mailApi } from "@/lib/mail/api";
import { useDataStore } from "@/lib/dataStore";
import { toast } from "sonner";
import { Plus, Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";
import type { EmailAccount } from "@/lib/mail/types";

export function MailAccountsSection() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("email_accounts").select("*").order("created_at");
    setAccounts((data ?? []) as EmailAccount[]);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-semibold">Mail accounts</h3>
          <p className="text-xs text-muted-foreground">Connect IMAP/SMTP mailboxes for use inside Kiron Mail.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Add account</Button>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <Mail className="mx-auto mb-2 h-6 w-6 opacity-40" /> No mailboxes yet.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3">
              <div className={`h-2 w-2 rounded-full ${a.status === "connected" ? "bg-emerald-500" : a.status === "failed" ? "bg-red-500" : "bg-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.display_name}</p>
                <p className="truncate text-xs text-muted-foreground">{a.email} · IMAP {a.imap_host}:{a.imap_port} · SMTP {a.smtp_host}:{a.smtp_port}</p>
              </div>
              <span className="text-xs text-muted-foreground capitalize">{a.status}</span>
            </li>
          ))}
        </ul>
      )}

      <AddMailAccountDialog open={open} onOpenChange={setOpen} onSaved={load} />
    </div>
  );
}

function AddMailAccountDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { companies } = useDataStore();
  const [form, setForm] = useState<any>({
    display_name: "", email: "",
    imap_host: "", imap_port: 993, imap_encryption: "ssl", imap_username: "", imap_password: "",
    smtp_host: "", smtp_port: 465, smtp_encryption: "ssl", smtp_username: "", smtp_password: "",
    company_id: "", is_shared: false, sync_enabled: true, sync_interval_min: 5, default_sender_name: "",
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ imap?: boolean; smtp?: boolean; error?: string } | null>(null);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    const { data, error } = await mailApi.testConnection(form);
    setTesting(false);
    if (error) { setTestResult({ error: error.message }); return; }
    setTestResult(data ?? { error: "No response" });
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, company_id: form.company_id || null };
    const { error } = await mailApi.saveAccount(payload);
    setSaving(false);
    if (error) { toast.error("Save failed", { description: error.message }); return; }
    toast.success("Mailbox added — initial sync started");
    onSaved(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add mail account</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Display name"><Input value={form.display_name} onChange={(e) => set("display_name", e.target.value)} /></Field>
          <Field label="Email address"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Default sender name"><Input value={form.default_sender_name} onChange={(e) => set("default_sender_name", e.target.value)} /></Field>
          <Field label="Company (optional)">
            <Select value={form.company_id} onValueChange={(v) => set("company_id", v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <div className="col-span-2 mt-2 border-t border-border pt-3"><p className="text-xs font-semibold uppercase text-muted-foreground">IMAP (incoming)</p></div>
          <Field label="IMAP host"><Input value={form.imap_host} onChange={(e) => set("imap_host", e.target.value)} placeholder="imap.example.com" /></Field>
          <Field label="IMAP port"><Input type="number" value={form.imap_port} onChange={(e) => set("imap_port", +e.target.value)} /></Field>
          <Field label="Encryption">
            <Select value={form.imap_encryption} onValueChange={(v) => set("imap_encryption", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ssl">SSL</SelectItem><SelectItem value="tls">TLS</SelectItem>
                <SelectItem value="starttls">STARTTLS</SelectItem><SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="IMAP username"><Input value={form.imap_username} onChange={(e) => set("imap_username", e.target.value)} /></Field>
          <Field label="IMAP password"><Input type="password" value={form.imap_password} onChange={(e) => set("imap_password", e.target.value)} /></Field>

          <div className="col-span-2 mt-2 border-t border-border pt-3"><p className="text-xs font-semibold uppercase text-muted-foreground">SMTP (outgoing)</p></div>
          <Field label="SMTP host"><Input value={form.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.example.com" /></Field>
          <Field label="SMTP port"><Input type="number" value={form.smtp_port} onChange={(e) => set("smtp_port", +e.target.value)} /></Field>
          <Field label="Encryption">
            <Select value={form.smtp_encryption} onValueChange={(v) => set("smtp_encryption", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ssl">SSL</SelectItem><SelectItem value="tls">TLS</SelectItem>
                <SelectItem value="starttls">STARTTLS</SelectItem><SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="SMTP username"><Input value={form.smtp_username} onChange={(e) => set("smtp_username", e.target.value)} /></Field>
          <Field label="SMTP password"><Input type="password" value={form.smtp_password} onChange={(e) => set("smtp_password", e.target.value)} /></Field>

          <div className="col-span-2 mt-2 flex items-center gap-6 border-t border-border pt-3">
            <div className="flex items-center gap-2"><Switch checked={form.is_shared} onCheckedChange={(v) => set("is_shared", v)} /><Label className="text-xs">Shared mailbox</Label></div>
            <div className="flex items-center gap-2"><Switch checked={form.sync_enabled} onCheckedChange={(v) => set("sync_enabled", v)} /><Label className="text-xs">Sync enabled</Label></div>
            <Field label="Sync interval (min)" className="!flex-row items-center gap-2">
              <Input type="number" className="h-8 w-20" value={form.sync_interval_min} onChange={(e) => set("sync_interval_min", +e.target.value)} />
            </Field>
          </div>

          {testResult && (
            <div className="col-span-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
              {testResult.error ? (
                <p className="flex items-center gap-1.5 text-destructive"><XCircle className="h-3.5 w-3.5" />{testResult.error}</p>
              ) : (
                <>
                  <p className="flex items-center gap-1.5">{testResult.imap ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />} IMAP</p>
                  <p className="flex items-center gap-1.5">{testResult.smtp ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />} SMTP</p>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Test connection
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save mailbox
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
