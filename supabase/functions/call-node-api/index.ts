// UI proxy: validates the user's session, then forwards an allow-listed call
// to the external Node service using the server-side API key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Allow-listed Node endpoints the UI is permitted to call via this proxy.
// Add more here as your Node team exposes them.
const ALLOWED_PATHS = new Set<string>([
  "/v1/echo",
  "/v1/events/task.completed",
  "/v1/events/leave.approved",
]);

interface ProxyBody {
  path: string;
  method?: string;
  body?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate the calling user's session.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "Invalid session" }, 401);
    }

    // 2. Validate request body.
    const payload = (await req.json().catch(() => null)) as ProxyBody | null;
    if (!payload || typeof payload.path !== "string") {
      return json({ error: "Body must be { path, method?, body? }" }, 400);
    }
    if (!ALLOWED_PATHS.has(payload.path)) {
      return json({ error: `Path not allow-listed: ${payload.path}` }, 403);
    }

    // 3. Forward to the Node service.
    const baseUrl = Deno.env.get("NODE_BASE_URL");
    const apiKey = Deno.env.get("KIRON_TO_NODE_API_KEY");
    if (!baseUrl || !apiKey) {
      return json({ error: "Integration not configured" }, 500);
    }

    const upstreamUrl = `${baseUrl.replace(/\/$/, "")}${payload.path}`;
    const method = (payload.method ?? "POST").toUpperCase();

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Kiron-User": userData.user.id,
        },
        body: method === "GET" ? undefined : JSON.stringify(payload.body ?? {}),
      });
    } catch (err) {
      console.error("Upstream fetch failed", err);
      return json(
        { error: "Could not reach Node service", detail: String(err) },
        502,
      );
    }

    const text = await upstreamRes.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      // upstream returned non-JSON; pass it through as a string
    }

    return json(
      { status: upstreamRes.status, data: parsed },
      upstreamRes.ok ? 200 : 502,
    );
  } catch (err) {
    console.error("call-node-api error", err);
    return json({ error: "Internal error", detail: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
