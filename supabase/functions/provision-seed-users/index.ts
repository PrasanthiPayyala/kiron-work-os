// One-shot idempotent edge function that creates auth.users for every existing
// profile row, using the SAME UUID as the profile's id, so all foreign keys
// (tasks.assignee_id, project_members.user_id, etc.) instantly point to a
// real auth user. Default password: kiron@2025.
//
// Safe to call multiple times — skips users that already exist.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_PASSWORD = "kiron@2025";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Pull every profile that has an email
    const { data: profiles, error: pErr } = await admin
      .from("profiles")
      .select("id, email, full_name");
    if (pErr) throw pErr;

    // 2. List every existing auth user (paginated)
    const existingEmails = new Set<string>();
    let page = 1;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw error;
      for (const u of data.users) {
        if (u.email) existingEmails.add(u.email.toLowerCase());
      }
      if (data.users.length < 1000) break;
      page++;
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ email: string; error: string }> = [];

    for (const p of profiles ?? []) {
      if (!p.email) {
        skipped++;
        continue;
      }
      const emailLc = p.email.toLowerCase();
      if (existingEmails.has(emailLc)) {
        skipped++;
        continue;
      }

      const { error } = await admin.auth.admin.createUser({
        id: p.id, // critical: keep UUID identical to profile id
        email: p.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: p.full_name },
      });
      if (error) {
        failed++;
        errors.push({ email: p.email, error: error.message });
      } else {
        created++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        created,
        skipped,
        failed,
        total: profiles?.length ?? 0,
        errors,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
