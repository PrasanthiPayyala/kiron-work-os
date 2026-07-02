"""Shared email-notification helper for leave / permission / comp-off events.

The in-app bell + WebSocket realtime already fire for these flows.
This helper adds email as a second channel so HR (and applicants on
decisions) still get pinged when they aren't on the tab.

Pattern — system sender + Reply-To = counterpart:

    From:     <applicant name> <noreply@innomaxsol.com>
    Reply-To: <applicant email>

The mailbox stays constant (SPF/DKIM/DMARC configured once for
noreply@); the display name is spoofed so Karunya's inbox looks like
Varsha wrote it. Hitting Reply lands in Varsha's actual mailbox.

Callers own their recipient policy — they pass in a list of user IDs.
This helper turns those IDs into emails and schedules the sends as
BackgroundTasks so SMTP latency never delays the API response.
"""
from __future__ import annotations

import logging
from typing import Iterable

from fastapi import BackgroundTasks
from sqlalchemy import text
from sqlalchemy.orm import Session

from .email import send_email

log = logging.getLogger("kiron.notifications_email")


def notify_email(
    background: BackgroundTasks,
    db: Session,
    *,
    to_user_ids: Iterable[str],
    subject: str,
    body_text: str,
    body_html: str | None = None,
    reply_to_user_id: str | None = None,
    from_name_user_id: str | None = None,
) -> None:
    """Schedule fire-and-forget emails to the given user IDs.

    Recipient dedup + email lookup happens here so callers stay concise.
    Silently skips users with no email on file (still logs). SMTP errors
    are trapped in the background task; they never propagate to the
    caller and never break the API response.
    """
    recipients = {str(u) for u in to_user_ids if u}
    if not recipients:
        return

    lookup_ids = set(recipients)
    if reply_to_user_id:
        lookup_ids.add(str(reply_to_user_id))
    if from_name_user_id:
        lookup_ids.add(str(from_name_user_id))

    rows = db.execute(
        text(
            "SELECT id, full_name, email FROM profiles "
            "WHERE id = ANY(:ids)"
        ),
        {"ids": list(lookup_ids)},
    ).mappings().all()
    by_id = {str(r["id"]): r for r in rows}

    reply_to_email = None
    if reply_to_user_id:
        rec = by_id.get(str(reply_to_user_id))
        reply_to_email = rec["email"] if rec and rec.get("email") else None

    from_name_override = None
    if from_name_user_id:
        rec = by_id.get(str(from_name_user_id))
        from_name_override = rec["full_name"] if rec and rec.get("full_name") else None

    for uid in recipients:
        rec = by_id.get(uid)
        if not rec:
            log.warning("[notify_email] user %s not found; skipping", uid)
            continue
        addr = rec.get("email")
        if not addr:
            log.info("[notify_email] user %s has no email on file; skipping", uid)
            continue
        background.add_task(
            _safe_send,
            to=addr,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            reply_to=reply_to_email,
            from_name_override=from_name_override,
        )


def _safe_send(
    *,
    to: str,
    subject: str,
    body_text: str,
    body_html: str | None,
    reply_to: str | None,
    from_name_override: str | None,
) -> None:
    """Wrap send_email so an SMTP failure in a background task logs and
    dies instead of surfacing as a stack trace in uvicorn."""
    try:
        send_email(
            to=to,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            reply_to=reply_to,
            from_name_override=from_name_override,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("[notify_email] SMTP send to %s failed: %s", to, exc)
