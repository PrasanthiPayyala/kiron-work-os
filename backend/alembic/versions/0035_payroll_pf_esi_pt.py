"""Payroll: per-employee PF scheme + ESI eligibility + PT slabs.

Wires actual deduction computation into the payroll-run draft generator
(which until now hardcoded every deduction to zero). Three slices:

1. ``salary_structures`` gets:
     - ``pf_scheme``       — 'none' | 'standard_12pct' | 'capped_15000'
     - ``esi_eligibility`` — 'auto' | 'force_eligible' | 'force_ineligible'
   Both default to the safe no-deduct value so existing structures
   behave exactly as today until HR opts an employee in.

2. ``payslips`` gets ``employer_pf`` + ``employer_esi`` so the snapshot
   carries the employer share alongside the employee deduction
   (auditors ask for both).

3. ``pt_slabs`` new reference table keyed by state, plus
   ``companies.pt_state`` to map an entity to a state. Seeded with
   Andhra Pradesh + Telangana current slabs so Karunya has something
   to look at on day one.

Revision ID: 0035_payroll_pf_esi_pt
Revises: 0034_contacts_linkedin
Create Date: 2026-06-30
"""
from alembic import op


revision = "0035_payroll_pf_esi_pt"
down_revision = "0034_contacts_linkedin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. salary_structures: PF + ESI scheme config ----
    op.execute(
        """
        ALTER TABLE public.salary_structures
            ADD COLUMN IF NOT EXISTS pf_scheme text NOT NULL DEFAULT 'none'
                CHECK (pf_scheme IN ('none','standard_12pct','capped_15000')),
            ADD COLUMN IF NOT EXISTS esi_eligibility text NOT NULL DEFAULT 'auto'
                CHECK (esi_eligibility IN ('auto','force_eligible','force_ineligible'));
        """
    )

    # ---- 2. payslips: employer share snapshot ----
    op.execute(
        """
        ALTER TABLE public.payslips
            ADD COLUMN IF NOT EXISTS employer_pf  numeric(14,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS employer_esi numeric(14,2) NOT NULL DEFAULT 0;
        """
    )

    # ---- 3a. pt_slabs reference table ----
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.pt_slabs (
            id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            state      text NOT NULL,
            min_gross  numeric(14,2) NOT NULL,
            max_gross  numeric(14,2),
            amount     numeric(14,2) NOT NULL,
            is_active  boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (state, min_gross)
        );
        CREATE INDEX IF NOT EXISTS idx_pt_slabs_state_active
            ON public.pt_slabs(state) WHERE is_active = true;
        """
    )

    # ---- 3b. companies.pt_state ----
    op.execute(
        """
        ALTER TABLE public.companies
            ADD COLUMN IF NOT EXISTS pt_state text;
        """
    )

    # ---- 3c. Seed AP + TG PT slabs (current rates) ----
    # ON CONFLICT keeps re-runs idempotent.
    op.execute(
        """
        INSERT INTO public.pt_slabs (state, min_gross, max_gross, amount) VALUES
          ('AP',     0,     15000,  0),
          ('AP', 15000,     20000, 150),
          ('AP', 20000,      NULL, 200),
          ('TG',     0,     15000,  0),
          ('TG', 15000,     20000, 150),
          ('TG', 20000,      NULL, 200)
        ON CONFLICT (state, min_gross) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.companies
            DROP COLUMN IF EXISTS pt_state;
        DROP TABLE IF EXISTS public.pt_slabs;
        ALTER TABLE public.payslips
            DROP COLUMN IF EXISTS employer_pf,
            DROP COLUMN IF EXISTS employer_esi;
        ALTER TABLE public.salary_structures
            DROP COLUMN IF EXISTS pf_scheme,
            DROP COLUMN IF EXISTS esi_eligibility;
        """
    )
