// summarize-email — generates a summary for one message or a whole thread
// using Lovable AI (google/gemini-2.5-flash by default).
import { corsHeaders, json, requireUser, userClient, serviceClient } from "../_shared/mail.ts";

const MODEL = "google/gemini-2.5-flash";
const MIN_CHARS = 400; // skip very short emails

interface Body {
  kind: "message" | "thread";
  message_id?: string;
  thread_id?: string;
  force?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.kind) return json({ error: "Missing kind" }, 400);

  const supa = userClient(req);
  const svc = serviceClient();

  let sourceText = "";
  let accountId: string | null = null;
  let existingSummary: any = null;

  if (body.kind === "message" && body.message_id) {
    const { data: msg } = await supa.from("email_messages")
      .select("id, account_id, subject, from_address, from_name, to_addresses, body_text, body_html, sent_at")
      .eq("id", body.message_id).maybeSingle();
    if (!msg) return json({ error: "Message not accessible" }, 404);
    accountId = msg.account_id;
    sourceText = `Subject: ${msg.subject ?? ""}\nFrom: ${msg.from_name ?? ""} <${msg.from_address ?? ""}>\nTo: ${(msg.to_addresses ?? []).join(", ")}\nDate: ${msg.sent_at ?? ""}\n\n${msg.body_text ?? stripHtml(msg.body_html ?? "")}`;
    if (!body.force) {
      const { data } = await supa.from("email_summaries").select("*").eq("message_id", body.message_id).eq("kind", "message").maybeSingle();
      existingSummary = data;
    }
  } else if (body.kind === "thread" && body.thread_id) {
    const { data: msgs } = await supa.from("email_messages")
      .select("subject, from_address, from_name, to_addresses, body_text, body_html, sent_at, account_id")
      .eq("thread_id", body.thread_id).order("sent_at", { ascending: true });
    if (!msgs?.length) return json({ error: "Thread not accessible" }, 404);
    accountId = msgs[0].account_id;
    sourceText = msgs.map((m: any) =>
      `--- ${m.sent_at ?? ""} | ${m.from_name ?? m.from_address} ---\n${m.body_text ?? stripHtml(m.body_html ?? "")}`
    ).join("\n\n");
    if (!body.force) {
      const { data } = await supa.from("email_summaries").select("*").eq("thread_id", body.thread_id).eq("kind", "thread").maybeSingle();
      existingSummary = data;
    }
  } else {
    return json({ error: "Provide message_id or thread_id" }, 400);
  }

  if (existingSummary) return json({ summary: existingSummary, cached: true });

  if (sourceText.trim().length < MIN_CHARS) {
    return json({ summary: null, compact: true });
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "AI not configured" }, 500);

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You summarize work emails for a busy team. Reply with strict JSON only — no prose, no code fences." },
        { role: "user", content: `Summarize the following ${body.kind}. Respond as JSON with keys: summary (string, 1-3 short sentences), action_items (string[]), deadlines (string[]), people_mentioned (string[]), links (string[]), reply_recommended (boolean).\n\n${sourceText.slice(0, 12000)}` },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (aiRes.status === 429) return json({ error: "Rate limit, try again later" }, 429);
  if (aiRes.status === 402) return json({ error: "AI credits exhausted" }, 402);
  if (!aiRes.ok) return json({ error: "AI call failed", detail: await aiRes.text() }, 502);

  const aiData = await aiRes.json();
  let parsed: any = {};
  try { parsed = JSON.parse(aiData.choices?.[0]?.message?.content ?? "{}"); } catch { /* ignore */ }

  const row = {
    account_id: accountId!,
    message_id: body.kind === "message" ? body.message_id : null,
    thread_id: body.kind === "thread" ? body.thread_id : null,
    kind: body.kind,
    summary: parsed.summary ?? "",
    action_items: parsed.action_items ?? [],
    deadlines: parsed.deadlines ?? [],
    people_mentioned: parsed.people_mentioned ?? [],
    links: parsed.links ?? [],
    reply_recommended: !!parsed.reply_recommended,
    model: MODEL,
  };

  // Use service client to bypass RLS for insert (we've already verified access).
  const { data: saved } = await svc.from("email_summaries").insert(row).select().single();
  return json({ summary: saved });
});

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
