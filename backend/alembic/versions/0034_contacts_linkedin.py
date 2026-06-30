"""LinkedIn URLs on contacts + organizations.

Adds:

  * ``contacts.linkedin_url``       — the person's individual LinkedIn
                                      profile URL.
  * ``organizations.linkedin_url``  — the firm's LinkedIn company page.
                                      Mirrors the existing ``website`` /
                                      ``address`` shape so multiple
                                      contacts at the same firm share
                                      one source of truth.

Both nullable, no backfill. Existing rows are untouched.

Revision ID: 0034_contacts_linkedin
Revises: 0033_offices_geo_idle
Create Date: 2026-06-30
"""
from alembic import op


revision = "0034_contacts_linkedin"
down_revision = "0033_offices_geo_idle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.contacts
            ADD COLUMN IF NOT EXISTS linkedin_url text;
        """
    )
    op.execute(
        """
        ALTER TABLE public.organizations
            ADD COLUMN IF NOT EXISTS linkedin_url text;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.contacts       DROP COLUMN IF EXISTS linkedin_url;")
    op.execute("ALTER TABLE public.organizations  DROP COLUMN IF EXISTS linkedin_url;")
