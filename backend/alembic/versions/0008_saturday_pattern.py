"""Saturday-of-month working pattern (e.g. 2nd & 4th Saturday off)

Adds a nullable `saturday_weeks_working int[]` to both companies and profiles.
Semantics:
  * NULL                  -> every Saturday is a working day (back-compat with
                             rows from 0006_working_hours where Saturday is in
                             work_days). Existing rows are unaffected.
  * '{1,3,5}'             -> 1st, 3rd, 5th Saturdays of the month are working;
                             2nd and 4th are off (the Indian-corporate norm).
  * any non-empty subset  -> only those Saturday-of-month positions are working.

The column has no effect when Saturday (6) is not in work_days at all.
On profiles, NULL means "inherit the company value" (same convention used by
0006_working_hours for work_days/work_start/work_end).

Read by the frontend's getEffectiveSchedule() + isNonWorkingDate() helpers;
the backend treats it as opaque metadata stored alongside the schedule.

Revision ID: 0008_saturday_pattern
Revises: 0007_holidays
Create Date: 2026-06-08
"""
from alembic import op


revision = "0008_saturday_pattern"
down_revision = "0007_holidays"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.companies "
        "ADD COLUMN IF NOT EXISTS saturday_weeks_working int[]"
    )
    op.execute(
        "ALTER TABLE public.profiles "
        "ADD COLUMN IF NOT EXISTS saturday_weeks_working int[]"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.profiles DROP COLUMN IF EXISTS saturday_weeks_working"
    )
    op.execute(
        "ALTER TABLE public.companies DROP COLUMN IF EXISTS saturday_weeks_working"
    )
