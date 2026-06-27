"""Comp-off earning on off-day work.

Until now `comp_off` worked only on the spending side — employees could
apply for it as a leave type, but the only way to *earn* the balance was
HR bumping the `adjustment` column manually. There was no record on the
attendance log saying "this Saturday was a 2nd/4th Saturday and the
employee chose to work it."

This migration adds two columns to ``attendance_logs``:

* ``comp_off_earned``  numeric(3,1) NULL — how many comp-off days this
  row earned the employee. 1.0 for a full day worked on an off-day,
  0.5 for half-day. NULL = nothing earned (regular working day, or
  off-day check-in already credited and processed).
* ``comp_off_status`` public.comp_off_status NULL — workflow state for
  the earned credit:
    - ``pending``  — employee checked in on an off-day, HR hasn't
                     reviewed yet. Balance NOT yet credited.
    - ``approved`` — HR approved; balance HAS been credited (the
                     attendance.py decide-comp-off endpoint called
                     apply_balance_delta with a negative `used` delta).
    - ``denied``   — HR denied; no credit. Row stays for the audit
                     trail (you can see who tried and was rejected).
  NULL on regular-day rows. Auto-set to 'pending' on off-day check-in.

The pair is intentionally separate from the existing `status` /
`source` columns — those describe the work itself (present / half-day
/ WFH; self_checkin / hr_marked_leave). Comp-off is an orthogonal
accounting fact: "did this work entitle them to a future day off?"

Revision ID: 0030_comp_off_earning
Revises: 0029_company_ledger
Create Date: 2026-06-27
"""
from alembic import op


revision = "0030_comp_off_earning"
down_revision = "0029_company_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE public.comp_off_status AS ENUM ('pending', 'approved', 'denied');
        EXCEPTION WHEN duplicate_object THEN null; END $$;
        """
    )
    op.execute(
        """
        ALTER TABLE public.attendance_logs
            ADD COLUMN IF NOT EXISTS comp_off_earned numeric(3,1),
            ADD COLUMN IF NOT EXISTS comp_off_status public.comp_off_status,
            ADD COLUMN IF NOT EXISTS comp_off_decided_by uuid REFERENCES public.profiles(id),
            ADD COLUMN IF NOT EXISTS comp_off_decided_at timestamptz;
        """
    )
    # Partial index — the only query that touches these columns is
    # "show me pending comp-offs for the Team Attendance review queue".
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_attendance_logs_pending_comp_off
            ON public.attendance_logs (work_date DESC)
            WHERE comp_off_status = 'pending';
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.idx_attendance_logs_pending_comp_off;")
    op.execute(
        """
        ALTER TABLE public.attendance_logs
            DROP COLUMN IF EXISTS comp_off_decided_at,
            DROP COLUMN IF EXISTS comp_off_decided_by,
            DROP COLUMN IF EXISTS comp_off_status,
            DROP COLUMN IF EXISTS comp_off_earned;
        """
    )
    op.execute("DROP TYPE IF EXISTS public.comp_off_status;")
