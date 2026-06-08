"""Company + per-employee working hours config

Adds a company-wide default schedule (work_days + daily window) and matching
nullable override columns on profiles. Effective schedule = profile override
if set, else the company default. Read by:
  * Attendance UI (weekend shading)
  * SLA breach scheduler (so a Sunday isn't counted toward the 4-hour warn
    window when a profile's work_days excludes Sunday)
  * Leave day-count logic

Defaults reflect Indian internal-ops norms (Mon-Sat 9:30-18:30). Update via
PATCH /companies/{id} or per-employee via PATCH /users/{id}.

Revision ID: 0006_working_hours
Revises: 0005_force_password_change
Create Date: 2026-06-08
"""
from alembic import op


revision = "0006_working_hours"
down_revision = "0005_force_password_change"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Company-level defaults. work_days uses ISO-like int[] where 1=Mon, 7=Sun,
    # so callers can sort the array and reason about it consistently. We keep
    # 0..6 (Python's date.weekday()? no, JS Date.getDay()? no, ISO-8601 1..7)
    # — picking 1..7 here so it's unambiguous; 1=Mon, 7=Sun.
    op.execute(
        "ALTER TABLE public.companies "
        "ADD COLUMN IF NOT EXISTS work_days int[] NOT NULL DEFAULT '{1,2,3,4,5,6}', "
        "ADD COLUMN IF NOT EXISTS work_start time NOT NULL DEFAULT '09:30', "
        "ADD COLUMN IF NOT EXISTS work_end time NOT NULL DEFAULT '18:30'"
    )

    # Per-employee overrides. NULL = inherit company default. The backend
    # computes the effective schedule when serving /bootstrap and /auth/me.
    op.execute(
        "ALTER TABLE public.profiles "
        "ADD COLUMN IF NOT EXISTS work_days int[], "
        "ADD COLUMN IF NOT EXISTS work_start time, "
        "ADD COLUMN IF NOT EXISTS work_end time"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.profiles "
        "DROP COLUMN IF EXISTS work_days, "
        "DROP COLUMN IF EXISTS work_start, "
        "DROP COLUMN IF EXISTS work_end"
    )
    op.execute(
        "ALTER TABLE public.companies "
        "DROP COLUMN IF EXISTS work_days, "
        "DROP COLUMN IF EXISTS work_start, "
        "DROP COLUMN IF EXISTS work_end"
    )
