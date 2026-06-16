"""Soft-delete columns on messages.

Add `deleted_at` + `deleted_by` so chat messages can be marked deleted
without losing the row (the UI renders a tombstone). Sender can delete
their own; super_admin and founder can delete anyone's for moderation
or confidentiality cleanups.

Revision ID: 0013_message_soft_delete
Revises: 0012_leadership_list
Create Date: 2026-06-16
"""
from alembic import op


revision = "0013_message_soft_delete"
down_revision = "0012_leadership_list"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.messages "
        "  ADD COLUMN IF NOT EXISTS deleted_at timestamptz, "
        "  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id)"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.messages "
        "  DROP COLUMN IF EXISTS deleted_at, "
        "  DROP COLUMN IF EXISTS deleted_by"
    )
