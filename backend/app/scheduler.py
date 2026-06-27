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
_VENDOR_LOCK_KEY = 7301823463  # "KIRON_VENDORS"
_COMPLIANCE_LOCK_KEY = 7301823464  # "KIRON_COMPLIANCE"
_COMP_OFF_OVERDUE_LOCK_KEY = 7301823465  # "KIRON_COMPOFF"

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
# Primary channel is the in-app notifications pipeline: we INSERT into
# ``notifications`` (notification_type = 'reminder') and broadcast the
# row over the existing WebSocket hub. The topbar bell badge + the
# /notifications page + the desktop browser-Notification handler on the
# client all consume that stream, so reminders pop up live with no
# extra wiring per surface.
#
# Email is best-effort secondary — fires the same wording out over
# app/email.py if SMTP is configured. If SMTP_HOST is empty, email.py
# logs to stdout. Either way we mark the reminder kind as fired so the
# scheduler doesn't loop forever on the same window.
# ------------------------------------------------------------------


async def run_call_reminders() -> dict:
    summary = await asyncio.to_thread(_run_call_reminders_sync)
    # Broadcast each freshly-inserted notification over WS so the client
    # can light up the bell + fire a browser desktop toast in real time.
    payloads = summary.pop("broadcast_payloads", [])
    if payloads:
        from .routers import ws as ws_router
        for p in payloads:
            try:
                await ws_router.notification_new(p)
            except Exception:  # noqa: BLE001
                log.exception("WS broadcast failed for reminder notification %s", p.get("id"))
    return summary


