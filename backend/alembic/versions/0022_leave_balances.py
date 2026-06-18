"""Leave balance accounting — policies + per-employee balance tracking.

Phase 4 of approved roadmap. Today's flow only approves/rejects leave;
nothing tracks how many days are left. This adds:

- Three more leave_type enum values: earned_leave, maternity_leave,
  paternity_leave. The existing casual_leave / sick_leave / comp_off
  already exist; loss_of_pay / work_from_home / optional_holiday stay
  but won't have a balance row (they're either unpaid or not really
  "leave consumption").

- ``leave_policies`` — per-company, per-type quota + carry-forward
  rules. Each company can set its own quotas; if a row is missing for
  a type, the balance system treats it as 0.

- ``leave_balances`` — one row per (user, year, leave_type). Stores
  opening, accrued, used, manual_adjustment. The "available" balance
  the UI shows is computed = opening + accrued + adjustment - used.

The auto-deduct logic lives in app/routers/leave.py (touched in the
matching code change). On approval we += used by the request's days;
on revert (cancel after approve) we -= used.

Revision ID: 0022_leave_balances
Revises: 0021_projects_expansion
Create Date: 2026-06-17
"""
from alembic import op


revision = "0022_leave_balances"
down_revision = "0021_projects_expansion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend the enum first. Each ADD VALUE runs in its own implicit
    # autocommit (mirrors migration 0015's pattern).
    op.execute("ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'earned_leave'")
    op.execute("ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'maternity_leave'")
    op.execute("ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'paternity_leave'")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.leave_policies (
            id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
            leave_type         text NOT NULL,
            annual_quota       numeric(5,2) NOT NULL DEFAULT 0,
            carry_forward_max  numeric(5,2) NOT NULL DEFAULT 0,
            -- 'upfront' = full quota credited at year start;
            -- 'monthly' = quota / 12 added per month (1 dp accrual).
            accrual_kind       text NOT NULL DEFAULT 'upfront',
            is_paid            boolean NOT NULL DEFAULT true,
            notes              text,
            created_at         timestamptz NOT NULL DEFAULT now(),
            updated_at         timestamptz NOT NULL DEFAULT now(),
            UNIQUE (company_id, leave_type)
        );
        CREATE INDEX IF NOT EXISTS idx_leave_policies_company ON public.leave_policies(company_id);

        CREATE TABLE IF NOT EXISTS public.leave_balances (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            year        int  NOT NULL,
            leave_type  text NOT NULL,
            opening     numeric(5,2) NOT NULL DEFAULT 0,
            accrued     numeric(5,2) NOT NULL DEFAULT 0,
            used        numeric(5,2) NOT NULL DEFAULT 0,
            adjustment  numeric(5,2) NOT NULL DEFAULT 0,
            created_at  timestamptz NOT NULL DEFAULT now(),
            updated_at  timestamptz NOT NULL DEFAULT now(),
            UNIQUE (user_id, year, leave_type)
        );
        CREATE INDEX IF NOT EXISTS idx_leave_balances_user ON public.leave_balances(user_id, year);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.leave_balances;
        DROP TABLE IF EXISTS public.leave_policies;
        -- Enum values stay; Postgres has no DROP VALUE.
        """
    )
