"""employment_type + tokens_invalid_after on profiles

Adds:
  * employment_type enum (intern, contract, full_time, temporary, part_time)
  * profiles.employment_type (default full_time; interns backfilled by role)
  * profiles.tokens_invalid_after — bumped on deactivate so existing access /
    refresh tokens stop being honoured.

Revision ID: 0004_employment_lifecycle
Revises: 0003_password_reset
Create Date: 2026-06-06
"""
from alembic import op


revision = "0004_employment_lifecycle"
down_revision = "0003_password_reset"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type') THEN
                CREATE TYPE public.employment_type AS ENUM
                    ('intern','contract','full_time','temporary','part_time');
            END IF;
        END$$;
        """
    )
    op.execute(
        "ALTER TABLE public.profiles "
        "ADD COLUMN IF NOT EXISTS employment_type public.employment_type "
        "NOT NULL DEFAULT 'full_time'"
    )
    op.execute(
        "ALTER TABLE public.profiles "
        "ADD COLUMN IF NOT EXISTS tokens_invalid_after timestamptz"
    )
    # Backfill: anyone whose user_roles contains 'intern' is an intern;
    # everyone else stays on the default full_time.
    op.execute(
        """
        UPDATE public.profiles p
        SET employment_type = 'intern'
        WHERE EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = p.id AND ur.role = 'intern'
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.profiles DROP COLUMN IF EXISTS tokens_invalid_after")
    op.execute("ALTER TABLE public.profiles DROP COLUMN IF EXISTS employment_type")
    op.execute("DROP TYPE IF EXISTS public.employment_type")
