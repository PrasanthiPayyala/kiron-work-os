// Scheduled push to the external Node service.
// Intended to be invoked by a cron schedule (configure in Lovable Cloud later).
// Service-role context — does not require a user JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const baseUrl = Deno.env.get("NODE_BASE_URL");
  const apiKey = Deno.env.get("KIRON_TO_NODE_API_KEY");
  if (!baseUrl || !apiKey) {
    return json({ error: "Integration not configured" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // TODO: replace with the real batch query your Node service expects.
  // Example: nightly employee sync.
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, status, home_company_id")
    .eq("is_active", true)
    .limit(1000);

  if (error) {
    console.error("Failed to read profiles", error);
    return json({ error: "Read failed" }, 500);
  }

  const upstreamUrl = `${baseUrl.replace(/\/$/, "")}/v1/sync/employees`;
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        synced_at: new Date().toISOString(),
        count: profiles?.length ?? 0,
        employees: profiles ?? [],
      }),
    });
  } catch (err) {
    console.error("Upstream fetch failed", err);
    return json({ error: "Could not reach Node service" }, 502);
  }

  const text = await upstreamRes.text();
  return json(
    { ok: upstreamRes.ok, status: upstreamRes.status, response: text },
    upstreamRes.ok ? 200 : 502,
  );
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
