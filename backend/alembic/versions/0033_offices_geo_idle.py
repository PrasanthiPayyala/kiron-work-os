"""Offices, geo on check-in, idle intervals.

Adds three independent slices in one migration so deploy is one alembic
upgrade head:

1. ``public.offices`` — per-company addressable locations with a
   geofence (lat / lng + radius_m). Lets the geofence check fire only
   for employees we've assigned to a specific office, so existing
   employees without one keep checking in normally until HR backfills.

2. ``public.profiles.office_id`` — nullable FK to offices. Drives the
   geofence on check-in.

3. ``public.attendance_logs`` gains:
     - check_in_lat / check_in_lng / check_in_accuracy_m (captured from
       navigator.geolocation when the employee allows it)
     - geo_denied (true when the browser refused the permission, or
       the timeout elapsed without a reading)
     - geo_outside_office (true when distance from the employee's office
       exceeded the radius — Karunya reviews flagged rows on Team
       Attendance)
     - idle_minutes (daily aggregate of inactivity gaps; subtracted from
       worked hours in the HoursSummaryCard rollup)

4. ``public.idle_intervals`` — raw audit row per idle interval the
   client detected. attendance_logs.idle_minutes is the cheap aggregate
   used by the rollup; the intervals table is HR-only detail if ever
   needed.

Everything is nullable / defaulted so existing 26 employees' rows are
not disturbed. No backfill — Karunya creates offices + assigns
employees + the geo + idle data starts flowing for new logs only.

Revision ID: 0033_offices_geo_idle
Revises: 0032_attendance_permissions
Create Date: 2026-06-30
"""
from alembic import op


revision = "0033_offices_geo_idle"
down_revision = "0032_attendance_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- 1. Offices ----------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.offices (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
            name        text NOT NULL,
            address     text,
            latitude    numeric(10,7),
            longitude   numeric(10,7),
            radius_m    int NOT NULL DEFAULT 200
                        CHECK (radius_m > 0 AND radius_m <= 10000),
            is_active   boolean NOT NULL DEFAULT true,
            created_at  timestamptz NOT NULL DEFAULT now(),
            UNIQUE (company_id, name)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_offices_company_active
            ON public.offices (company_id)
            WHERE is_active = true;
        """
    )

    # ---------- 2. profiles.office_id ----------
    op.execute(
        """
        ALTER TABLE public.profiles
            ADD COLUMN IF NOT EXISTS office_id uuid REFERENCES public.offices(id);
        """
    )

    # ---------- 3. attendance_logs additive columns ----------
    op.execute(
        """
        ALTER TABLE public.attendance_logs
            ADD COLUMN IF NOT EXISTS check_in_lat        numeric(10,7),
            ADD COLUMN IF NOT EXISTS check_in_lng        numeric(10,7),
            ADD COLUMN IF NOT EXISTS check_in_accuracy_m int,
            ADD COLUMN IF NOT EXISTS geo_denied          boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS geo_outside_office  boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS idle_minutes        int NOT NULL DEFAULT 0;
        """
    )

    # ---------- 4. idle_intervals ----------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.idle_intervals (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            work_date   date NOT NULL,
            started_at  timestamptz NOT NULL,
            ended_at    timestamptz NOT NULL,
            minutes     int NOT NULL CHECK (minutes > 0),
            source      text NOT NULL CHECK (source IN ('idle', 'hidden')),
            created_at  timestamptz NOT NULL DEFAULT now(),
            -- Same (user, start) twice = idempotent POST retry, ignore the
            -- second one. Prevents double-counting if the client retries.
            UNIQUE (user_id, started_at)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_idle_intervals_user_date
            ON public.idle_intervals (user_id, work_date DESC);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.idx_idle_intervals_user_date;")
    op.execute("DROP TABLE IF EXISTS public.idle_intervals;")
    op.execute(
        """
        ALTER TABLE public.attendance_logs
            DROP COLUMN IF EXISTS idle_minutes,
            DROP COLUMN IF EXISTS geo_outside_office,
            DROP COLUMN IF EXISTS geo_denied,
            DROP COLUMN IF EXISTS check_in_accuracy_m,
            DROP COLUMN IF EXISTS check_in_lng,
            DROP COLUMN IF EXISTS check_in_lat;
        """
    )
    op.execute("ALTER TABLE public.profiles DROP COLUMN IF EXISTS office_id;")
    op.execute("DROP INDEX IF EXISTS public.idx_offices_company_active;")
    op.execute("DROP TABLE IF EXISTS public.offices;")
