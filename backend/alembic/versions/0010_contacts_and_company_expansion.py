"""Contacts module + company profile expansion (schema only)

Adds the schema scaffolding for the Contacts module and the next batch of
company profile fields. NO data migration here — old `companies.gst` and
`managing_ca_*` columns stay in place; a follow-up migration backfills them
into the new tables and drops them.

What this adds:

  * `organizations`       — vendors, clients, CA firms, banks, colleges,
                            govt offices. The "company" half of a contact.
  * `contacts`            — the actual humans. Optional FK to organization.
                            Category enforces the access taxonomy.
  * `contact_companies`   — many-to-many: which of our group entities does
                            this contact serve, with an optional override
                            relationship string.
  * `contact_activity`    — per-mutation audit log mirroring task_activity.
  * `company_activity`    — same shape, scoped to company profile edits.
  * `company_bank_accounts` — one row per bank account a group entity holds.

Additions to `companies`:

  * `gst_registrations`        jsonb — list of {state, gstin}; replaces the
                                       single `gst` text column once Step 5
                                       backfills. We KEEP `gst` for now.
  * `esi_number`, `epf_number`, `professional_tax_number` — employer regs
  * `shops_establishment_number`, `shops_establishment_expires_at`
  * `iec_number`               — Import-Export Code
  * `industry_licenses`        jsonb — [{type, number, issued, expires}]
                                       (FSSAI / IATA / SEBI / ITDC / etc.)
  * `trademark_registrations`  jsonb — [{name, class, number, registered_on,
                                        renewal_due}]

All new columns are nullable; existing rows aren't touched.

Revision ID: 0010_contacts_directory
Revises: 0009_company_profile
Create Date: 2026-06-15

Note: revision ID was originally `0010_contacts_and_company_expansion` (35
chars) but alembic's default `alembic_version.version_num` is `varchar(32)`,
so the bookkeeping UPDATE failed even though the DDL applied successfully.
Shortened to fit. Migration body is idempotent (IF NOT EXISTS on everything)
so re-running it after the rename is safe.
"""
from alembic import op


revision = "0010_contacts_directory"
down_revision = "0009_company_profile"
branch_labels = None
depends_on = None


# Kept here so the upgrade and the (future) ALTER for adding categories
# share one source of truth. Mirrors backend/app/authz.py CONTACT_CATEGORY_*.
CONTACT_CATEGORIES = (
    "ca", "cs", "auditor", "lawyer", "banker", "insurance", "investor",
    "govt_official",
    "client_poc", "vendor_poc", "channel_partner", "collaborator",
    "advisor", "mentor", "press", "industry_body",
    "college", "tpo", "training_institute", "recruitment_agency",
    "domain_registrar", "hosting_saas", "agency",
    "other",
)


