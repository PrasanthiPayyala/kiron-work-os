"""Per-user opt-in to the Attendance Follow-up view.

Most managers (super_admin / founder / hr_admin / founder_office_coordinator)
get the follow-up view by role. A small set of TA / recruitment staff
(Lalitha, Jakeer, Varsha, etc.) need to see it without being promoted
out of `employee`. This column lets HR opt them in individually.

Revision ID: 0014_followup_access
Revises: 0013_message_soft_delete
Create Date: 2026-06-17
"""
from alembic import op


revision = "0014_followup_access"
down_revision = "0013_message_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.profiles "
        "  ADD COLUMN IF NOT EXISTS attendance_followup_access "
        "  boolean NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.profiles "
        "  DROP COLUMN IF EXISTS attendance_followup_access"
    )
