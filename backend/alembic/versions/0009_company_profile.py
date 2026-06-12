"""Company profile expansion — registration, addresses, directors, compliance

Adds the legal/admin/compliance metadata HR + founder office capture for
each Kiron Group entity. Up to now `companies` only held display fields
(name, short_name, initials, color, domain, logo_url, code). This migration
grows it into the canonical "company profile" record:

  * Legal / tax IDs (CIN, GST, PAN, TAN, TIN, MSME/Udyam, DPIIT startup)
  * Addresses (registered + multi corporate + multi operations)
  * Phone numbers (multi)
  * Website URLs (multi) + tech stack notes
  * Directors (jsonb list of name + designation + optional DIN)
  * Founder principal designations (Kiran, Prashanti) — separate columns
    because they appear on every entity profile per the user's spec.
  * Managing CA contact + documents the CA holds
  * Misc: nature of business, date of incorporation, is_startup,
    certificates available

All columns are NULLABLE and have no default (except is_startup) so existing
rows aren't touched. The frontend writes empty/missing fields as NULL; the
backend echoes NULL back so the UI shows blank.

Revision ID: 0009_company_profile
Revises: 0008_saturday_pattern
Create Date: 2026-06-12
"""
from alembic import op


revision = "0009_company_profile"
down_revision = "0008_saturday_pattern"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.companies
          ADD COLUMN IF NOT EXISTS website_urls          text[],
          ADD COLUMN IF NOT EXISTS website_technologies  text,
          ADD COLUMN IF NOT EXISTS nature_of_business    text,
          ADD COLUMN IF NOT EXISTS date_of_incorporation date,
          ADD COLUMN IF NOT EXISTS is_startup            boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS cin                   text,
          ADD COLUMN IF NOT EXISTS gst                   text,
          ADD COLUMN IF NOT EXISTS pan                   text,
          ADD COLUMN IF NOT EXISTS tan                   text,
          ADD COLUMN IF NOT EXISTS tin                   text,
          ADD COLUMN IF NOT EXISTS msme_udyam_number     text,
          ADD COLUMN IF NOT EXISTS msme_udyam_mobile     text,
          ADD COLUMN IF NOT EXISTS msme_udyam_email      text,
          ADD COLUMN IF NOT EXISTS dpiit_startup_number  text,
          ADD COLUMN IF NOT EXISTS registered_address    text,
          ADD COLUMN IF NOT EXISTS corporate_addresses   text[],
          ADD COLUMN IF NOT EXISTS operations_addresses  text[],
          ADD COLUMN IF NOT EXISTS phone_numbers         text[],
          ADD COLUMN IF NOT EXISTS directors             jsonb,
          ADD COLUMN IF NOT EXISTS kiran_designation     text,
          ADD COLUMN IF NOT EXISTS prashanti_designation text,
          ADD COLUMN IF NOT EXISTS certificates          text[],
          ADD COLUMN IF NOT EXISTS managing_ca_name      text,
          ADD COLUMN IF NOT EXISTS managing_ca_phone     text,
          ADD COLUMN IF NOT EXISTS managing_ca_email     text,
          ADD COLUMN IF NOT EXISTS ca_documents_held     text[]
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.companies
          DROP COLUMN IF EXISTS website_urls,
          DROP COLUMN IF EXISTS website_technologies,
          DROP COLUMN IF EXISTS nature_of_business,
          DROP COLUMN IF EXISTS date_of_incorporation,
          DROP COLUMN IF EXISTS is_startup,
          DROP COLUMN IF EXISTS cin,
          DROP COLUMN IF EXISTS gst,
          DROP COLUMN IF EXISTS pan,
          DROP COLUMN IF EXISTS tan,
          DROP COLUMN IF EXISTS tin,
          DROP COLUMN IF EXISTS msme_udyam_number,
          DROP COLUMN IF EXISTS msme_udyam_mobile,
          DROP COLUMN IF EXISTS msme_udyam_email,
          DROP COLUMN IF EXISTS dpiit_startup_number,
          DROP COLUMN IF EXISTS registered_address,
          DROP COLUMN IF EXISTS corporate_addresses,
          DROP COLUMN IF EXISTS operations_addresses,
          DROP COLUMN IF EXISTS phone_numbers,
          DROP COLUMN IF EXISTS directors,
          DROP COLUMN IF EXISTS kiran_designation,
          DROP COLUMN IF EXISTS prashanti_designation,
          DROP COLUMN IF EXISTS certificates,
          DROP COLUMN IF EXISTS managing_ca_name,
          DROP COLUMN IF EXISTS managing_ca_phone,
          DROP COLUMN IF EXISTS managing_ca_email,
          DROP COLUMN IF EXISTS ca_documents_held
        """
    )
