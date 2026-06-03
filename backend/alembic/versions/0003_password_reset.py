"""password_reset_tokens

Revision ID: 0003_password_reset
Revises: 0002_chat_realtime
Create Date: 2026-06-03
"""
from alembic import op


revision = "0003_password_reset"
down_revision = "0002_chat_realtime"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # token_hash = sha256 of the random token sent in the email; we never
    # store the raw token so a DB read leaks nothing useful.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          token_hash  text NOT NULL UNIQUE,
          expires_at  timestamptz NOT NULL,
          used_at     timestamptz,
          created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_prt_user ON public.password_reset_tokens(user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.password_reset_tokens CASCADE")
