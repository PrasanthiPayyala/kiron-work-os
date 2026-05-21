// save-draft — create or update an email draft.
import { corsHeaders, json, requireUser, userClient } from "../_shared/mail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body?.account_id) return json({ error: "Missing account_id" }, 400);

  const supa = userClient(req);
  const row = {
    id: body.id,
    account_id: body.account_id,
    user_id: auth.user.id,
    to_addresses: body.to ?? [],
    cc_addresses: body.cc ?? [],
    bcc_addresses: body.bcc ?? [],
    subject: body.subject ?? null,
    body_html: body.body_html ?? null,
    body_text: body.body_text ?? null,
    in_reply_to_message_id: body.in_reply_to_message_id ?? null,
    forward_of_message_id: body.forward_of_message_id ?? null,
    attachments: body.attachments ?? [],
  };
  const { data, error } = await supa.from("email_drafts").upsert(row).select().single();
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, draft: data });
});
