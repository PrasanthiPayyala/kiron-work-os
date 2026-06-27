"""Comp-off advance: capture the planned repay date.

When HR (or an employee) takes a comp-off as an "advance" — leave now,
work a future off-day to repay — we want a structured field for the
date they plan to work, not just a marker buried in the reason text.
This unlocks:

* HR can review "who owes me a comp-off and when" without grep-ing.
* The scheduler can nudge HR when the planned repay date passes
  without an actual approved off-day comp-off appearing on the
  employee's record (see scheduler.py comp_off_repay_overdue task).
* Future final-settlement / payroll deductions have a clean ledger
  to pull from.

Nullable — most leaves don't carry this. Only the comp_off_advance
UI variant populates it.

Revision ID: 0031_comp_off_repay_by
Revises: 0030_comp_off_earning
Create Date: 2026-06-27
"""
from alembic import op


revision = "0031_comp_off_repay_by"
down_revision = "0030_comp_off_earning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.leave_requests
            ADD COLUMN IF NOT EXISTS comp_off_repay_by date;
        """
    )
    # Partial index — the only query that touches this is the scheduler's
    # nightly "who still owes a comp-off?" sweep.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_leave_requests_comp_off_repay_by
            ON public.leave_requests (comp_off_repay_by)
            WHERE comp_off_repay_by IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.idx_leave_requests_comp_off_repay_by;")
    op.execute(
        "ALTER TABLE public.leave_requests DROP COLUMN IF EXISTS comp_off_repay_by;"
    )
