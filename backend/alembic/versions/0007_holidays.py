"""Holiday calendar — per year, per company.

Three types so we can encode "Ramzan is optional", "Christmas is on the
calendar but not observed", and the rest are full company holidays without
needing separate tables.

  gazetted      everyone off, attendance counts the day as 'holiday'
  optional      visible on calendar; employees may apply for leave on the day
                (the leave router stays unchanged — we just light up the date
                in the UI so people know they can take it)
  informational shown on calendar with a muted style; no impact on attendance

company_id is nullable: NULL means the holiday applies to every company
(useful for national holidays). A row with a specific company_id overrides
the global one on the same date.

Revision ID: 0007_holidays
Revises: 0006_working_hours
Create Date: 2026-06-08
"""
from alembic import op


revision = "0007_holidays"
down_revision = "0006_working_hours"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'holiday_type') THEN
                CREATE TYPE public.holiday_type AS ENUM
                    ('gazetted','optional','informational');
            END IF;
        END$$;
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.holidays (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
          date        date NOT NULL,
          name        text NOT NULL,
          type        public.holiday_type NOT NULL DEFAULT 'gazetted',
          notes       text,
          created_by  uuid REFERENCES public.profiles(id),
          created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # One holiday per (company, date, name). Same date can host two names
    # (rare but happens — e.g. Pongal + Sankranthi land back-to-back; not the
    # same day but the unique still gives HR room to move things).
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_company_date_name "
        "ON public.holidays(coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), date, lower(name))"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_holidays_date ON public.holidays(date)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.holidays CASCADE")
    op.execute("DROP TYPE IF EXISTS public.holiday_type")
