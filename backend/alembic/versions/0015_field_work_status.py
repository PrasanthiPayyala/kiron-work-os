"""Add `field_work` to attendance_status enum.

Lets employees mark today's attendance as field work — treated like WFH
or half-day by the follow-up logic (excused from early-checkout flag,
since the employee won't be in the office to check out at end-of-day).

Revision ID: 0015_field_work_status
Revises: 0014_followup_access
Create Date: 2026-06-17
"""
from alembic import op


revision = "0015_field_work_status"
down_revision = "0014_followup_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADD VALUE IF NOT EXISTS requires Postgres 9.6+ and can't run inside
    # a transaction block in older versions — alembic wraps DDL in a tx
    # by default. AUTOCOMMIT-style execution is safer.
    op.execute("ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'field_work'")


def downgrade() -> None:
    # Postgres doesn't support DROP VALUE on enums. The clean downgrade
    # would be to rebuild the type. We accept the one-way addition.
    pass
