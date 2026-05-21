// test-mail-connection — verifies IMAP + SMTP creds entered in the UI.
// Credentials are passed inline and NEVER persisted by this function.
import { corsHeaders, json, requireUser, callNode } from "../_shared/mail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Invalid body" }, 400);

  const required = ["imap_host", "imap_port", "imap_username", "imap_password",
                    "smtp_host", "smtp_port", "smtp_username", "smtp_password"];
  for (const k of required) {
    if (!body[k]) return json({ error: `Missing field: ${k}` }, 400);
  }

  // Delegate the actual socket test to the Node service (it owns IMAP/SMTP libs).
  const result = await callNode("/v1/mail/test-connection", body, auth.user.id);
  return json(result.data, result.ok ? 200 : (result.status || 502));
});
