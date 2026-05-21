// send-mail — sends a new message, reply, reply-all, or forward via SMTP.
// Delegated to Node service for actual SMTP transport. On success Node
// will also APPEND to the IMAP Sent folder and trigger a sync for that folder.
import { corsHeaders, json, requireUser, userClient, callNode, serviceClient } from "../_shared/mail.ts";

interface SendBody {
  account_id: string;
  mode?: "new" | "reply" | "reply_all" | "forward";
  in_reply_to_message_id?: string;
  forward_of_message_id?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body_html?: string;
  body_text?: string;
  attachments?: Array<{ filename: string; mime_type: string; storage_path: string }>;
  draft_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as SendBody | null;
  if (!body?.account_id || !body.to?.length || !body.subject) {
    return json({ error: "Missing account_id, to, or subject" }, 400);
  }

  // Verify caller can use this mailbox.
  const supa = userClient(req);
  const { data: account, error: acctErr } = await supa
    .from("email_accounts").select("id").eq("id", body.account_id).maybeSingle();
  if (acctErr || !account) return json({ error: "Mailbox not accessible" }, 403);

  const result = await callNode("/v1/mail/send", { ...body, sender_user_id: auth.user.id }, auth.user.id);
  if (!result.ok) return json(result.data, result.status || 502);

  // Clean up draft if it was sent from a draft.
  if (body.draft_id) {
    const svc = serviceClient();
    await svc.from("email_drafts").delete().eq("id", body.draft_id);
  }
  return json(result.data);
});
