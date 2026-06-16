"""Backfill managing_ca_* into contacts, then drop the columns.

For every company with a non-null `managing_ca_name`, insert a `contacts`
row (category='ca') and link it to the company via `contact_companies`.
Then drop the three columns from `companies`. `ca_documents_held` stays —
it's a list of certificates the company holds, not specific to one CA.

Idempotent: skipped if the columns are already gone, and the contact
backfill uses a sentinel to avoid duplicating rows on a re-run.

Revision ID: 0011_drop_managing_ca
Revises: 0010_contacts_directory
Create Date: 2026-06-16
"""
from alembic import op
from sqlalchemy import text


revision = "0011_drop_managing_ca"
down_revision = "0010_contacts_directory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Skip the backfill entirely if the columns are gone (re-run safety).
    has_cols = bind.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='companies' "
        "  AND column_name='managing_ca_name'"
    )).first()

    if has_cols:
        # Use a sentinel in notes to skip rows already migrated.
        # Inline SQL: one INSERT per matching company + one link.
        rows = bind.execute(text(
            "SELECT id, name, managing_ca_name, managing_ca_phone, managing_ca_email "
            "FROM companies WHERE managing_ca_name IS NOT NULL AND length(trim(managing_ca_name)) > 0"
        )).mappings().all()

        for r in rows:
            already = bind.execute(text(
                "SELECT c.id FROM contacts c "
                "JOIN contact_companies cc ON cc.contact_id = c.id "
                "WHERE c.category = 'ca' "
                "  AND lower(c.full_name) = lower(:name) "
                "  AND cc.company_id = :cid "
                "LIMIT 1"
            ), {"name": r["managing_ca_name"], "cid": r["id"]}).first()
            if already:
                continue

            contact_id = bind.execute(text(
                "INSERT INTO contacts (full_name, category, phone, email, notes) "
                "VALUES (:n, 'ca', :p, :e, :note) "
                "RETURNING id"
            ), {
                "n": r["managing_ca_name"],
                "p": r["managing_ca_phone"],
                "e": r["managing_ca_email"],
                "note": "Migrated from companies.managing_ca_* (0011)",
            }).scalar()

            bind.execute(text(
                "INSERT INTO contact_companies (contact_id, company_id, relationship) "
                "VALUES (:cn, :co, 'ca') "
                "ON CONFLICT DO NOTHING"
            ), {"cn": str(contact_id), "co": r["id"]})

    op.execute(
        "ALTER TABLE public.companies "
        "  DROP COLUMN IF EXISTS managing_ca_name, "
        "  DROP COLUMN IF EXISTS managing_ca_phone, "
        "  DROP COLUMN IF EXISTS managing_ca_email"
    )


def downgrade() -> None:
    # Re-add the columns; data is NOT restored from contacts (would require
    # picking which linked CA is "the managing one" — ambiguous by design).
    op.execute(
        "ALTER TABLE public.companies "
        "  ADD COLUMN IF NOT EXISTS managing_ca_name  text, "
        "  ADD COLUMN IF NOT EXISTS managing_ca_phone text, "
        "  ADD COLUMN IF NOT EXISTS managing_ca_email text"
    )
