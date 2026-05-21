// fetch-message-detail — returns full body + attachment list for a message.
// If the body hasn't been hydrated yet, asks Node to fetch it from IMAP.
import { corsHeaders, json, requireUser, userClient, callNode } from "../_shared/mail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body?.message_id) return json({ error: "Missing message_id" }, 400);

  const supa = userClient(req);
  const { data: msg, error } = await supa.from("email_messages")
    .select("*").eq("id", body.message_id).maybeSingle();
  if (error || !msg) return json({ error: "Message not accessible" }, 404);

  // Fetch attachments (RLS-scoped).
  const { data: attachments } = await supa.from("email_attachments")
    .select("*").eq("message_id", body.message_id);

  // If body wasn't hydrated, ask Node to pull it. The Node side will UPDATE
  // the row, then we re-fetch.
  let messageRow: any = msg;
  if (!msg.body_text && !msg.body_html) {
    await callNode("/v1/mail/fetch-message", {
      account_id: msg.account_id,
      message_id: msg.id,
      imap_uid: msg.imap_uid,
      folder_id: msg.folder_id,
    }, auth.user.id).catch(() => {});
    const { data: refreshed } = await supa.from("email_messages")
      .select("*").eq("id", body.message_id).maybeSingle();
    if (refreshed) messageRow = refreshed;
  }

  // Mark as read.
  if (!messageRow.is_read) {
    await supa.from("email_messages").update({ is_read: true }).eq("id", messageRow.id);
  }

  return json({ message: messageRow, attachments: attachments ?? [] });
});
