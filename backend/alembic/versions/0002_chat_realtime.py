"""chat realtime: last_read_at on conversation_members + nullable attachments.entity_id

Revision ID: 0002_chat_realtime
Revises: 0001_baseline
Create Date: 2026-06-03
"""
from alembic import op


revision = "0002_chat_realtime"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Per-member unread tracking — set on connect / when user opens the conversation.
    op.execute(
        "ALTER TABLE public.conversation_members "
        "ADD COLUMN IF NOT EXISTS last_read_at timestamptz"
    )

    # Two-step file flow: upload file first (no entity), then send message
    # referencing the attachment_ids. Backend patches entity_type/entity_id
    # after the message row exists. Allowing NULL here is the minimum change.
    op.execute(
        "ALTER TABLE public.attachments "
        "ALTER COLUMN entity_id DROP NOT NULL"
    )
    op.execute(
        "ALTER TABLE public.attachments "
        "ALTER COLUMN entity_type DROP NOT NULL"
    )

    # Local storage path on disk for the uploaded bytes (when not using object
    # storage). Filled in by the files router.
    op.execute(
        "ALTER TABLE public.attachments "
        "ADD COLUMN IF NOT EXISTS storage_path text"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.attachments DROP COLUMN IF EXISTS storage_path")
    # Best-effort; existing nulls would block tightening NOT NULL back on.
    op.execute("ALTER TABLE public.conversation_members DROP COLUMN IF EXISTS last_read_at")
