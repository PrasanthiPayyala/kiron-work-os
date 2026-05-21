// Public webhook endpoint that receives events from the external Node service.
// Verifies HMAC-SHA256 signature + bearer token, deduplicates by idempotency_key,
// records the event, and dispatches to internal handlers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-kiron-signature, content-type",
};

interface WebhookBody {
  event: string;
  data: Record<string, unknown>;
  idempotency_key: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // 1. Bearer token check.
  const expectedToken = Deno.env.get("NODE_TO_KIRON_API_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  // 2. Read raw body (needed for signature verification before parsing).
  const rawBody = await req.text();

  // 3. HMAC signature check.
  const signatureHeader = req.headers.get("X-Kiron-Signature") ?? "";
  const signingSecret = Deno.env.get("WEBHOOK_SIGNING_SECRET");
  if (!signingSecret) {
    return json({ error: "Webhook signing not configured" }, 500);
  }
  const expectedSig = await hmacSha256Hex(signingSecret, rawBody);
  const provided = signatureHeader.replace(/^sha256=/, "").trim();
  if (!timingSafeEqual(expectedSig, provided)) {
    return json({ error: "Invalid signature" }, 401);
  }

  // 4. Parse body.
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body?.event || !body?.idempotency_key) {
    return json(
      { error: "Body must include event and idempotency_key" },
      400,
    );
  }

  // 5. Insert with idempotency. Use service role to write to webhook_events.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inserted, error: insertErr } = await supabase
    .from("webhook_events")
    .insert({
      source: "node",
      event: body.event,
      idempotency_key: body.idempotency_key,
      payload: body.data ?? {},
      status: "received",
    })
    .select("id")
    .single();

  if (insertErr) {
    // Unique violation = duplicate — that's success from the sender's POV.
    if (insertErr.code === "23505") {
      return json({ ok: true, deduplicated: true });
    }
    console.error("Insert failed", insertErr);
    return json({ error: "Could not record event" }, 500);
  }

  // 6. Dispatch to internal handler. TODO: wire real handlers per event type.
  try {
    await dispatch(body, supabase);
    await supabase
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", inserted.id);
  } catch (err) {
    console.error("Dispatch failed", err);
    await supabase
      .from("webhook_events")
      .update({ status: "failed", error: String(err) })
      .eq("id", inserted.id);
    return json({ ok: false, error: "Handler failed" }, 500);
  }

  return json({ ok: true, id: inserted.id });
});

async function dispatch(
  body: WebhookBody,
  // deno-lint-ignore no-explicit-any
  _supabase: any,
) {
  // TODO: route by body.event, e.g. "employee.created", "task.synced", etc.
  // Example skeleton:
  //   if (body.event === "employee.created") {
  //     await _supabase.from("profiles").upsert({ ... });
  //   }
  console.log("Received webhook event", body.event);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
