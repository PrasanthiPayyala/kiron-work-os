"""Company finance ledger — unified per-entity cash book.

Phase 11 (post-roadmap, on user request). The shipped finance modules
each cover a narrow slice (employee reimbursements, vendor contracts +
payments, salary, compliance, asset capex). None of them, alone or
combined, gives the founder's office a per-entity cash book that
matches the Excel ledger they actually run today.

This migration adds one table:

- ``ledger_entries`` — every money movement, both IN (client credits,
  refunds, founder capital infusion) and OUT (everything from DMart
  groceries to GST late fees to vendor payments). Auto-populated from
  the other finance modules via app/ledger_link.py; manual rows for
  ad-hoc payees (carpenter, cleaning lady, Uber rides).

Key fields the V1 must carry beyond a vanilla expense row:

* Multi-currency: amount + currency + fx_rate + amount_inr. INR
  equivalent is always written so monthly / yearly rollups don't have
  to re-convert.
* Payer side: bank_account_id (when money left a company bank),
  payer_user_id (when a founder / staff fronted from a personal
  account — creates the "company owes Prashanti" liability),
  source_label (free text for petty cash / personal card cases).
* Payee side: vendor_id OR user_id OR contact_id OR free-text + UPI
  identifier. Matches the "send to" column in the old Excel.
* Tax: gst_amount + hsn_code, tds_amount + tds_section.
* Reimbursement: reimbursable + reimbursed_at/by — tracks what the
  company still owes founders / staff who fronted money.
* Reconciliation + advance settlement: reconciled_at flag for future
  bank-statement matching, settles_entry_id self-FK so an actuals row
  can clear an earlier advance row.
* Auto-link: source_kind + source_id point back to the originating
  module row. UNIQUE PARTIAL INDEX prevents two ledger rows from
  claiming the same source. Manual rows have source_kind='manual'
  and source_id NULL.

Authz lives in the router. Manage roles: super_admin, founder,
founder_office_coordinator, founder_office_support, hr_admin.

Revision ID: 0029_company_ledger
Revises: 0028_salary
Create Date: 2026-06-18
"""
from alembic import op


revision = "0029_company_ledger"
down_revision = "0028_salary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.ledger_entries (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
            txn_date        date NOT NULL,
            direction       text NOT NULL CHECK (direction IN ('in', 'out')),

            -- Money
            amount          numeric(14,2) NOT NULL CHECK (amount > 0),
            currency        text NOT NULL DEFAULT 'INR',
            -- fx_rate is multiplier: amount_inr = amount * fx_rate.
            -- NULL when currency = INR (or unknown — UI defaults to 1).
            fx_rate         numeric(14,6),
            -- Always populated; computed from amount * fx_rate on
            -- insert/update by the router. Lets monthly + by-category
            -- summaries stay in plain SQL without re-conversion.
            amount_inr      numeric(14,2) NOT NULL,

            -- Categorisation
            category        text NOT NULL DEFAULT 'other',
            sub_category    text,
            payment_mode    text,

            -- Source of funds (Payer)
            bank_account_id uuid REFERENCES public.company_bank_accounts(id),
            payer_user_id   uuid REFERENCES public.profiles(id),
            source_label    text,

            -- Payee — one of vendor / employee / contact, or ad-hoc text.
            payee_vendor_id  uuid REFERENCES public.vendors(id),
            payee_user_id    uuid REFERENCES public.profiles(id),
            payee_contact_id uuid REFERENCES public.contacts(id),
            payee_text       text,
            payee_identifier text,

            description text NOT NULL,
            reference   text,

            -- Tax
            gst_amount  numeric(14,2),
            hsn_code    text,
            tds_amount  numeric(14,2),
            tds_section text,

            -- Reimbursement (founder-fronted entries)
            reimbursable   boolean NOT NULL DEFAULT false,
            reimbursed_at  timestamptz,
            reimbursed_by  uuid REFERENCES public.profiles(id),

            -- Reconciliation + advance settlement
            reconciled_at      timestamptz,
            settles_entry_id   uuid REFERENCES public.ledger_entries(id),

            -- Auto-link to originating module row.
            -- source_kind in: manual | vendor_payment | expense_claim |
            --                 payslip | compliance | asset
            source_kind text NOT NULL DEFAULT 'manual',
            source_id   uuid,

            -- Optional cost-center attribution
            project_id  uuid REFERENCES public.projects(id),
            notes       text,

            created_at  timestamptz NOT NULL DEFAULT now(),
            created_by  uuid REFERENCES public.profiles(id),
            updated_at  timestamptz NOT NULL DEFAULT now(),
            updated_by  uuid REFERENCES public.profiles(id)
        );

        -- Indexes ----------------------------------------------------
        -- Hot path: list a company's month worth of entries.
        CREATE INDEX IF NOT EXISTS idx_ledger_company_date
            ON public.ledger_entries(company_id, txn_date DESC);

        -- For the source-row → ledger-row lookup used by the auto-link
        -- helper (upsert / delete).
        CREATE INDEX IF NOT EXISTS idx_ledger_source
            ON public.ledger_entries(source_kind, source_id);

        -- One ledger row per source row — prevents the upsert helper
        -- from accidentally inserting duplicates if called twice.
        -- Manual rows skip the constraint via the WHERE clause.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_source_unique
            ON public.ledger_entries(source_kind, source_id)
            WHERE source_kind <> 'manual';

        -- Founder dues — "what does the company still owe Prashanti /
        -- Kiran". Partial index keeps it cheap even as the table grows.
        CREATE INDEX IF NOT EXISTS idx_ledger_founder_dues
            ON public.ledger_entries(payer_user_id)
            WHERE reimbursable = true AND reimbursed_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.ledger_entries;")
