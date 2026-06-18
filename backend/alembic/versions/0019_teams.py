"""Teams — flexible groupings (project / hackathon / hr / founder's
office / client-internal / client-external / functional / ad-hoc).

A team is a named set of people that work together for a purpose. The
existing surface is too rigid: tasks belong to a company, conversations
are either DMs or company groups, projects sit one-per-project. None of
those compose well for a hackathon team that spans two group entities,
or a client-facing team that includes outside contacts via Contacts /
Organizations.

Schema:

- ``teams``
    id, name, slug (lowercase-dashed, unique), kind, description,
    owner_id (creator by default), company_id (nullable — for
    group-wide teams), client_org_id (nullable — for client teams,
    references organizations.id), is_active, created_at, created_by.
- ``team_members``
    (team_id, user_id, member_role text default 'member',
     joined_at, added_by uuid?)
    member_role in {'owner','admin','member'} — used to gate edits.

Each team auto-spawns a ``conversations`` row of channel_type =
'team_group' on create so members can talk without a separate step;
that wiring lives in the router, not the schema.

Authz model (enforced in routers/teams.py):
- Anyone can create a team. Creator becomes owner.
- Anyone in the team can read it + send chat to its channel.
- Only owner / admin / super_admin / founder can edit or add members.
- Super_admin / founder can see + manage every team.

Revision ID: 0019_teams
Revises: 0018_reminder_notification_type
Create Date: 2026-06-17
"""
from alembic import op


revision = "0019_teams"
down_revision = "0018_reminder_notification_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.teams (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name            text NOT NULL,
            slug            text NOT NULL UNIQUE,
            kind            text NOT NULL DEFAULT 'project',
            description     text,
            owner_id        uuid REFERENCES public.profiles(id),
            company_id      uuid REFERENCES public.companies(id),
            client_org_id   uuid REFERENCES public.organizations(id),
            conversation_id uuid REFERENCES public.conversations(id),
            is_active       boolean NOT NULL DEFAULT true,
            created_at      timestamptz NOT NULL DEFAULT now(),
            created_by      uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_teams_company ON public.teams(company_id);
        CREATE INDEX IF NOT EXISTS idx_teams_kind    ON public.teams(kind);
        CREATE INDEX IF NOT EXISTS idx_teams_active  ON public.teams(is_active);

        CREATE TABLE IF NOT EXISTS public.team_members (
            team_id     uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
            user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            member_role text NOT NULL DEFAULT 'member',
            joined_at   timestamptz NOT NULL DEFAULT now(),
            added_by    uuid REFERENCES public.profiles(id),
            PRIMARY KEY (team_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members(user_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS public.team_members;
        DROP TABLE IF EXISTS public.teams;
        """
    )
