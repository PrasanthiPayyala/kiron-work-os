// SLA breach check — scheduled cron edge function.
//
// Scans all open tasks whose SLA window is set and:
//   - Marks tasks whose SLA has elapsed by writing `sla_due_at` (if missing)
//     and inserting an `overdue` notification for the assignee + reporting
//     manager + reviewer.
//   - Warns assignees whose SLA expires within the next 4 hours with a
//     `due_today` notification (once per task, deduped via the existing
//     notification rows).
//
// Configure a cron schedule against this function in Supabase (e.g. every
// 15 minutes). Runs under service role and bypasses RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const OPEN_STATUSES = [
  "draft",
  "created",
  "assigned",
  "accepted",
  "in_progress",
  "waiting_for_review",
  "waiting_for_manager_approval",
  "blocked",
  "on_hold",
  "rework_required",
  "escalated",
];

const WARN_WINDOW_MS = 4 * 60 * 60 * 1000;

interface TaskRow {
  id: string;
  title: string;
  task_key: string | null;
  status: string;
  sla_hours: number | null;
  sla_due_at: string | null;
  created_at: string;
  assignee_id: string | null;
  reviewer_id: string | null;
  reporting_manager_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, task_key, status, sla_hours, sla_due_at, created_at, assignee_id, reviewer_id, reporting_manager_id")
    .in("status", OPEN_STATUSES)
    .not("sla_hours", "is", null)
    .limit(2000) as { data: TaskRow[] | null; error: unknown };

  if (error || !tasks) {
    console.error("Failed to read tasks", error);
    return json({ error: "Read failed" }, 500);
  }

  const now = Date.now();
  let breached = 0;
  let warned = 0;
  const dueAtUpdates: { id: string; sla_due_at: string }[] = [];
  const notifs: Array<{ user_id: string; kind: "overdue" | "due_today"; task: TaskRow; dueIso: string }> = [];

  for (const t of tasks) {
    const slaHours = Number(t.sla_hours);
    if (!Number.isFinite(slaHours) || slaHours <= 0) continue;

    const createdMs = new Date(t.created_at).getTime();
    if (!Number.isFinite(createdMs)) continue;

    const computedDueMs = createdMs + slaHours * 3600_000;
    const dueMs = t.sla_due_at ? new Date(t.sla_due_at).getTime() : computedDueMs;
    const dueIso = new Date(dueMs).toISOString();

    if (!t.sla_due_at) dueAtUpdates.push({ id: t.id, sla_due_at: dueIso });

    const recipients = uniq([t.assignee_id, t.reviewer_id, t.reporting_manager_id]);

    if (dueMs <= now) {
      breached++;
      for (const uid of recipients) notifs.push({ user_id: uid, kind: "overdue", task: t, dueIso });
    } else if (dueMs - now <= WARN_WINDOW_MS) {
      warned++;
      // only ping the assignee for soft warnings
      if (t.assignee_id) notifs.push({ user_id: t.assignee_id, kind: "due_today", task: t, dueIso });
    }
  }

  if (dueAtUpdates.length) {
    await Promise.all(
      dueAtUpdates.map((u) =>
        supabase.from("tasks").update({ sla_due_at: u.sla_due_at }).eq("id", u.id),
      ),
    );
  }

  // Dedupe against the latest notification we already sent for each (user, task, kind).
  const seenKeys = new Set<string>();
  const wantedKeys = notifs.map((n) => `${n.user_id}::${n.kind}::${n.task.id}`);
  if (wantedKeys.length) {
    const ids = uniq(notifs.map((n) => n.task.id));
    const userIds = uniq(notifs.map((n) => n.user_id));
    const { data: existing } = await supabase
      .from("notifications")
      .select("user_id, notification_type, link")
      .in("user_id", userIds)
      .in("notification_type", ["overdue", "due_today"]);
    for (const row of existing ?? []) {
      const link = (row as { link: string | null }).link ?? "";
      const tid = ids.find((id) => link.includes(id));
      if (tid) {
        seenKeys.add(
          `${(row as { user_id: string }).user_id}::${(row as { notification_type: string }).notification_type}::${tid}`,
        );
      }
    }
  }

  const inserts = notifs
    .filter((n) => !seenKeys.has(`${n.user_id}::${n.kind}::${n.task.id}`))
    .map((n) => ({
      user_id: n.user_id,
      notification_type: n.kind,
      title: n.kind === "overdue"
        ? `SLA breached on ${n.task.task_key ?? "task"}: ${n.task.title}`
        : `SLA due soon on ${n.task.task_key ?? "task"}: ${n.task.title}`,
      body: n.kind === "overdue"
        ? `Past due at ${new Date(n.dueIso).toLocaleString()}.`
        : `Due by ${new Date(n.dueIso).toLocaleString()}.`,
      link: `/tasks?task=${n.task.id}`,
    }));

  if (inserts.length) {
    const { error: insErr } = await supabase.from("notifications").insert(inserts);
    if (insErr) console.error("Notification insert failed", insErr);
  }

  return json({
    scanned: tasks.length,
    breached,
    warned,
    notifications_inserted: inserts.length,
    backfilled_due_at: dueAtUpdates.length,
    ran_at: new Date().toISOString(),
  });
});

function uniq<T>(xs: (T | null | undefined)[]): T[] {
  const out = new Set<T>();
  for (const x of xs) if (x != null) out.add(x);
  return Array.from(out);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
