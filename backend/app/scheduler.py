"""SLA breach scheduler.

Replaces the Supabase edge function ``sla-breach-check``. Runs inside the
FastAPI process via APScheduler's AsyncIO variant so newly inserted
notifications can broadcast over the existing WebSocket hub (see
``routers/ws.py``).

Logic (ported verbatim from supabase/functions/sla-breach-check):
    1. Scan all open tasks where ``sla_hours`` is set.
    2. Compute ``sla_due_at = created_at + sla_hours hours`` if missing and
       UPDATE it back so the value sticks.
    3. If ``sla_due_at <= now`` → BREACH: insert an ``overdue`` notification
       for assignee + reviewer + reporting_manager (deduped).
    4. If ``sla_due_at - now <= warn_window_hours`` → WARN: insert a
       ``due_today`` notification for the assignee only (deduped).
    5. Broadcast every inserted notification over the WS hub so recipients
       see it without refreshing.

Multi-worker safety: the job body is wrapped in ``pg_try_advisory_lock``.
With ``uvicorn --workers 2`` each worker fires the timer; only one acquires
the lock and runs — the other returns immediately.

Manual run:  python -m app.scheduler
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Iterable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text

from .config import settings
from .db import engine

log = logging.getLogger("kiron.scheduler")

# Mirrors the constant in supabase/functions/sla-breach-check/index.ts.
# Everything except done/cancelled counts as "open".
OPEN_STATUSES = [
    "draft", "created", "assigned", "accepted", "in_progress",
    "waiting_for_review", "waiting_for_manager_approval",
    "blocked", "on_hold", "rework_required", "escalated",
]

# Arbitrary 64-bit key for pg_try_advisory_lock. Picked once, never changes.
_SLA_LOCK_KEY = 7301823461  # "KIRON_SLA"
_CALL_LOCK_KEY = 7301823462  # "KIRON_CALLS"

# IST = UTC+5:30. Hard-coded because the rest of the app already assumes IST
# (attendance grace, working hours). Don't introduce zoneinfo here.
_IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

_scheduler: AsyncIOScheduler | None = None


# ------------------------------------------------------------------
# Core job
# ------------------------------------------------------------------

async def run_sla_check() -> dict:
    """Scan open tasks, backfill sla_due_at, insert breach/warn notifications.

    Returns a small summary dict (handy for the CLI run and for logging).
    """
    # Run the blocking DB work in a worker thread so we don't block the
    # FastAPI event loop. APScheduler's AsyncIO variant runs the coroutine
    # on the main loop, so we await `to_thread` here.
    summary = await asyncio.to_thread(_run_sla_check_sync)

    # Broadcast newly inserted rows on the event loop (current task).
    if summary["broadcast_payloads"]:
        from .routers import ws as ws_router  # local import to avoid cycles at startup
        for payload in summary["broadcast_payloads"]:
            try:
                await ws_router.notification_new(payload)
            except Exception:  # noqa: BLE001
                log.exception("WS broadcast failed for notification %s", payload.get("id"))

    # Drop the heavy list from the returned dict — callers only want counts.
    return {k: v for k, v in summary.items() if k != "broadcast_payloads"}


def _run_sla_check_sync() -> dict:
    """The blocking work: lock acquire → scan → write. Sync because psycopg
    + the advisory-lock contract are simpler with a single connection."""
    now = dt.datetime.now(dt.timezone.utc)
    warn_window = dt.timedelta(hours=settings.sla_warn_window_hours)
    inserted_payloads: list[dict] = []
    summary = {
        "scanned": 0,
        "breached": 0,
        "warned": 0,
        "notifications_inserted": 0,
        "backfilled_due_at": 0,
        "skipped_lock_busy": False,
        "broadcast_payloads": inserted_payloads,
        "ran_at": now.isoformat(),
    }

    with engine.begin() as conn:
        # Single-runner guarantee for multi-worker setups.
        got = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": _SLA_LOCK_KEY},
        ).scalar()
        if not got:
            summary["skipped_lock_busy"] = True
            log.info("SLA check skipped — another worker holds the lock")
            return summary

        try:
            rows = conn.execute(
                text(
                    "SELECT id, title, task_key, status, sla_hours, sla_due_at, "
                    "created_at, assignee_id, reviewer_id, reporting_manager_id "
                    "FROM tasks "
                    "WHERE sla_hours IS NOT NULL "
                    "AND status::text = ANY(:open_statuses) "
                    "LIMIT 2000"
                ),
                {"open_statuses": OPEN_STATUSES},
            ).mappings().all()

            summary["scanned"] = len(rows)

            # First pass: figure out which tasks are breached vs. warned, and
            # which need their sla_due_at backfilled.
            backfills: list[tuple[str, dt.datetime]] = []
            wanted: list[dict] = []  # each item = candidate notification
            for r in rows:
                sla_hours = r["sla_hours"]
                if not sla_hours or sla_hours <= 0:
                    continue
                created_at = r["created_at"]
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=dt.timezone.utc)

                computed = created_at + dt.timedelta(hours=int(sla_hours))
                due_at = r["sla_due_at"]
                if due_at is None:
                    backfills.append((str(r["id"]), computed))
                    due_at = computed
                elif due_at.tzinfo is None:
                    due_at = due_at.replace(tzinfo=dt.timezone.utc)

                recipients_overdue = _uniq([
                    r.get("assignee_id"), r.get("reviewer_id"), r.get("reporting_manager_id"),
                ])
                if due_at <= now:
                    summary["breached"] += 1
                    for uid in recipients_overdue:
                        wanted.append({
                            "user_id": uid,
                            "kind": "overdue",
                            "task_id": str(r["id"]),
                            "task_key": r["task_key"],
                            "title": r["title"],
                            "due_at": due_at,
                        })
                elif (due_at - now) <= warn_window:
                    summary["warned"] += 1
                    # Only the assignee gets the soft heads-up.
                    if r.get("assignee_id"):
                        wanted.append({
                            "user_id": str(r["assignee_id"]),
                            "kind": "due_today",
                            "task_id": str(r["id"]),
                            "task_key": r["task_key"],
                            "title": r["title"],
                            "due_at": due_at,
                        })

            # Backfill the computed sla_due_at so future runs skip re-deriving.
            for tid, due in backfills:
                conn.execute(
                    text("UPDATE tasks SET sla_due_at = :d WHERE id = :id"),
                    {"d": due, "id": tid},
                )
            summary["backfilled_due_at"] = len(backfills)

            if not wanted:
                return summary

            # Dedup against any existing matching notification.
            #   key = (user_id, notification_type, task_id-in-link)
            user_ids = list({w["user_id"] for w in wanted})
            task_ids = list({w["task_id"] for w in wanted})
            existing = conn.execute(
                text(
                    "SELECT user_id, notification_type, link FROM notifications "
                    "WHERE user_id = ANY(:uids) "
                    "AND notification_type::text = ANY(ARRAY['overdue','due_today'])"
                ),
                {"uids": user_ids},
            ).mappings().all()

            seen: set[tuple[str, str, str]] = set()
            for e in existing:
                link = e.get("link") or ""
                for tid in task_ids:
                    if tid in link:
                        seen.add((str(e["user_id"]), str(e["notification_type"]), tid))

            inserts: list[dict] = []
            for w in wanted:
                key = (w["user_id"], w["kind"], w["task_id"])
                if key in seen:
                    continue
                seen.add(key)  # avoid duplicating within this batch too
                inserts.append({
                    "user_id": w["user_id"],
                    "notification_type": w["kind"],
                    "title": (
                        f"SLA breached on {w['task_key'] or 'task'}: {w['title']}"
                        if w["kind"] == "overdue"
                        else f"SLA due soon on {w['task_key'] or 'task'}: {w['title']}"
                    ),
                    "body": (
                        f"Past due at {w['due_at'].isoformat()}."
                        if w["kind"] == "overdue"
                        else f"Due by {w['due_at'].isoformat()}."
                    ),
                    "link": f"/tasks?task={w['task_id']}",
                })

            if inserts:
                # RETURNING gives us the rows we can hand straight to the WS hub.
                result = conn.execute(
                    text(
                        "INSERT INTO notifications (user_id, notification_type, title, body, link) "
                        "SELECT u.user_id, u.notification_type::public.notification_type, u.title, u.body, u.link "
                        "FROM unnest("
                        "  CAST(:user_ids AS uuid[]), "
                        "  CAST(:types  AS text[]), "
                        "  CAST(:titles AS text[]), "
                        "  CAST(:bodies AS text[]), "
                        "  CAST(:links  AS text[])"
                        ") AS u(user_id, notification_type, title, body, link) "
                        "RETURNING id, user_id, notification_type, title, body, link, is_read, created_at"
                    ),
                    {
                        "user_ids": [i["user_id"] for i in inserts],
                        "types":    [i["notification_type"] for i in inserts],
                        "titles":   [i["title"] for i in inserts],
                        "bodies":   [i["body"] for i in inserts],
                        "links":    [i["link"] for i in inserts],
                    },
                ).mappings().all()
                summary["notifications_inserted"] = len(result)
                for row in result:
                    inserted_payloads.append({
                        "id": str(row["id"]),
                        "user_id": str(row["user_id"]),
                        "notification_type": str(row["notification_type"]),
                        "title": row["title"],
                        "body": row["body"],
                        "link": row["link"],
                        "is_read": row["is_read"],
                        "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
                    })
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _SLA_LOCK_KEY})

    log.info(
        "SLA check: scanned=%(scanned)d breached=%(breached)d warned=%(warned)d "
        "inserted=%(notifications_inserted)d backfilled=%(backfilled_due_at)d",
        summary,
    )
    return summary


# ------------------------------------------------------------------
# Call reminders (T-morning, T-20, T-0).
#
# Runs every minute (cheap query — index on scheduled_at WHERE status =
# 'scheduled'). For each upcoming non-cancelled call we evaluate three
# windows and send any reminder kind that hasn't been logged yet for
# this (call, kind) pair. The reminder log is the dedup key — if we
# already sent T-20 for call X, the row's there and we skip.
#
# Reminders go to every participant via the existing app/email.py
# transport (cPanel SMTP 465 SSL — SMTP_HOST/USER/PASS in backend.env).
# If SMTP_HOST is empty, email.py logs to stdout and we still mark the
# reminder "sent" so we don't loop forever — that matches the existing
# password-reset behaviour.
# ------------------------------------------------------------------


async def run_call_reminders() -> dict:
    summary = await asyncio.to_thread(_run_call_reminders_sync)
    return summary


def _run_call_reminders_sync() -> dict:
    from .email import send_email  # local to avoid pulling SMTP at module import
    now_utc = dt.datetime.now(dt.timezone.utc)
    now_ist = now_utc.astimezone(_IST)
    today_ist = now_ist.date()
    summary = {
        "ran_at": now_utc.isoformat(),
        "scanned": 0,
        "morning_of_sent": 0,
        "t_minus_20_sent": 0,
        "t_zero_sent": 0,
        "skipped_lock_busy": False,
    }
    with engine.begin() as conn:
        got = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": _CALL_LOCK_KEY},
        ).scalar()
        if not got:
            summary["skipped_lock_busy"] = True
            return summary
        try:
            # Pull scheduled calls from now-2min (just-fired T-0 grace) through
            # end-of-day-IST + 1d so morning_of catches everything for today.
            window_start = now_utc - dt.timedelta(minutes=2)
            window_end = now_utc + dt.timedelta(hours=36)
            rows = conn.execute(
                text(
                    "SELECT c.id, c.task_id, c.scheduled_at, c.duration_mins, "
                    "       c.kind, c.contact, c.meeting_link, c.notes, "
                    "       t.title AS task_title, t.task_key AS task_key "
                    "FROM task_calls c "
                    "JOIN tasks t ON t.id = c.task_id "
                    "WHERE c.status = 'scheduled' "
                    "  AND c.scheduled_at >= :ws AND c.scheduled_at <= :we "
                    "ORDER BY c.scheduled_at ASC LIMIT 500"
                ),
                {"ws": window_start, "we": window_end},
            ).mappings().all()
            summary["scanned"] = len(rows)
            if not rows:
                return summary

            call_ids = [str(r["id"]) for r in rows]
            sent_rows = conn.execute(
                text(
                    "SELECT call_id, kind FROM task_call_reminders "
                    "WHERE call_id = ANY(:ids)"
                ),
                {"ids": call_ids},
            ).mappings().all()
            sent: set[tuple[str, str]] = {
                (str(s["call_id"]), s["kind"]) for s in sent_rows
            }

            # Participants for the batch — single round-trip.
            part_rows = conn.execute(
                text(
                    "SELECT p.call_id, p.user_id, pr.email, pr.full_name "
                    "FROM task_call_participants p "
                    "JOIN profiles pr ON pr.id = p.user_id "
                    "WHERE p.call_id = ANY(:ids) AND pr.is_active = true "
                    "  AND COALESCE(pr.email, '') <> ''"
                ),
                {"ids": call_ids},
            ).mappings().all()
            parts_by_call: dict[str, list[dict]] = {}
            for p in part_rows:
                parts_by_call.setdefault(str(p["call_id"]), []).append({
                    "email": p["email"], "name": p["full_name"],
                })

            for r in rows:
                cid = str(r["id"])
                sched = r["scheduled_at"]
                if sched.tzinfo is None:
                    sched = sched.replace(tzinfo=dt.timezone.utc)
                sched_ist = sched.astimezone(_IST)
                attendees = parts_by_call.get(cid, [])
                if not attendees:
                    continue

                def fire(kind: str) -> None:
                    if (cid, kind) in sent:
                        return
                    _send_reminder_emails(
                        send_email, attendees, kind, sched_ist,
                        r["duration_mins"], r["meeting_link"], r["task_title"],
                        r["task_key"], r["notes"],
                        # Defaulting kind here lets older c511842 rows
                        # (no `kind` column populated) fall back to the
                        # generic "Reminder:" subject without crashing.
                        r.get("kind") or "phone_call",
                        r.get("contact"),
                    )
                    conn.execute(
                        text(
                            "INSERT INTO task_call_reminders (call_id, kind) "
                            "VALUES (:c, :k) ON CONFLICT DO NOTHING"
                        ),
                        {"c": cid, "k": kind},
                    )
                    sent.add((cid, kind))
                    summary[f"{kind}_sent"] += 1

                # T-0 — call is happening now (within ±90s).
                delta = (sched - now_utc).total_seconds()
                if -30 <= delta <= 90:
                    fire("t_zero")

                # T-20 — 20 minutes before, with a generous window so a job
                # that fires every minute always catches it.
                if 19 * 60 <= delta <= 21 * 60:
                    fire("t_minus_20")

                # Morning-of — for calls happening later today (IST), once
                # 9:00 IST has rolled over. Skip if the call is in less than
                # 1 hour: T-20 will land soon enough on its own.
                if (
                    sched_ist.date() == today_ist
                    and now_ist.hour >= 9
                    and (sched - now_utc) > dt.timedelta(hours=1)
                ):
                    fire("morning_of")
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _CALL_LOCK_KEY})

    log.info(
        "Call reminders: scanned=%(scanned)d morning=%(morning_of_sent)d "
        "t20=%(t_minus_20_sent)d t0=%(t_zero_sent)d",
        summary,
    )
    return summary


def _send_reminder_emails(
    sender,
    attendees: list[dict],
    when_kind: str,
    sched_ist: dt.datetime,
    duration_mins: int,
    meeting_link: str | None,
    task_title: str | None,
    task_key: str | None,
    notes: str | None,
    reminder_kind: str,
    contact: str | None,
) -> None:
    when_human = sched_ist.strftime("%A, %d %b %Y · %I:%M %p IST")
    when_short = sched_ist.strftime("%I:%M %p")

    # Verb + headline copy keyed off the reminder kind. ``contact`` is the
    # user-supplied "who/where/what about" string. If it's missing, fall
    # back to the task title so the subject is never bare.
    if reminder_kind == "phone_call":
        verb = "Call"
        headline = contact or task_title or "Call"
    elif reminder_kind == "in_person":
        verb = "Meet"
        headline = contact or task_title or "Meeting"
    else:
        verb = "Reminder"
        headline = task_title or contact or "Reminder"

    # Lead line + subject vary by *when* we're firing (morning / T-20 / T-0).
    if when_kind == "morning_of":
        subject = f"Today: {verb} {headline} — {when_short}"
        lead = f"You have a {('call' if reminder_kind == 'phone_call' else 'meeting' if reminder_kind == 'in_person' else 'reminder')} later today."
    elif when_kind == "t_minus_20":
        subject = f"In 20 minutes: {verb} {headline} — {when_short}"
        lead = f"Your scheduled {('call' if reminder_kind == 'phone_call' else 'meeting' if reminder_kind == 'in_person' else 'reminder')} is in 20 minutes."
    else:
        subject = f"Now: {verb} {headline}"
        lead = f"Your scheduled {('call' if reminder_kind == 'phone_call' else 'meeting' if reminder_kind == 'in_person' else 'reminder')} is starting now."

    contact_html = f"<p><strong>{contact}</strong></p>" if contact else ""
    link_html = (
        f'<p><a href="{meeting_link}" '
        f'style="display:inline-block;padding:10px 16px;background:#0f172a;'
        f'color:#fff;text-decoration:none;border-radius:6px">Open link</a></p>'
        if meeting_link else ""
    )
    notes_html = f"<p><em>Notes:</em> {notes}</p>" if notes else ""
    body_html = (
        f"<p>{lead}</p>"
        f"<p><strong>{task_title or 'Reminder'}</strong>"
        + (f" <span style='color:#666'>· {task_key}</span>" if task_key else "")
        + "</p>"
        f"<p>{when_human} · {duration_mins} minutes</p>"
        + contact_html + link_html + notes_html
    )
    body_text = (
        f"{lead}\n\n"
        f"{task_title or 'Reminder'}"
        + (f" ({task_key})" if task_key else "")
        + f"\n{when_human} · {duration_mins} minutes\n"
        + (f"{contact}\n" if contact else "")
        + (f"Link: {meeting_link}\n" if meeting_link else "")
        + (f"Notes: {notes}\n" if notes else "")
        + "\n— Kiron Work OS"
    )
    for a in attendees:
        try:
            sender(a["email"], subject, body_text, body_html)
        except Exception:  # noqa: BLE001
            log.exception("Failed to send %s reminder to %s", when_kind, a.get("email"))


def _uniq(items: Iterable) -> list[str]:
    seen: list[str] = []
    out: set[str] = set()
    for x in items:
        if x is None:
            continue
        s = str(x)
        if s in out:
            continue
        out.add(s)
        seen.append(s)
    return seen


# ------------------------------------------------------------------
# Lifecycle hooks (called from main.py)
# ------------------------------------------------------------------

def start_scheduler() -> None:
    global _scheduler
    if not settings.sla_check_enabled:
        log.info("Scheduler disabled via SLA_CHECK_ENABLED=false")
        return
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        run_sla_check,
        trigger="interval",
        minutes=settings.sla_check_interval_min,
        id="sla_check",
        # Don't pile up missed runs if the server was paused (laptop sleep etc).
        coalesce=True,
        max_instances=1,
        # First fire shortly after boot so a freshly-restarted server doesn't
        # stay silent for a full interval before catching breaches.
        next_run_time=dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=30),
    )
    _scheduler.add_job(
        run_call_reminders,
        trigger="interval",
        minutes=1,
        id="call_reminders",
        coalesce=True,
        max_instances=1,
        next_run_time=dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=45),
    )
    _scheduler.start()
    log.info(
        "Scheduler started — SLA every %d min, call reminders every 1 min",
        settings.sla_check_interval_min,
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    log.info("Scheduler stopped")


# ------------------------------------------------------------------
# CLI: `python -m app.scheduler`
# ------------------------------------------------------------------

def _cli() -> None:
    """Run the SLA check once and print the summary. For ops verification."""
    logging.basicConfig(level=logging.INFO)
    summary = asyncio.run(run_sla_check())
    import json
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    _cli()
