"""Asset management — laptops, monitors, phones, ID cards issued to staff.

Phase 6 of approved roadmap. Solves "who has what" — today there's no
central place to track which laptop is with Karunya, which monitor is
on Vinay's desk, when an ID card was issued.

Two tables:

- ``assets``           — one row per physical thing. Carries the
                         current state (current_holder_id, status,
                         condition) so common queries hit a single
                         row.
- ``asset_assignments``— history. Every issue / return is logged as
                         a row with start + end timestamps. Active
                         assignments have returned_at NULL.

The current row in ``assets`` is denormalised cache of the latest
assignment for fast list rendering; ``asset_assignments`` is the
audit trail.

Authz lives in the router. HR + super_admin + founder +
founder_office_coordinator + founder_office_support can manage. Other
roles can see only their own assigned assets (via a future /people/:id
widget; the list page is HR-only in V1).

Revision ID: 0024_assets
Revises: 0023_documents
Create Date: 2026-06-17
"""
from alembic import op


revision = "0024_assets"
down_revision = "0023_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.assets (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Human-readable label e.g. KIRON-LAPTOP-001. Optional —
            -- caller can supply or leave blank.
            asset_tag         text,
            category          text NOT NULL DEFAULT 'laptop',
            brand             text,
            model             text,
            serial_number     text,
            company_id        uuid REFERENCES public.companies(id),
            purchase_date     date,
            purchase_cost     numeric(12,2),
            supplier          text,
            current_holder_id uuid REFERENCES public.profiles(id),
            status            text NOT NULL DEFAULT 'in_stock',
            condition         text NOT NULL DEFAULT 'good',
            notes             text,
            is_active         boolean NOT NULL DEFAULT true,
            created_at        timestamptz NOT NULL DEFAULT now(),
            created_by        uuid REFERENCES public.profiles(id),
            updated_at        timestamptz NOT NULL DEFAULT now(),
            updated_by        uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_assets_category ON public.assets(category);
        CREATE INDEX IF NOT EXISTS idx_assets_status   ON public.assets(status);
        CREATE INDEX IF NOT EXISTS idx_assets_holder   ON public.assets(current_holder_id);
        CREATE INDEX IF NOT EXISTS idx_assets_company  ON public.assets(company_id);

        CREATE TABLE IF NOT EXISTS public.asset_assignments (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            asset_id            uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
            user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            issued_at           timestamptz NOT NULL DEFAULT now(),
            issued_by           uuid REFERENCES public.profiles(id),
            issue_note          text,
            condition_at_issue  text,
            returned_at         timestamptz,
            returned_by         uuid REFERENCES public.profiles(id),
            return_note         text,
            condition_at_return text
        );
        CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset ON public.asset_assignments(asset_id, issued_at DESC);
        CREATE INDEX IF NOT EXISTS idx_asset_assignments_user  ON public.asset_assignments(user_id, issued_at DESC);
        -- Only one active (un-returned) assignment per asset at a time.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_assignments_active
          ON public.asset_assignments(asset_id) WHERE returned_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.asset_assignments;
        DROP TABLE IF EXISTS public.assets;
        """
    )
