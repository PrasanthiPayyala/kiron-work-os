// save-mail-account — creates or updates an email_accounts row AND stores
// IMAP/SMTP passwords in the private email_account_credentials table
// (RLS-on, no policies → only service role can read/write).
import { corsHeaders, json, requireUser, serviceClient, callNode } from "../_shared/mail.ts";

interface SaveBody {
  id?: string; // present for update
  display_name: string;
  email: string;
  owner_user_id?: string;
  company_id?: string | null;
  is_shared?: boolean;
  imap_host: string;
  imap_port: number;
  imap_encryption: "ssl" | "tls" | "starttls" | "none";
  imap_username: string;
  imap_password?: string; // only required on create or when rotating
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: "ssl" | "tls" | "starttls" | "none";
  smtp_username: string;
  smtp_password?: string;
  default_sender_name?: string;
  sync_enabled?: boolean;
  sync_interval_min?: number;
  is_active?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as SaveBody | null;
  if (!body) return json({ error: "Invalid body" }, 400);

  const svc = serviceClient();
  const ownerId = body.owner_user_id ?? auth.user.id;

  // Permission check: only super_admin/founder/hr_admin can create accounts for others.
  if (ownerId !== auth.user.id) {
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", auth.user.id);
    const elevated = (roles ?? []).some((r: any) =>
      ["super_admin", "founder", "hr_admin"].includes(r.role));
    if (!elevated) return json({ error: "Cannot create mailbox for another user" }, 403);
  }

  const accountRow = {
    display_name: body.display_name,
    email: body.email,
    owner_user_id: ownerId,
    company_id: body.company_id ?? null,
    is_shared: body.is_shared ?? false,
    imap_host: body.imap_host,
    imap_port: body.imap_port,
    imap_encryption: body.imap_encryption,
    imap_username: body.imap_username,
    smtp_host: body.smtp_host,
    smtp_port: body.smtp_port,
    smtp_encryption: body.smtp_encryption,
    smtp_username: body.smtp_username,
    default_sender_name: body.default_sender_name ?? null,
    sync_enabled: body.sync_enabled ?? true,
    sync_interval_min: body.sync_interval_min ?? 5,
    is_active: body.is_active ?? true,
    status: "pending" as const,
    created_by: auth.user.id,
  };

  let accountId = body.id;
  if (accountId) {
    const { error } = await svc.from("email_accounts").update(accountRow).eq("id", accountId);
    if (error) return json({ error: error.message }, 400);
  } else {
    const { data, error } = await svc.from("email_accounts").insert(accountRow).select("id").single();
    if (error) return json({ error: error.message }, 400);
    accountId = data.id;
  }

  // Store / rotate credentials only when provided.
  if (body.imap_password || body.smtp_password) {
    const imap_pw = body.imap_password ?? "";
    const smtp_pw = body.smtp_password ?? imap_pw;
    const { error: credErr } = await svc.from("email_account_credentials").upsert({
      account_id: accountId,
      imap_password: imap_pw,
      smtp_password: smtp_pw,
    });
    if (credErr) return json({ error: credErr.message }, 400);
  }

  // Kick off initial sync via Node (last 30 days, INBOX + Sent).
  await callNode("/v1/mail/initial-sync", { account_id: accountId }, auth.user.id).catch(() => {});

  return json({ ok: true, account_id: accountId });
});
