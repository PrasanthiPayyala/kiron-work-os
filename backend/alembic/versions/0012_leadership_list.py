"""Add leadership jsonb column to companies.

Parallel to `directors`, but for operational leadership (CEO/COO/CTO/heads
of department/advisory chairs) who aren't formally registered directors
with MCA. List of {name, designation}. Nullable.

Revision ID: 0012_leadership_list
Revises: 0011_drop_managing_ca
Create Date: 2026-06-16
"""
from alembic import op


revision = "0012_leadership_list"
down_revision = "0011_drop_managing_ca"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.companies "
        "  ADD COLUMN IF NOT EXISTS leadership jsonb"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.companies "
        "  DROP COLUMN IF EXISTS leadership"
    )