def upgrade() -> None:
    cats_sql = ", ".join(f"'{c}'" for c in CONTACT_CATEGORIES)

    # ------------------------------ Companies extras
    op.execute(
        """
        ALTER TABLE public.companies
          ADD COLUMN IF NOT EXISTS gst_registrations         jsonb,
          ADD COLUMN IF NOT EXISTS esi_number                text,
          ADD COLUMN IF NOT EXISTS epf_number                text,
          ADD COLUMN IF NOT EXISTS professional_tax_number   text,
          ADD COLUMN IF NOT EXISTS shops_establishment_number      text,
          ADD COLUMN IF NOT EXISTS shops_establishment_expires_at  date,
          ADD COLUMN IF NOT EXISTS iec_number                text,
          ADD COLUMN IF NOT EXISTS industry_licenses         jsonb,
          ADD COLUMN IF NOT EXISTS trademark_registrations   jsonb
        """
    )

    # ------------------------------ organizations
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.organizations (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name          text NOT NULL,
            type          text,
            website       text,
            address       text,
            gstin         text,
            notes         text,
            is_active     boolean NOT NULL DEFAULT true,
            created_at    timestamptz NOT NULL DEFAULT now(),
            created_by    uuid REFERENCES public.profiles(id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_organizations_name "
        "ON public.organizations(lower(name))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_organizations_type "
        "ON public.organizations(type) WHERE type IS NOT NULL"
    )

    # ------------------------------ contacts
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS public.contacts (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            full_name       text NOT NULL,
            role            text,
            email           text,
            phone           text,
            organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
            category        text NOT NULL,
            notes           text,
            is_active       boolean NOT NULL DEFAULT true,
            business_card_attachment_id uuid REFERENCES public.attachments(id) ON DELETE SET NULL,
            created_at      timestamptz NOT NULL DEFAULT now(),
            created_by      uuid REFERENCES public.profiles(id),
            CONSTRAINT chk_contacts_category CHECK (category IN ({cats_sql}))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_contacts_category ON public.contacts(category)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_contacts_organization "
        "ON public.contacts(organization_id) WHERE organization_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_contacts_email "
        "ON public.contacts(lower(email)) WHERE email IS NOT NULL"
    )

    # ------------------------------ contact_companies (m:n)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.contact_companies (
            contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
            company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
            relationship text,
            created_at   timestamptz NOT NULL DEFAULT now(),
            created_by   uuid REFERENCES public.profiles(id),
            PRIMARY KEY (contact_id, company_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_contact_companies_company "
        "ON public.contact_companies(company_id)"
    )

    # ------------------------------ contact_activity (audit)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.contact_activity (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id    uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
            actor_user_id uuid REFERENCES public.profiles(id),
            action        text NOT NULL,
            field_name    text,
            old_value     jsonb,
            new_value     jsonb,
            note          text,
            created_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_contact_activity_contact "
        "ON public.contact_activity(contact_id, created_at DESC)"
    )

    # ------------------------------ company_activity (audit)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.company_activity (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
            actor_user_id uuid REFERENCES public.profiles(id),
            action        text NOT NULL,
            field_name    text,
            old_value     jsonb,
            new_value     jsonb,
            note          text,
            created_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_company_activity_company "
        "ON public.company_activity(company_id, created_at DESC)"
    )

    # ------------------------------ company_bank_accounts
    # RM/banker as a person is a row in contacts (category='banker') linked
    # back here via rm_contact_id when one is known. The bank itself can also
    # be an organization (organization_id), but neither FK is required —
    # founder office can record an account before adding the human RM.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
            bank_name       text NOT NULL,
            account_number  text NOT NULL,
            ifsc            text,
            branch          text,
            account_type    text,
            organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
            rm_contact_id   uuid REFERENCES public.contacts(id)      ON DELETE SET NULL,
            is_primary      boolean NOT NULL DEFAULT false,
            notes           text,
            created_at      timestamptz NOT NULL DEFAULT now(),
            created_by      uuid REFERENCES public.profiles(id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_company_bank_accounts_company "
        "ON public.company_bank_accounts(company_id)"
    )


def downgrade() -> None:
    # Order matters: drop children before parents.
    op.execute("DROP TABLE IF EXISTS public.company_bank_accounts")
    op.execute("DROP TABLE IF EXISTS public.company_activity")
    op.execute("DROP TABLE IF EXISTS public.contact_activity")
    op.execute("DROP TABLE IF EXISTS public.contact_companies")
    op.execute("DROP TABLE IF EXISTS public.contacts")
    op.execute("DROP TABLE IF EXISTS public.organizations")
    op.execute(
        """
        ALTER TABLE public.companies
          DROP COLUMN IF EXISTS gst_registrations,
          DROP COLUMN IF EXISTS esi_number,
          DROP COLUMN IF EXISTS epf_number,
          DROP COLUMN IF EXISTS professional_tax_number,
          DROP COLUMN IF EXISTS shops_establishment_number,
          DROP COLUMN IF EXISTS shops_establishment_expires_at,
          DROP COLUMN IF EXISTS iec_number,
          DROP COLUMN IF EXISTS industry_licenses,
          DROP COLUMN IF EXISTS trademark_registrations
        """
    )