def _run_call_reminders_sync() -> dict:
    from .email import send_email  # local to avoid pulling SMTP at module import
    now_utc = dt.datetime.now(dt.timezone.utc)
    now_ist = now_utc.astimezone(_IST)
    today_ist = now_ist.date()
    broadcast_payloads: list[dict] = []
    summary: dict = {
        "ran_at": now_utc.isoformat(),
        "scanned": 0,
        "morning_of_sent": 0,
        "t_minus_20_sent": 0,
        "t_zero_sent": 0,
        "notifications_inserted": 0,
        "skipped_lock_busy": False,
        "broadcast_payloads": broadcast_payloads,
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

            # Participants for the batch — single round-trip. We pull
            # user_id (for the notification insert) and email (for the
            # secondary email channel). Inactive users + users without an
            # email are still notified in-app — we just skip them from
            # the email loop. Email is dropped only when the column is
            # blank.
            part_rows = conn.execute(
                text(
                    "SELECT p.call_id, p.user_id, pr.email, pr.full_name "
                    "FROM task_call_participants p "
                    "JOIN profiles pr ON pr.id = p.user_id "
                    "WHERE p.call_id = ANY(:ids) AND pr.is_active = true"
                ),
                {"ids": call_ids},
            ).mappings().all()
            parts_by_call: dict[str, list[dict]] = {}
            for p in part_rows:
                parts_by_call.setdefault(str(p["call_id"]), []).append({
                    "user_id": str(p["user_id"]),
                    "email": p["email"],
                    "name": p["full_name"],
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
                    reminder_kind = r.get("kind") or "phone_call"
                    title, body = _reminder_copy(
                        kind, reminder_kind, sched_ist,
                        r["duration_mins"], r["task_title"],
                        r.get("contact"), r.get("task_key"),
                    )
                    # In-app notification — one row per participant. The
                    # WS hub broadcasts each to the right user.
                    link = f"/tasks?task={r['task_id']}"
                    result = conn.execute(
                        text(
                            "INSERT INTO notifications "
                            "  (user_id, notification_type, title, body, link) "
                            "SELECT u.user_id, 'reminder'::public.notification_type, "
                            "       u.title, u.body, u.link "
                            "FROM unnest("
                            "  CAST(:user_ids AS uuid[]), "
                            "  CAST(:titles   AS text[]), "
                            "  CAST(:bodies   AS text[]), "
                            "  CAST(:links    AS text[])"
                            ") AS u(user_id, title, body, link) "
                            "RETURNING id, user_id, notification_type, title, body, link, is_read, created_at"
                        ),
                        {
                            "user_ids": [a["user_id"] for a in attendees],
                            "titles":   [title] * len(attendees),
                            "bodies":   [body]  * len(attendees),
                            "links":    [link]  * len(attendees),
                        },
                    ).mappings().all()
                    for row_ in result:
                        broadcast_payloads.append({
                            "id": str(row_["id"]),
                            "user_id": str(row_["user_id"]),
                            "notification_type": str(row_["notification_type"]),
                            "title": row_["title"],
                            "body": row_["body"],
                            "link": row_["link"],
                            "is_read": row_["is_read"],
                            "created_at": row_["created_at"].isoformat() if hasattr(row_["created_at"], "isoformat") else str(row_["created_at"]),
                        })
                    summary["notifications_inserted"] += len(result)

                    # Email is now secondary. Send only to attendees whose
                    # profile has an email set; failures are logged but
                    # never block the in-app fire.
                    email_attendees = [a for a in attendees if a.get("email")]
                    if email_attendees:
                        _send_reminder_emails(
                            send_email, email_attendees, kind, sched_ist,
                            r["duration_mins"], r["meeting_link"], r["task_title"],
                            r["task_key"], r["notes"],
                            reminder_kind, r.get("contact"),
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


# ------------------------------------------------------------------
# Vendor contract renewal reminders.
#
# Runs daily (alongside the other jobs). Walks active vendor_contracts
# and fires an in-app notification + best-effort email to the vendor's
# owner (and super_admin) when end_date - reminder_days_before is on or
# before today_ist. Deduped via vendor_contract_reminders keyed on
# (contract_id, for_end_date) — so if HR pushes end_date forward
# (manual renewal), a new reminder fires for the new date.
# ------------------------------------------------------------------


async def run_vendor_renewal_reminders() -> dict:
    summary = await asyncio.to_thread(_run_vendor_renewal_sync)
    payloads = summary.pop("broadcast_payloads", [])
    if payloads:
        from .routers import ws as ws_router
        for p in payloads:
            try:
                await ws_router.notification_new(p)
            except Exception:  # noqa: BLE001
                log.exception("WS broadcast failed for vendor renewal notification %s", p.get("id"))
    return summary


def _run_vendor_renewal_sync() -> dict:
    from .email import send_email  # local import — SMTP is optional
    now_utc = dt.datetime.now(dt.timezone.utc)
    today_ist = now_utc.astimezone(_IST).date()
    broadcast_payloads: list[dict] = []
    summary: dict = {
        "ran_at": now_utc.isoformat(),
        "scanned": 0,
        "fired": 0,
        "skipped_lock_busy": False,
        "broadcast_payloads": broadcast_payloads,
    }
    with engine.begin() as conn:
        got = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": _VENDOR_LOCK_KEY},
        ).scalar()
        if not got:
            summary["skipped_lock_busy"] = True
            return summary
        try:
            # Pull contracts whose reminder window is open today and
            # whose owner we can email. The owner could be NULL — we
            # still create an in-app notification for super_admin so
            # the alert isn't lost.
            contracts = conn.execute(
                text(
                    "SELECT c.id, c.title, c.end_date, c.reminder_days_before, "
                    "       c.amount, c.currency, "
                    "       v.id AS vendor_id, v.name AS vendor_name, v.owner_id, "
                    "       o.full_name AS owner_name, o.email AS owner_email "
                    "FROM vendor_contracts c "
                    "JOIN vendors v ON v.id = c.vendor_id "
                    "LEFT JOIN profiles o ON o.id = v.owner_id "
                    "WHERE c.status = 'active' AND c.end_date IS NOT NULL "
                    "  AND v.is_active = true "
                    "  AND (c.end_date - c.reminder_days_before) <= :today "
                    "  AND c.end_date >= :today "
                    "LIMIT 500"
                ),
                {"today": today_ist},
            ).mappings().all()
            summary["scanned"] = len(contracts)
            if not contracts:
                return summary

            # Dedup against rows already sent for the same (contract,
            # end_date). When end_date moves, the dedup key changes.
            keys = [(str(c["id"]), c["end_date"]) for c in contracts]
            sent_rows = conn.execute(
                text(
                    "SELECT contract_id, for_end_date FROM vendor_contract_reminders "
                    "WHERE contract_id = ANY(:ids)"
                ),
                {"ids": [k[0] for k in keys]},
            ).mappings().all()
            sent: set[tuple[str, str]] = {
                (str(r["contract_id"]), str(r["for_end_date"])) for r in sent_rows
            }

            # Always also notify super_admin role members so a
            # missing-owner contract doesn't slip through. Cheap query.
            super_admins = conn.execute(
                text(
                    "SELECT p.id, p.email, p.full_name FROM profiles p "
                    "JOIN user_roles ur ON ur.user_id = p.id "
                    "WHERE ur.role = 'super_admin' AND p.is_active = true"
                )
            ).mappings().all()

            for c in contracts:
                key = (str(c["id"]), str(c["end_date"]))
                if key in sent:
                    continue

                days_left = (c["end_date"] - today_ist).days
                title = f"Renewal due in {days_left} day{'s' if days_left != 1 else ''}: {c['vendor_name']} — {c['title']}"
                if c["amount"]:
                    body = f"{c['currency']} {float(c['amount']):,.0f} · ends {c['end_date']}"
                else:
                    body = f"Ends {c['end_date']}"
                link = f"/vendors/{c['vendor_id']}"

                # Recipients: contract/vendor owner + every super_admin.
                # Deduped by user_id so an owner who's also super_admin
                # doesn't get two rows.
                recipients: dict[str, dict] = {}
                if c["owner_id"]:
                    recipients[str(c["owner_id"])] = {
                        "id": str(c["owner_id"]),
                        "email": c.get("owner_email"),
                        "name": c.get("owner_name"),
                    }
                for sa in super_admins:
                    recipients[str(sa["id"])] = {
                        "id": str(sa["id"]),
                        "email": sa.get("email"),
                        "name": sa.get("full_name"),
                    }
                if not recipients:
                    continue

                result = conn.execute(
                    text(
                        "INSERT INTO notifications "
                        "  (user_id, notification_type, title, body, link) "
                        "SELECT u.user_id, 'reminder'::public.notification_type, "
                        "       u.title, u.body, u.link "
                        "FROM unnest("
                        "  CAST(:user_ids AS uuid[]), "
                        "  CAST(:titles   AS text[]), "
                        "  CAST(:bodies   AS text[]), "
                        "  CAST(:links    AS text[])"
                        ") AS u(user_id, title, body, link) "
                        "RETURNING id, user_id, notification_type, title, body, link, is_read, created_at"
                    ),
                    {
                        "user_ids": list(recipients.keys()),
                        "titles":   [title] * len(recipients),
                        "bodies":   [body]  * len(recipients),
                        "links":    [link]  * len(recipients),
                    },
                ).mappings().all()
                for r in result:
                    broadcast_payloads.append({
                        "id": str(r["id"]),
                        "user_id": str(r["user_id"]),
                        "notification_type": str(r["notification_type"]),
                        "title": r["title"],
                        "body": r["body"],
                        "link": r["link"],
                        "is_read": r["is_read"],
                        "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
                    })

                # Email best-effort to anyone with an address.
                for u in recipients.values():
                    if not u.get("email"):
                        continue
                    body_text = (
                        f"{title}\n\n{body}\n\n"
                        f"Open in Kiron Work OS:\n{link}\n\n"
                        f"— Kiron Work OS"
                    )
                    body_html = (
                        f"<p>{title}</p><p>{body}</p>"
                        f'<p><a href="{link}" style="display:inline-block;padding:10px 16px;'
                        f'background:#0f172a;color:#fff;text-decoration:none;border-radius:6px">Open</a></p>'
                    )
                    try:
                        send_email(u["email"], title, body_text, body_html)
                    except Exception:  # noqa: BLE001
                        log.exception("Vendor renewal email failed for %s", u.get("email"))

                conn.execute(
                    text(
                        "INSERT INTO vendor_contract_reminders (contract_id, for_end_date) "
                        "VALUES (:c, :d) ON CONFLICT DO NOTHING"
                    ),
                    {"c": str(c["id"]), "d": c["end_date"]},
                )
                sent.add(key)
                summary["fired"] += 1
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _VENDOR_LOCK_KEY})

    log.info("Vendor renewal reminders: scanned=%(scanned)d fired=%(fired)d", summary)
    return summary


# ------------------------------------------------------------------
# Compliance reminders.
#
# Runs every hour. Two passes:
# 1. Generation — for every active obligation, insert any missing
#    occurrences whose due_date is within the next 120 days. Idempotent
#    via the (obligation_id, due_date) UNIQUE constraint.
# 2. Reminders — for each pending occurrence, compute days_to_due.
#    Fire kind 'T_N' when days_to_due == reminder_days_before,
#    'T_3' when days_to_due == 3, 'T_0' when days_to_due == 0, and
#    'overdue' when days_to_due < 0. Each kind logged once per
#    occurrence via compliance_reminders dedup.
# ------------------------------------------------------------------


async def run_compliance_reminders() -> dict:
    summary = await asyncio.to_thread(_run_compliance_reminders_sync)
    payloads = summary.pop("broadcast_payloads", [])
    if payloads:
        from .routers import ws as ws_router
        for p in payloads:
            try:
                await ws_router.notification_new(p)
            except Exception:  # noqa: BLE001
                log.exception("WS broadcast failed for compliance notification %s", p.get("id"))
    return summary


def _run_compliance_reminders_sync() -> dict:
    from .email import send_email
    from .routers.compliance import _generate_for_obligation
    now_utc = dt.datetime.now(dt.timezone.utc)
    today = now_utc.astimezone(_IST).date()
    broadcast_payloads: list[dict] = []
    summary: dict = {
        "ran_at": now_utc.isoformat(),
        "generated": 0,
        "fired": 0,
        "skipped_lock_busy": False,
        "broadcast_payloads": broadcast_payloads,
    }
    with engine.begin() as conn:
        got = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": _COMPLIANCE_LOCK_KEY},
        ).scalar()
        if not got:
            summary["skipped_lock_busy"] = True
            return summary
        try:
            until = today + dt.timedelta(days=120)
            # We need a real Session for the generator. The router
            # helper takes one; reuse it here for consistency rather
            # than reimplementing the period math.
            from sqlalchemy.orm import Session as _Session
            session = _Session(bind=conn)
            try:
                obs = conn.execute(
                    text("SELECT * FROM compliance_obligations WHERE is_active = true")
                ).mappings().all()
                for ob in obs:
                    summary["generated"] += _generate_for_obligation(session, row(ob), until)
            finally:
                # session shares conn; flush implicit. No close needed.
                pass

            # Now scan pending occurrences within the relevant window.
            rows = conn.execute(
                text(
                    "SELECT c.id, c.due_date, c.period_label, "
                    "       o.id AS obligation_id, o.name AS obligation_name, "
                    "       o.kind, o.company_id, o.assigned_to_user_id, "
                    "       o.reminder_days_before "
                    "FROM compliance_occurrences c "
                    "JOIN compliance_obligations o ON o.id = c.obligation_id "
                    "WHERE c.status = 'pending' "
                    "  AND o.is_active = true "
                    "  AND c.due_date <= :far "
                    "ORDER BY c.due_date ASC LIMIT 500"
                ),
                {"far": today + dt.timedelta(days=60)},
            ).mappings().all()
            if not rows:
                return summary

            occ_ids = [str(r["id"]) for r in rows]
            sent_rows = conn.execute(
                text(
                    "SELECT occurrence_id, kind FROM compliance_reminders "
                    "WHERE occurrence_id = ANY(:ids)"
                ),
                {"ids": occ_ids},
            ).mappings().all()
            sent: set[tuple[str, str]] = {
                (str(r["occurrence_id"]), r["kind"]) for r in sent_rows
            }

            # Super-admin fan-out keeps high-stakes filings from sliding
            # past an unassigned obligation.
            super_admins = conn.execute(
                text(
                    "SELECT p.id, p.email, p.full_name FROM profiles p "
                    "JOIN user_roles ur ON ur.user_id = p.id "
                    "WHERE ur.role = 'super_admin' AND p.is_active = true"
                )
            ).mappings().all()

            for r in rows:
                days_to_due = (r["due_date"] - today).days
                kinds_to_fire: list[str] = []
                rdb = r["reminder_days_before"] or 7
                # T_N at reminder_days_before. Skip if it's also 3 or 0
                # since those have dedicated rows.
                if days_to_due == rdb and rdb not in (3, 0):
                    kinds_to_fire.append("T_N")
                if days_to_due == 3:
                    kinds_to_fire.append("T_3")
                if days_to_due == 0:
                    kinds_to_fire.append("T_0")
                if days_to_due < 0:
                    # Overdue fires once. Subsequent days are quiet —
                    # we'd rather respect the user than spam them every
                    # morning when they already know it slipped.
                    kinds_to_fire.append("overdue")
                kinds_to_fire = [k for k in kinds_to_fire if (str(r["id"]), k) not in sent]
                if not kinds_to_fire:
                    continue

                if days_to_due < 0:
                    title_prefix = f"OVERDUE by {abs(days_to_due)}d:"
                elif days_to_due == 0:
                    title_prefix = "Due today:"
                else:
                    title_prefix = f"Due in {days_to_due}d:"
                title = f"{title_prefix} {r['obligation_name']} — {r['period_label']}"
                body = f"Due {r['due_date']}"
                link = f"/compliance"

                # Recipients: assignee + every super_admin.
                recipients: dict[str, dict] = {}
                if r["assigned_to_user_id"]:
                    arow = conn.execute(
                        text("SELECT id, email, full_name FROM profiles WHERE id = :u"),
                        {"u": r["assigned_to_user_id"]},
                    ).mappings().first()
                    if arow:
                        recipients[str(arow["id"])] = {
                            "id": str(arow["id"]),
                            "email": arow.get("email"),
                            "name": arow.get("full_name"),
                        }
                for sa in super_admins:
                    recipients[str(sa["id"])] = {
                        "id": str(sa["id"]),
                        "email": sa.get("email"),
                        "name": sa.get("full_name"),
                    }
                if not recipients:
                    continue

                for kind in kinds_to_fire:
                    result = conn.execute(
                        text(
                            "INSERT INTO notifications "
                            "  (user_id, notification_type, title, body, link) "
                            "SELECT u.user_id, 'reminder'::public.notification_type, "
                            "       u.title, u.body, u.link "
                            "FROM unnest("
                            "  CAST(:user_ids AS uuid[]), "
                            "  CAST(:titles   AS text[]), "
                            "  CAST(:bodies   AS text[]), "
                            "  CAST(:links    AS text[])"
                            ") AS u(user_id, title, body, link) "
                            "RETURNING id, user_id, notification_type, title, body, link, is_read, created_at"
                        ),
                        {
                            "user_ids": list(recipients.keys()),
                            "titles":   [title] * len(recipients),
                            "bodies":   [body]  * len(recipients),
                            "links":    [link]  * len(recipients),
                        },
                    ).mappings().all()
                    for n in result:
                        broadcast_payloads.append({
                            "id": str(n["id"]),
                            "user_id": str(n["user_id"]),
                            "notification_type": str(n["notification_type"]),
                            "title": n["title"],
                            "body": n["body"],
                            "link": n["link"],
                            "is_read": n["is_read"],
                            "created_at": n["created_at"].isoformat() if hasattr(n["created_at"], "isoformat") else str(n["created_at"]),
                        })

                    # Email best-effort
                    for u in recipients.values():
                        if not u.get("email"):
                            continue
                        body_text = (
                            f"{title}\n\n{body}\n\n"
                            f"— Kiron Work OS"
                        )
                        body_html = (
                            f"<p><strong>{title}</strong></p><p>{body}</p>"
                        )
                        try:
                            send_email(u["email"], title, body_text, body_html)
                        except Exception:  # noqa: BLE001
                            log.exception("Compliance email failed for %s", u.get("email"))

                    conn.execute(
                        text(
                            "INSERT INTO compliance_reminders (occurrence_id, kind) "
                            "VALUES (:o, :k) ON CONFLICT DO NOTHING"
                        ),
                        {"o": str(r["id"]), "k": kind},
                    )
                    summary["fired"] += 1
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _COMPLIANCE_LOCK_KEY})

    log.info(
        "Compliance reminders: generated=%(generated)d fired=%(fired)d",
        summary,
    )
    return summary


