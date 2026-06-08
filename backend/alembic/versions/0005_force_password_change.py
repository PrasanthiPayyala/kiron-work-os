"""profiles.must_change_password — force a new password on first login

When HR creates a new account they set a temporary password, and the joiner
should be forced to pick a real one the first time they sign in. The same
flag is set when an admin resets someone's password on their behalf (so the
admin's chosen value can't be reused as a long-term password).

Revision ID: 0005_force_password_change
Revises: 0004_employment_lifecycle
Create Date: 2026-06-08
"""
from alembic import op


revision = "0005_force_password_change"
down_revision = "0004_employment_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.profiles "
        "ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.profiles DROP COLUMN IF EXISTS must_change_password")
