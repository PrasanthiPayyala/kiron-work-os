"""Attendance permissions: hourly slips (late-in / early-out / mid-out).

Existing flow only modelled FULL-day leave (leave_requests) and partial
"half_day" status on attendance_logs. There was no way to record
"approved to come in 2 hours late tomorrow" or "approved to leave 30
minutes early today" — those events just showed up as late/early in
the follow-up bucket and looked like compliance breaches.

This migration adds one table:

* ``attendance_permissions`` — hour-scale signed-off shortfalls. Rows
  carry a kind (late_in / early_out / mid_out), a minute count,
  optional reason, and a status (pending / approved / rejected).
  Employees create rows themselves; HR/manager flips status. HR can
  also create rows pre-approved (status=approved, decided_by=self) as
  a retroactive override.

Hours-vs-expected calculations subtract approved permission minutes
from expected hours so a permitted late-in doesn't show as a deficit.

Revision ID: 0032_attendance_permissions
Revises: 0031_comp_off_repay_by
Create Date: 2026-06-30
"""
from alembic import op


revision = "0032_attendance_permissions"
down_revision = "0031_comp_off_repay_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE public.attendance_permission_kind AS ENUM (
                'late_in', 'early_out', 'mid_out'
            );
        EXCEPTION WHEN duplicate_object THEN null; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE public.attendance_permission_status AS ENUM (
                'pending', 'approved', 'rejected'
            );
        EXCEPTION WHEN duplicate_object THEN null; END $$;
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.attendance_permissions (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            date            date NOT NULL,
            kind            public.attendance_permission_kind NOT NULL,
            -- Minutes the employee is excused from. Capped at 12h (720) so
            -- a typo can't accidentally wipe out an entire month's hours.
            minutes         int NOT NULL CHECK (minutes > 0 AND minutes <= 720),
            reason          text,
            status          public.attendance_permission_status NOT NULL DEFAULT 'pending',
            -- Who filed the request. For employee-initiated rows this is
            -- the employee themselves; for HR retroactive grants it's the
            -- HR user (and status starts 'approved' in the same INSERT).
            requested_by    uuid NOT NULL REFERENCES public.profiles(id),
            decided_by      uuid REFERENCES public.profiles(id),
            decided_at      timestamptz,
            decision_note   text,
            created_at      timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    # Index for "show me this user's permissions in date range" and the
    # HR-side "show pending for everyone" query.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_attendance_permissions_user_date
            ON public.attendance_permissions (user_id, date DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_attendance_permissions_pending
            ON public.attendance_permissions (date DESC)
            WHERE status = 'pending';
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.idx_attendance_permissions_pending;")
    op.execute("DROP INDEX IF EXISTS public.idx_attendance_permissions_user_date;")
    op.execute("DROP TABLE IF EXISTS public.attendance_permissions;")
    op.execute("DROP TYPE IF EXISTS public.attendance_permission_status;")
    op.execute("DROP TYPE IF EXISTS public.attendance_permission_kind;")
