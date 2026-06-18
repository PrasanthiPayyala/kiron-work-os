"""Documents / Knowledge base — SOPs, policies, contracts, handbooks.

Phase 5 of approved roadmap. Centralises the "where's the latest
handbook?" pain. Each document has:

- title + category (free text — common values surfaced in the UI)
- body (plain text for V1; markdown rendering deferred)
- owner_id, optional company_id (NULL = group-wide)
- visibility:
    'company'    — anyone in the same home_company sees it (default)
    'group_wide' — everyone in any entity sees it
    'private'    — only owner + explicit document_access rows
- tags (Postgres text[])
- created/updated by/at

Versions: every PATCH writes a snapshot to ``document_versions`` so
the audit story is clean. The current row in ``documents`` is the
HEAD; versions hold the diffable history.

ACL: ``document_access`` rows can target a specific user OR a role.
Layered on top of the visibility default — a private doc can still
be opened to a teammate or to all hr_admins.

Revision ID: 0023_documents
Revises: 0022_leave_balances
Create Date: 2026-06-17
"""
from alembic import op


revision = "0023_documents"
down_revision = "0022_leave_balances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.documents (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            title       text NOT NULL,
            slug        text NOT NULL UNIQUE,
            category    text NOT NULL DEFAULT 'other',
            body        text NOT NULL DEFAULT '',
            owner_id    uuid REFERENCES public.profiles(id),
            company_id  uuid REFERENCES public.companies(id),
            visibility  text NOT NULL DEFAULT 'company',
            tags        text[],
            is_active   boolean NOT NULL DEFAULT true,
            version     int NOT NULL DEFAULT 1,
            created_at  timestamptz NOT NULL DEFAULT now(),
            created_by  uuid REFERENCES public.profiles(id),
            updated_at  timestamptz NOT NULL DEFAULT now(),
            updated_by  uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_documents_category    ON public.documents(category);
        CREATE INDEX IF NOT EXISTS idx_documents_company     ON public.documents(company_id);
        CREATE INDEX IF NOT EXISTS idx_documents_visibility  ON public.documents(visibility);
        CREATE INDEX IF NOT EXISTS idx_documents_active      ON public.documents(is_active);

        CREATE TABLE IF NOT EXISTS public.document_versions (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
            version     int  NOT NULL,
            title       text NOT NULL,
            body        text NOT NULL,
            change_note text,
            edited_at   timestamptz NOT NULL DEFAULT now(),
            edited_by   uuid REFERENCES public.profiles(id),
            UNIQUE (document_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON public.document_versions(document_id, version DESC);

        CREATE TABLE IF NOT EXISTS public.document_access (
            document_id    uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
            principal_kind text NOT NULL,   -- 'user' | 'role'
            principal_id   text NOT NULL,
            access_level   text NOT NULL DEFAULT 'view',  -- 'view' | 'edit'
            granted_at     timestamptz NOT NULL DEFAULT now(),
            granted_by     uuid REFERENCES public.profiles(id),
            PRIMARY KEY (document_id, principal_kind, principal_id)
        );
        CREATE INDEX IF NOT EXISTS idx_document_access_principal
            ON public.document_access(principal_kind, principal_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.document_access;
        DROP TABLE IF EXISTS public.document_versions;
        DROP TABLE IF EXISTS public.documents;
        """
    )
