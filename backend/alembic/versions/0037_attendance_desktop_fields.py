"""Attendance logs get desktop-agent identifying columns + heartbeat.

Additive fields for the Kiron Presence Client (desktop tracking agent):

- ``device_id`` — stable per-install UUID the client generates on first
  launch and stores in the OS keychain. Lets HR distinguish two check-ins
  from the same user across devices (rare, e.g. desk PC vs laptop).
- ``client_version`` — semver of the desktop app. Surfaced in the
  Settings → Desktop agents dashboard so HR can spot machines lagging on
  auto-update.
- ``hostname`` — machine name (COMPUTERNAME on Windows, gethostname on
  Mac). Useful for the same triage — "which laptop was Nabeela on?".
- ``last_heartbeat_at`` — bumped every ~5 min by ``POST /attendance/heartbeat``.
  The auto-close scheduler uses this to close sessions where the app was
  killed without the shutdown hook firing.

Partial index on last_heartbeat_at scoped to open sessions (check_out_at
NULL) — the auto-close query only ever reads those, no point indexing
the historical closed rows.

Everything nullable / defaulted so today's 26 employees' existing rows
are untouched. Web check-ins keep working — they simply don't set these
fields, and the frontend just renders the "via" chip as "Web".

Revision ID: 0037_attendance_desktop_fields
Revises: 0036_tax_slabs
Create Date: 2026-07-03
"""
from alembic import op


revision = "0037_attendance_desktop_fields"
down_revision = "0036_tax_slabs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.attendance_logs
            ADD COLUMN IF NOT EXISTS device_id         text,
            ADD COLUMN IF NOT EXISTS client_version    text,
            ADD COLUMN IF NOT EXISTS hostname          text,
            ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
        """
    )
    # Only open sessions matter for the auto-close scheduler — closed
    # rows sit inert. Keeps the index small (< a day's rows at any time).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_attendance_logs_last_heartbeat_open
            ON public.attendance_logs (last_heartbeat_at)
            WHERE check_out_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.idx_attendance_logs_last_heartbeat_open;")
    op.execute(
        """
        ALTER TABLE public.attendance_logs
            DROP COLUMN IF EXISTS last_heartbeat_at,
            DROP COLUMN IF EXISTS hostname,
            DROP COLUMN IF EXISTS client_version,
            DROP COLUMN IF EXISTS device_id;
        """
    )
