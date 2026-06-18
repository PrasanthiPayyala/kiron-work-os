"""Expense claims + reimbursements.

Phase 9 of approved roadmap. The "I paid for taxi/snacks/courier on
the company's behalf, please pay me back" flow. Today there's no
record-keeping for it — these claims happen on WhatsApp and get
forgotten.

V1 schema is intentionally one-table:

- ``expense_claims`` — id, claimant user_id, the entity paying
  (company_id), category, description, amount + currency,
  expense_date, status, approver + reimbursement metadata, notes.

Bills / receipts use the existing ``attachments`` table with
entity_type='expense_claim' so we don't duplicate file plumbing.

Lifecycle (kept linear for V1 — no manager-vs-finance split):
   submitted → approved → reimbursed
   submitted → rejected
HR / super_admin / founder / founder's office can approve, reject, or
mark reimbursed. Claimant can edit (or delete) while still submitted.
A V2 manager-step is straightforward to add later (this commit doesn't
preclude it — the schema just has nothing for it yet).

Revision ID: 0027_expenses
Revises: 0026_compliance
Create Date: 2026-06-17
"""
from alembic import op


revision = "0027_expenses"
down_revision = "0026_compliance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.expense_claims (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            company_id      uuid REFERENCES public.companies(id),
            -- Free text — common values surfaced in the UI:
            --   travel, food, office_supplies, marketing, utility,
            --   professional_fees, internet_phone, fuel, courier,
            --   conveyance, training, software, other
            category        text NOT NULL DEFAULT 'other',
            description     text NOT NULL,
            amount          numeric(14,2) NOT NULL CHECK (amount > 0),
            currency        text NOT NULL DEFAULT 'INR',
            expense_date    date NOT NULL,

            -- submitted | approved | rejected | reimbursed
            status          text NOT NULL DEFAULT 'submitted',
            reject_reason   text,

            -- Approval metadata. ``approver_id`` is the HR/finance
            -- user who flipped status → approved (or rejected). When
            -- reimbursed_at is set, the chain is complete.
            approver_id     uuid REFERENCES public.profiles(id),
            decided_at      timestamptz,

            reimbursed_at   timestamptz,
            reimbursed_by   uuid REFERENCES public.profiles(id),
            reimbursement_reference text,
            reimbursement_mode      text,

            notes           text,
            created_at      timestamptz NOT NULL DEFAULT now(),
            updated_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_expense_claims_user
            ON public.expense_claims(user_id, expense_date DESC);
        CREATE INDEX IF NOT EXISTS idx_expense_claims_status
            ON public.expense_claims(status);
        CREATE INDEX IF NOT EXISTS idx_expense_claims_company
            ON public.expense_claims(company_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.expense_claims;")
