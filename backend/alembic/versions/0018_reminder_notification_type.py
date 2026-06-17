"""Add 'reminder' to notification_type enum.

Pivot from email-only to in-app + WS-driven notifications for task
reminders. Each call fire (morning_of / T-20 / T-0) inserts a row into
``notifications`` keyed off this new enum value; the existing topbar
bell + /notifications page + WebSocket pipeline pick it up unchanged.
Email stays as a best-effort secondary channel (logs to stdout when
SMTP isn't configured — see app/email.py).

Postgres won't let us ADD VALUE inside a transaction in older versions;
``op.execute`` runs in autocommit mode, which is the safe pattern we
already use for the other enum-extending migrations (0015).

Revision ID: 0018_reminder_notification_type
Revises: 0017_call_kind_and_contact
Create Date: 2026-06-17
"""
from alembic import op


revision = "0018_reminder_notification_type"
down_revision = "0017_call_kind_and_contact"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'reminder'")


def downgrade() -> None:
    # Postgres doesn't support DROP VALUE on enums. One-way addition.
    pass
