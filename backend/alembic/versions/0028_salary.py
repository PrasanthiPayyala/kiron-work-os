"""Salary structures + payroll runs + payslips.

Phase 10 (final) of approved roadmap. The "what did Karunya draw this
month, what's the breakup, when was it paid" surface — today
fragmented across Excel, WhatsApp, and the CA's records.

Three tables:

- ``salary_structures``  — versioned CTC config per employee. Each
                            row carries the monthly earnings + flags.
                            New version = new row with
                            effective_from set; the prior row's
                            effective_to is stamped to the day
                            before. The "current" structure is the
                            row where effective_to IS NULL.
- ``payroll_runs``       — one row per (company, period) like
                            "Heal · 2026-06". Created in 'draft' by
                            HR, finalized + marked paid down the
                            line. UNIQUE on (company_id, period).
- ``payslips``           — per-employee row inside a run. Carries
                            the full breakup (each earnings + each
                            deduction stored as its own numeric
                            column for query/report ease — no jsonb
                            here so monthly totals are SQL-friendly).
                            Status: 'draft' | 'finalized' | 'paid'.
                            Mirrors the run's status by default but
                            can diverge (e.g. paid early for one
                            employee).

V1 keeps the model simple: no pro-rating for partial months, no auto
TDS calc (manual entry), no PDF — the frontend renders a print-ready
HTML page that browsers turn into a PDF on demand. Server-side PDF +
auto-TDS land in V1.5 once HR has the data flowing.

Revision ID: 0028_salary
Revises: 0027_expenses
Create Date: 2026-06-17
"""
from alembic import op


revision = "0028_salary"
down_revision = "0027_expenses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.salary_structures (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            effective_from      date NOT NULL,
            effective_to        date,

            -- Monthly earnings components (₹)
            basic               numeric(14,2) NOT NULL DEFAULT 0,
            hra                 numeric(14,2) NOT NULL DEFAULT 0,
            conveyance          numeric(14,2) NOT NULL DEFAULT 0,
            medical             numeric(14,2) NOT NULL DEFAULT 0,
            lta                 numeric(14,2) NOT NULL DEFAULT 0,
            special_allowance   numeric(14,2) NOT NULL DEFAULT 0,
            other_earnings      numeric(14,2) NOT NULL DEFAULT 0,

            -- Employer contributions (for total-CTC display, not deducted)
            employer_pf         numeric(14,2) NOT NULL DEFAULT 0,
            employer_esi        numeric(14,2) NOT NULL DEFAULT 0,
            employer_other      numeric(14,2) NOT NULL DEFAULT 0,

            -- TDS regime hint — UI uses this to suggest the right
            -- monthly TDS amount; actual TDS is entered per payslip.
            tds_regime          text NOT NULL DEFAULT 'new',

            notes               text,
            created_at          timestamptz NOT NULL DEFAULT now(),
            created_by          uuid REFERENCES public.profiles(id),
            updated_at          timestamptz NOT NULL DEFAULT now(),
            updated_by          uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_salary_structures_user
            ON public.salary_structures(user_id, effective_from DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_structures_current
            ON public.salary_structures(user_id) WHERE effective_to IS NULL;

        CREATE TABLE IF NOT EXISTS public.payroll_runs (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
            -- YYYY-MM. char(7) so the index is predictable.
            period          char(7) NOT NULL,
            status          text NOT NULL DEFAULT 'draft',
            notes           text,
            created_at      timestamptz NOT NULL DEFAULT now(),
            created_by      uuid REFERENCES public.profiles(id),
            finalized_at    timestamptz,
            finalized_by    uuid REFERENCES public.profiles(id),
            paid_at         timestamptz,
            paid_by         uuid REFERENCES public.profiles(id),
            UNIQUE (company_id, period)
        );
        CREATE INDEX IF NOT EXISTS idx_payroll_runs_period
            ON public.payroll_runs(period DESC);

        CREATE TABLE IF NOT EXISTS public.payslips (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            payroll_run_id  uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
            user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            period          char(7) NOT NULL,

            -- Earnings (snapshot at run time — survives later structure edits)
            basic               numeric(14,2) NOT NULL DEFAULT 0,
            hra                 numeric(14,2) NOT NULL DEFAULT 0,
            conveyance          numeric(14,2) NOT NULL DEFAULT 0,
            medical             numeric(14,2) NOT NULL DEFAULT 0,
            lta                 numeric(14,2) NOT NULL DEFAULT 0,
            special_allowance   numeric(14,2) NOT NULL DEFAULT 0,
            other_earnings      numeric(14,2) NOT NULL DEFAULT 0,
            gross_earnings      numeric(14,2) NOT NULL DEFAULT 0,

            -- Deductions
            pf_employee         numeric(14,2) NOT NULL DEFAULT 0,
            esi_employee        numeric(14,2) NOT NULL DEFAULT 0,
            pt_employee         numeric(14,2) NOT NULL DEFAULT 0,
            tds                 numeric(14,2) NOT NULL DEFAULT 0,
            other_deductions    numeric(14,2) NOT NULL DEFAULT 0,
            total_deductions    numeric(14,2) NOT NULL DEFAULT 0,

            net_pay             numeric(14,2) NOT NULL DEFAULT 0,

            status              text NOT NULL DEFAULT 'draft',
            paid_at             timestamptz,
            paid_by             uuid REFERENCES public.profiles(id),
            payment_reference   text,
            payment_mode        text,

            notes               text,
            created_at          timestamptz NOT NULL DEFAULT now(),

            UNIQUE (payroll_run_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_payslips_user
            ON public.payslips(user_id, period DESC);
        CREATE INDEX IF NOT EXISTS idx_payslips_status
            ON public.payslips(status);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.payslips;
        DROP TABLE IF EXISTS public.payroll_runs;
        DROP TABLE IF EXISTS public.salary_structures;
        """
    )
