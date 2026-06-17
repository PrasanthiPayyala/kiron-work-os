"""Reframe task_calls as "reminders" — add kind + contact columns.

The original feature was framed as scheduling online meetings (Zoom /
Meet / Teams link). In reality the team uses this purely as reminders
on a task — call a contact, meet someone in person, or any other
follow-up. The link field was never required for those use cases.

Schema additions (additive — existing rows stay valid):

- ``kind``    text NOT NULL DEFAULT 'phone_call'
              One of 'phone_call' | 'in_person' | 'other'. Drives the
              email subject + body wording on each reminder.
- ``contact`` text
              Free-text "who to call / where to meet / what is this
              about" — replaces the old "meeting link" field on the UI.
              Stored as plain text; the email body will linkify any
              URL detected inside.

``meeting_link`` stays in the schema so the older c511842 rows are not
broken. The UI just stops surfacing it.

Revision ID: 0017_call_kind_and_contact
Revises: 0016_hides_and_calls
Create Date: 2026-06-17
"""
from alembic import op


revision = "0017_call_kind_and_contact"
down_revision = "0016_hides_and_calls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.task_calls
          ADD COLUMN IF NOT EXISTS kind    text NOT NULL DEFAULT 'phone_call',
          ADD COLUMN IF NOT EXISTS contact text;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.task_calls
          DROP COLUMN IF EXISTS contact,
          DROP COLUMN IF EXISTS kind;
        """
    )
