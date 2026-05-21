// get-mail-credentials — service-to-service only.
// Used by the Node mail-worker to fetch IMAP/SMTP creds for an account.
// Authenticates with the shared KIRON_TO_NODE_API_KEY (the same key Node uses
// when calling Kiron — it's a symmetric machine-to-machine secret).
import { corsHeaders, json, serviceClient } from "../_shared/mail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("KIRON_TO_NODE_API_KEY") ?? ""}`;
  if (!expected || auth !== expected) {
    return json({ error: "Forbidden" }, 403);
  }

  const body = await req.json().catch(() => null) as { account_id?: string } | null;
  if (!body?.account_id) return json({ error: "Missing account_id" }, 400);

  const svc = serviceClient();
  const [{ data: acct }, { data: creds }] = await Promise.all([
    svc.from("email_accounts").select("*").eq("id", body.account_id).maybeSingle(),
    svc.from("email_account_credentials").select("*").eq("account_id", body.account_id).maybeSingle(),
  ]);

  if (!acct || !creds) return json({ error: "Not found" }, 404);
  return json({ account: acct, imap_password: creds.imap_password, smtp_password: creds.smtp_password });
});
