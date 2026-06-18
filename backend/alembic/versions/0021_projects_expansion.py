"""Projects expansion — kind, tech stack, team link, milestones.

Phase 3 of the approved roadmap. The thin Projects model we started
with (title + dates + progress %) is fine for internal task tracking
but doesn't carry the metadata the team actually wants: which
technologies the project uses, which Team owns it, whether it's a
client engagement / hackathon / R&D thing, and milestone phases inside
the project's lifetime.

Additive changes:
- ``projects.kind``        text   — 'internal' | 'client' | 'rnd' |
                                   'hackathon' | 'other'.
- ``projects.tech_stack``  text[] — multi-tag, e.g. {React, FastAPI,
                                   Postgres, Razorpay}. Stored as a
                                   plain Postgres text[] (cheap +
                                   query-friendly).
- ``projects.team_id``     uuid   — optional FK to teams.id. Lets
                                   founders' office track which team
                                   is delivering which project.
- ``projects.progress_mode`` text — 'auto' (computed from tasks done
                                   / total) | 'manual' (use the
                                   existing ``progress`` column).
                                   Defaults to 'manual' so the column
                                   we already have continues to work
                                   for every existing project.

New table:
- ``project_milestones`` (id, project_id, title, description, due_date,
   status [planned|in_progress|done|skipped], position int for order,
   created_at, created_by). Each project may have N milestones; the
   UI renders them as a timeline.

Revision ID: 0021_projects_expansion
Revises: 0020_credentials_vault
Create Date: 2026-06-17
"""
from alembic import op


revision = "0021_projects_expansion"
down_revision = "0020_credentials_vault"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.projects
          ADD COLUMN IF NOT EXISTS kind          text NOT NULL DEFAULT 'internal',
          ADD COLUMN IF NOT EXISTS tech_stack    text[],
          ADD COLUMN IF NOT EXISTS team_id       uuid REFERENCES public.teams(id),
          ADD COLUMN IF NOT EXISTS progress_mode text NOT NULL DEFAULT 'manual';

        CREATE INDEX IF NOT EXISTS idx_projects_kind ON public.projects(kind);
        CREATE INDEX IF NOT EXISTS idx_projects_team ON public.projects(team_id);

        CREATE TABLE IF NOT EXISTS public.project_milestones (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            title       text NOT NULL,
            description text,
            due_date    date,
            status      text NOT NULL DEFAULT 'planned',
            -- Manual ordering so the UI can show them in the order the
            -- creator intended, independent of due dates.
            position    int  NOT NULL DEFAULT 0,
            created_at  timestamptz NOT NULL DEFAULT now(),
            created_by  uuid REFERENCES public.profiles(id),
            completed_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS idx_project_milestones_project
          ON public.project_milestones(project_id, position);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.project_milestones;
        ALTER TABLE public.projects
          DROP COLUMN IF EXISTS progress_mode,
          DROP COLUMN IF EXISTS team_id,
          DROP COLUMN IF EXISTS tech_stack,
          DROP COLUMN IF EXISTS kind;
        """
    )
