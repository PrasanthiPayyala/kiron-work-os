"""Credentials vault — encrypted-at-rest shared secret store.

Solves the team's manual "share the cPanel password over WhatsApp"
flow. Each credential has:

- label + category + identifier + url + notes (all plaintext metadata
  visible to anyone with access),
- the actual secret stored as AES-256-GCM ciphertext + nonce; the
  symmetric key lives only in /etc/kiron/backend.env (VAULT_MASTER_KEY)
  so a DB dump leak doesn't expose secrets.

ACL model (per the user's "super_admin only by default" choice):
- super_admin always has access — no row needed in credential_access.
- Everyone else needs an explicit row in ``credential_access`` granting
  them view. Grants can target a specific user OR a whole role.
- Founders (Prashanti) are NOT implicitly granted — Kiran ticks per
  credential. Same for founder's office + HR.

Audit:
- ``credential_audit`` logs every view, copy-to-clipboard, edit, create,
  delete, grant, revoke. The full audit log is only readable by
  super_admin. The dashboard surfaces "last viewed by" for each
  credential so trust patterns are visible.

Revision ID: 0020_credentials_vault
Revises: 0019_teams
Create Date: 2026-06-17
"""
from alembic import op


revision = "0020_credentials_vault"
down_revision = "0019_teams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.credentials (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            label           text NOT NULL,
            category        text NOT NULL DEFAULT 'misc',
            identifier      text,
            url             text,
            notes           text,
            -- AES-256-GCM ciphertext + nonce. Plaintext never lives in
            -- the DB. ``ciphertext`` includes the 16-byte auth tag.
            ciphertext      bytea NOT NULL,
            nonce           bytea NOT NULL,
            -- Optional reminder cadence (days). NULL = never rotate.
            rotate_every_days int,
            last_rotated_at timestamptz,
            is_active       boolean NOT NULL DEFAULT true,
            created_at      timestamptz NOT NULL DEFAULT now(),
            created_by      uuid REFERENCES public.profiles(id),
            updated_at      timestamptz NOT NULL DEFAULT now(),
            updated_by      uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_credentials_category ON public.credentials(category);
        CREATE INDEX IF NOT EXISTS idx_credentials_active   ON public.credentials(is_active);

        CREATE TABLE IF NOT EXISTS public.credential_access (
            credential_id  uuid NOT NULL REFERENCES public.credentials(id) ON DELETE CASCADE,
            -- One of: 'user' (principal_id = profiles.id),
            --         'role' (principal_id = role name as text-in-uuid? no —
            --                use a separate text column instead).
            principal_kind text NOT NULL,   -- 'user' | 'role'
            principal_id   text NOT NULL,    -- uuid string for user, role name for role
            granted_at     timestamptz NOT NULL DEFAULT now(),
            granted_by     uuid REFERENCES public.profiles(id),
            PRIMARY KEY (credential_id, principal_kind, principal_id)
        );
        CREATE INDEX IF NOT EXISTS idx_credential_access_principal
            ON public.credential_access(principal_kind, principal_id);

        CREATE TABLE IF NOT EXISTS public.credential_audit (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            credential_id uuid REFERENCES public.credentials(id) ON DELETE CASCADE,
            actor_user_id uuid REFERENCES public.profiles(id),
            -- view | copy | create | edit | delete | grant | revoke
            action        text NOT NULL,
            -- Optional context: which principal was granted/revoked.
            meta          jsonb,
            at            timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_credential_audit_cred ON public.credential_audit(credential_id);
        CREATE INDEX IF NOT EXISTS idx_credential_audit_actor ON public.credential_audit(actor_user_id);
        CREATE INDEX IF NOT EXISTS idx_credential_audit_at    ON public.credential_audit(at DESC);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.credential_audit;
        DROP TABLE IF EXISTS public.credential_access;
        DROP TABLE IF EXISTS public.credentials;
        """
    )
