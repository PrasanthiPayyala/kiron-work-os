// send-task-update-email — sends an outbound notification email when a task
// activity is logged. Does NOT create an inbound email_messages row.
import { corsHeaders, json, requireUser, userClient, callNode, serviceClient } from "../_shared/mail.ts";

interface Body {
  task_id: string;
  activity_id?: string;
  from_status?: string;
  to_status?: string;
  comment?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.task_id) return json({ error: "Missing task_id" }, 400);

  const supa = userClient(req);
  const svc = serviceClient();

  const { data: task } = await supa.from("tasks").select("*").eq("id", body.task_id).maybeSingle();
  if (!task) return json({ error: "Task not accessible" }, 404);
  if (!task.email_notify_enabled) return json({ ok: true, skipped: "disabled" });

  const recipients: string[] = task.email_notify_recipients ?? [];
  if (!recipients.length) return json({ ok: true, skipped: "no_recipients" });

  // Pick the sender mailbox: current user's default account, else any account they own.
  const { data: profile } = await supa.from("profiles").select("email_default_account_id, full_name").eq("id", auth.user.id).maybeSingle();
  let accountId: string | null = profile?.email_default_account_id ?? null;
  if (!accountId) {
    const { data: owned } = await supa.from("email_accounts")
      .select("id").eq("owner_user_id", auth.user.id).eq("is_active", true).limit(1);
    accountId = owned?.[0]?.id ?? null;
  }
  if (!accountId) return json({ ok: true, skipped: "no_mailbox" });

  // Resolve company & project for richer template (via service to bypass any sneaky RLS gaps).
  const { data: company } = task.company_id
    ? await svc.from("companies").select("name").eq("id", task.company_id).maybeSingle()
    : { data: null };
  const { data: project } = task.project_id
    ? await svc.from("projects").select("title").eq("id", task.project_id).maybeSingle()
    : { data: null };

  const taskUrl = `${Deno.env.get("SUPABASE_URL")?.replace("supabase.co", "lovable.app")}/tasks?id=${task.id}`;

  const subject = `[Kiron] ${task.title} — ${body.to_status ?? task.status}`;
  const html = `
    <div style="font-family:ui-sans-serif,system-ui;color:#111">
      <h2 style="margin:0 0 12px">${escapeHtml(task.title)}</h2>
      <p style="color:#555;margin:0 0 16px">Task update from <b>${escapeHtml(profile?.full_name ?? "Kiron user")}</b></p>
      <table style="border-collapse:collapse">
        ${row("Company", company?.name ?? "—")}
        ${row("Project", project?.title ?? "—")}
        ${row("Status", `${body.from_status ?? "—"} → <b>${body.to_status ?? task.status}</b>`)}
        ${row("Due", task.due_at ? new Date(task.due_at).toLocaleString() : "—")}
        ${body.comment ? row("Update", escapeHtml(body.comment)) : ""}
      </table>
      <p style="margin-top:24px"><a href="${taskUrl}" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open in Kiron</a></p>
    </div>`;

  const result = await callNode("/v1/mail/send", {
    account_id: accountId,
    mode: "new",
    to: recipients,
    subject,
    body_html: html,
    body_text: `${task.title}\nStatus: ${body.from_status ?? "—"} → ${body.to_status ?? task.status}\n${body.comment ?? ""}\n\n${taskUrl}`,
    suppress_inbound: true, // tells Node: do not write back as an inbound email
    sender_user_id: auth.user.id,
  }, auth.user.id);

  return json({ ok: result.ok, status: result.status, data: result.data });
});

function row(k: string, v: string) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0">${v}</td></tr>`;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
