"""Income tax slabs + regime config for auto-TDS computation.

Two reference tables. The payroll-run draft generator joins against
these to compute monthly TDS from the employee's annual gross + their
chosen regime, then divides by the working months remaining in the
financial year so mid-year joiners are pro-rated correctly.

Seeded with FY 2025-26 numbers for both regimes — HR maintains the
table in Settings -> Tax slabs when Budget changes land.

Tables:

  tax_slabs (regime, fy_label, min_income, max_income, rate_pct)
    UNIQUE (regime, fy_label, min_income)

  tax_regime_config (regime, fy_label, standard_deduction,
                     rebate_threshold, cess_pct)
    UNIQUE (regime, fy_label)

Revision ID: 0036_tax_slabs
Revises: 0035_payroll_pf_esi_pt
Create Date: 2026-06-30
"""
from alembic import op


revision = "0036_tax_slabs"
down_revision = "0035_payroll_pf_esi_pt"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.tax_slabs (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            regime      text NOT NULL CHECK (regime IN ('new', 'old')),
            fy_label    text NOT NULL,
            min_income  numeric(14,2) NOT NULL,
            max_income  numeric(14,2),
            rate_pct    numeric(5,2) NOT NULL,
            is_active   boolean NOT NULL DEFAULT true,
            created_at  timestamptz NOT NULL DEFAULT now(),
            UNIQUE (regime, fy_label, min_income)
        );
        CREATE INDEX IF NOT EXISTS idx_tax_slabs_lookup
            ON public.tax_slabs(regime, fy_label) WHERE is_active = true;

        CREATE TABLE IF NOT EXISTS public.tax_regime_config (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            regime              text NOT NULL CHECK (regime IN ('new', 'old')),
            fy_label            text NOT NULL,
            standard_deduction  numeric(14,2) NOT NULL DEFAULT 0,
            rebate_threshold    numeric(14,2),
            cess_pct            numeric(5,2) NOT NULL DEFAULT 4,
            is_active           boolean NOT NULL DEFAULT true,
            created_at          timestamptz NOT NULL DEFAULT now(),
            UNIQUE (regime, fy_label)
        );
        """
    )

    # Seed FY 2025-26 new regime (Budget 2025 slabs).
    op.execute(
        """
        INSERT INTO public.tax_slabs (regime, fy_label, min_income, max_income, rate_pct) VALUES
          ('new', 'FY 2025-26',       0,   400000,  0),
          ('new', 'FY 2025-26',  400000,   800000,  5),
          ('new', 'FY 2025-26',  800000,  1200000, 10),
          ('new', 'FY 2025-26', 1200000,  1600000, 15),
          ('new', 'FY 2025-26', 1600000,  2000000, 20),
          ('new', 'FY 2025-26', 2000000,  2400000, 25),
          ('new', 'FY 2025-26', 2400000,     NULL, 30)
        ON CONFLICT (regime, fy_label, min_income) DO NOTHING;

        INSERT INTO public.tax_regime_config
            (regime, fy_label, standard_deduction, rebate_threshold, cess_pct)
        VALUES ('new', 'FY 2025-26', 75000, 1200000, 4)
        ON CONFLICT (regime, fy_label) DO NOTHING;
        """
    )

    # Seed FY 2025-26 old regime (pre-Budget-2025 rates, no major change).
    op.execute(
        """
        INSERT INTO public.tax_slabs (regime, fy_label, min_income, max_income, rate_pct) VALUES
          ('old', 'FY 2025-26',       0,   250000,  0),
          ('old', 'FY 2025-26',  250000,   500000,  5),
          ('old', 'FY 2025-26',  500000,  1000000, 20),
          ('old', 'FY 2025-26', 1000000,     NULL, 30)
        ON CONFLICT (regime, fy_label, min_income) DO NOTHING;

        INSERT INTO public.tax_regime_config
            (regime, fy_label, standard_deduction, rebate_threshold, cess_pct)
        VALUES ('old', 'FY 2025-26', 50000, 500000, 4)
        ON CONFLICT (regime, fy_label) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.tax_regime_config;
        DROP TABLE IF EXISTS public.tax_slabs;
        """
    )
