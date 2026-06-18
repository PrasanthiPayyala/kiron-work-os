"""Vendor management — vendor records, contracts, payments, renewal reminders.

Phase 7 of approved roadmap. Solves "when does the domain registrar
renew? what are we paying Razorpay every month? did the cPanel
licence get renewed last quarter?" — questions today's app can't
answer.

Three tables:
- ``vendors``           — one row per organisation we pay. Optional
                         link to ``organizations`` from the contacts
                         module so a vendor can also be a Contact org
                         if they're already in there.
- ``vendor_contracts``  — recurring + one-time engagements. Carries
                         the next renewal date, the billing cadence,
                         and a per-contract reminder lead time (default
                         30 days before end_date).
- ``vendor_payments``   — actual payments recorded against either a
                         contract or the vendor as a whole.

A daily scheduler job (added in app/scheduler.py) reads
``vendor_contracts`` and fires renewal reminders + notifications when
end_date - reminder_days_before <= today, deduped by contract.

Authz lives in the router. Manage roles: super_admin, founder,
founder's office (coordinator + support), hr_admin. Same set as
Assets / attendance follow-up to keep the ops surface consistent.

Revision ID: 0025_vendors
Revises: 0024_assets
Create Date: 2026-06-17
"""
from alembic import op


revision = "0025_vendors"
down_revision = "0024_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.vendors (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name            text NOT NULL,
            category        text NOT NULL DEFAULT 'other',
            website         text,
            gstin           text,
            address         text,
            primary_contact text,
            primary_email   text,
            primary_phone   text,
            notes           text,
            -- Optional link to the existing Contacts/Organizations
            -- record. Vendors and contact-organizations are sometimes
            -- the same entity (Razorpay is both a SaaS vendor + a
            -- listed organization) — this lets them point at each
            -- other without duplication.
            organization_id uuid REFERENCES public.organizations(id),
            owner_id        uuid REFERENCES public.profiles(id),
            company_id      uuid REFERENCES public.companies(id),
            is_active       boolean NOT NULL DEFAULT true,
            created_at      timestamptz NOT NULL DEFAULT now(),
            created_by      uuid REFERENCES public.profiles(id),
            updated_at      timestamptz NOT NULL DEFAULT now(),
            updated_by      uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_vendors_category ON public.vendors(category);
        CREATE INDEX IF NOT EXISTS idx_vendors_company  ON public.vendors(company_id);
        CREATE INDEX IF NOT EXISTS idx_vendors_active   ON public.vendors(is_active);

        CREATE TABLE IF NOT EXISTS public.vendor_contracts (
            id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            vendor_id             uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
            title                 text NOT NULL,
            -- subscription | retainer | one_time | license | other
            contract_type         text NOT NULL DEFAULT 'subscription',
            amount                numeric(14,2),
            currency              text NOT NULL DEFAULT 'INR',
            -- monthly | quarterly | half_yearly | yearly | one_time
            billing_cadence       text NOT NULL DEFAULT 'monthly',
            start_date            date,
            end_date              date,
            auto_renews           boolean NOT NULL DEFAULT false,
            -- Days before end_date when the reminder + notification
            -- should fire. NULL means "use default 30".
            reminder_days_before  int NOT NULL DEFAULT 30,
            status                text NOT NULL DEFAULT 'active',
            notes                 text,
            created_at            timestamptz NOT NULL DEFAULT now(),
            created_by            uuid REFERENCES public.profiles(id),
            updated_at            timestamptz NOT NULL DEFAULT now(),
            updated_by            uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_vendor_contracts_vendor ON public.vendor_contracts(vendor_id);
        CREATE INDEX IF NOT EXISTS idx_vendor_contracts_due
          ON public.vendor_contracts(end_date) WHERE status = 'active';

        CREATE TABLE IF NOT EXISTS public.vendor_payments (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            vendor_id   uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
            contract_id uuid REFERENCES public.vendor_contracts(id) ON DELETE SET NULL,
            amount      numeric(14,2) NOT NULL,
            currency    text NOT NULL DEFAULT 'INR',
            paid_at     date NOT NULL,
            mode        text,
            reference   text,
            notes       text,
            paid_by     uuid REFERENCES public.profiles(id),
            created_at  timestamptz NOT NULL DEFAULT now(),
            created_by  uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor   ON public.vendor_payments(vendor_id, paid_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vendor_payments_contract ON public.vendor_payments(contract_id);

        -- Dedup table for the renewal reminder scheduler. Each
        -- (contract, end_date) gets at most one reminder firing per
        -- end_date. When the end_date moves (contract renewed manually,
        -- end_date pushed forward) the row stops matching, and a new
        -- reminder will fire for the new end_date.
        CREATE TABLE IF NOT EXISTS public.vendor_contract_reminders (
            contract_id  uuid NOT NULL REFERENCES public.vendor_contracts(id) ON DELETE CASCADE,
            for_end_date date NOT NULL,
            sent_at      timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (contract_id, for_end_date)
        );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.vendor_contract_reminders;
        DROP TABLE IF EXISTS public.vendor_payments;
        DROP TABLE IF EXISTS public.vendor_contracts;
        DROP TABLE IF EXISTS public.vendors;
        """
    )