def _reminder_copy(
    when_kind: str,
    reminder_kind: str,
    sched_ist: dt.datetime,
    duration_mins: int,
    task_title: str | None,
    contact: str | None,
    task_key: str | None,
) -> tuple[str, str]:
    """Render the (title, body) used for both the in-app notification
    row and the desktop browser-Notification toast. Mirrors the email
    subject/lead shape so the audit story stays consistent."""
    when_short = sched_ist.strftime("%I:%M %p")
    if reminder_kind == "phone_call":
        verb = "Call"
        headline = contact or task_title or "Call"
    elif reminder_kind == "in_person":
        verb = "Meet"
        headline = contact or task_title or "Meeting"
    else:
        verb = "Reminder"
        headline = task_title or contact or "Reminder"

    if when_kind == "morning_of":
        title = f"Today: {verb} {headline} — {when_short}"
    elif when_kind == "t_minus_20":
        title = f"In 20 minutes: {verb} {headline} — {when_short}"
    else:
        title = f"Now: {verb} {headline}"

    body = sched_ist.strftime("%A, %d %b · %I:%M %p IST")
    body += f" · {duration_mins} min"
    if task_key:
        body += f" · {task_key}"
    return title, body


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
# Comp-off advance — nag HR when the planned repay date passes and
# the employee still owes a comp-off (balance is still negative).
#
# Triggered for every leave_request where:
#   - leave_type = 'comp_off'
#   - comp_off_repay_by IS NOT NULL
#   - comp_off_repay_by < today
#   - the employee's current comp_off available balance < 0 (still owes)
#
# Each such advance generates one notification per HR_ROLES user, deduped
# by link ("/leave?repay_overdue=<request_id>") within the last 24h so a
# nightly nag doesn't pile up.
# ------------------------------------------------------------------

