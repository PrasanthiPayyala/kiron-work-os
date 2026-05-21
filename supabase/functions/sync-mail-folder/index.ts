// sync-mail-folder — asks Node to refresh a specific folder right now.
import { corsHeaders, json, requireUser, userClient, callNode } from "../_shared/mail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body?.account_id) return json({ error: "Missing account_id" }, 400);

  const supa = userClient(req);
  const { data: acct } = await supa.from("email_accounts").select("id").eq("id", body.account_id).maybeSingle();
  if (!acct) return json({ error: "Mailbox not accessible" }, 403);

  const r = await callNode("/v1/mail/sync-folder", {
    account_id: body.account_id,
    folder_path: body.folder_path ?? "INBOX",
  }, auth.user.id);
  return json(r.data, r.ok ? 200 : (r.status || 502));
});
