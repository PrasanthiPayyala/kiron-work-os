// Shared helpers for mail edge functions
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function userClient(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function requireUser(req: Request) {
  const supa = userClient(req);
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) return null;
  return { supa, user: data.user };
}

// Forward a request to the Node mail worker service
export async function callNode(path: string, body: unknown, userId?: string) {
  const baseUrl = Deno.env.get("NODE_BASE_URL");
  const apiKey = Deno.env.get("KIRON_TO_NODE_API_KEY");
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 500, data: { error: "Node integration not configured" } };
  }
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(userId ? { "X-Kiron-User": userId } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, data: parsed };
  } catch (err) {
    return { ok: false, status: 502, data: { error: "Could not reach Node service", detail: String(err) } };
  }
}