_HR_NAG_ROLES = ("hr_admin", "super_admin", "founder")


async def run_comp_off_overdue_check() -> dict:
    summary = {"overdue_advances": 0, "notifications_inserted": 0}
    inserted_payloads: list[dict] = []

    today = dt.datetime.now(_IST).date()
    year = today.year

    with engine.begin() as conn:
        locked = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": _COMP_OFF_OVERDUE_LOCK_KEY},
        ).scalar_one()
        if not locked:
            log.info("comp_off_overdue_check: lock held by another worker, skipping")
            return summary
        try:
            advances = conn.execute(
                text(
                    "SELECT lr.id, lr.user_id, lr.comp_off_repay_by, "
                    "       p.full_name "
                    "FROM leave_requests lr "
                    "JOIN profiles p ON p.id = lr.user_id "
                    "WHERE lr.leave_type = 'comp_off' "
                    "  AND lr.comp_off_repay_by IS NOT NULL "
                    "  AND lr.comp_off_repay_by < :today"
                ),
                {"today": today.isoformat()},
            ).mappings().all()

            if not advances:
                return summary

            hr_user_ids = [
                str(r["user_id"]) for r in conn.execute(
                    text(
                        "SELECT DISTINCT ur.user_id FROM user_roles ur "
                        "JOIN profiles p ON p.id = ur.user_id "
                        "WHERE p.is_active = true AND ur.role::text = ANY(:roles)"
                    ),
                    {"roles": list(_HR_NAG_ROLES)},
                ).mappings().all()
            ]
            if not hr_user_ids:
                return summary

            for adv in advances:
                # Only nag if the employee STILL owes — they may have
                # already worked an off-day since the advance and the
                # balance is back to 0 (or positive).
                bal = conn.execute(
                    text(
                        "SELECT COALESCE(opening, 0) + COALESCE(accrued, 0) "
                        "       + COALESCE(adjustment, 0) - COALESCE(used, 0) AS available "
                        "FROM leave_balances "
                        "WHERE user_id = :u AND year = :y AND leave_type = 'comp_off'"
                    ),
                    {"u": str(adv["user_id"]), "y": year},
                ).mappings().first()
                if bal and float(bal["available"]) >= 0:
                    # Repaid (or no balance row — treat as not-owed too)
                    continue
                summary["overdue_advances"] += 1

                link = f"/leave?repay_overdue={adv['id']}"
                title = f"Comp-off repay overdue: {adv['full_name']}"
                body = (
                    f"Planned to work an off-day by {adv['comp_off_repay_by']}, "
                    "but still owes a comp-off. Follow up or extend the deadline."
                )

                for hr_uid in hr_user_ids:
                    # Dedup: skip if we already nagged this HR about this
                    # advance in the last 24h.
                    existing = conn.execute(
                        text(
                            "SELECT 1 FROM notifications "
                            "WHERE user_id = :u AND link = :l "
                            "  AND created_at > now() - interval '24 hours' "
                            "LIMIT 1"
                        ),
                        {"u": hr_uid, "l": link},
                    ).first()
                    if existing is not None:
                        continue
                    nid = conn.execute(
                        text(
                            "INSERT INTO notifications "
                            "  (user_id, notification_type, title, body, link) "
                            "VALUES (:u, 'general', :t, :b, :l) "
                            "RETURNING id, user_id, notification_type, title, body, link, is_read, created_at"
                        ),
                        {"u": hr_uid, "t": title, "b": body, "l": link},
                    ).mappings().first()
                    summary["notifications_inserted"] += 1
                    inserted_payloads.append({
                        "id": str(nid["id"]),
                        "user_id": str(nid["user_id"]),
                        "notification_type": str(nid["notification_type"]),
                        "title": nid["title"],
                        "body": nid["body"],
                        "link": nid["link"],
                        "is_read": nid["is_read"],
                        "created_at": nid["created_at"].isoformat()
                            if hasattr(nid["created_at"], "isoformat") else str(nid["created_at"]),
                    })
        finally:
            conn.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": _COMP_OFF_OVERDUE_LOCK_KEY},
            )

    # Broadcast outside the DB transaction so a slow WS doesn't hold locks.
    if inserted_payloads:
        from .routers import ws as ws_router
        for p in inserted_payloads:
            try:
                await ws_router.notification_new(p)
            except Exception:  # noqa: BLE001
                log.exception("ws notification_new failed for %s", p.get("id"))

    log.info(
        "comp_off_overdue_check: advances=%(overdue_advances)d "
        "notifications=%(notifications_inserted)d",
        summary,
    )
    return summary


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
    # Vendor renewal reminders — runs hourly to catch new contracts +
    # day-rollover. Idempotent via the (contract_id, end_date) dedup
    # row, so an hourly cadence at most produces one reminder per
    # contract per end_date.
    _scheduler.add_job(
        run_vendor_renewal_reminders,
        trigger="interval",
        hours=1,
        id="vendor_renewal_reminders",
        coalesce=True,
        max_instances=1,
        next_run_time=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=2),
    )
    # Compliance — runs hourly. Generation is cheap (UNIQUE-key
    # dedup); reminders are idempotent via compliance_reminders.
    _scheduler.add_job(
        run_compliance_reminders,
        trigger="interval",
        hours=1,
        id="compliance_reminders",
        coalesce=True,
        max_instances=1,
        next_run_time=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=3),
    )
    # Comp-off advance overdue — runs every 6 hours. Cheap query (small
    # index hit), self-dedups via 24h notification-link uniqueness.
    _scheduler.add_job(
        run_comp_off_overdue_check,
        trigger="interval",
        hours=6,
        id="comp_off_overdue",
        coalesce=True,
        max_instances=1,
        next_run_time=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=4),
    )
    _scheduler.start()
    log.info(
        "Scheduler started — SLA every %d min, call reminders every 1 min, "
        "vendor renewals every 1 h",
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
