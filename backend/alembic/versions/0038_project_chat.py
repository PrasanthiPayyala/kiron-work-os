"""Projects get a group chat, mirroring the pattern from teams.

Adds ``projects.conversation_id`` (FK to conversations, nullable) so a
project's discussion thread can be looked up in one lookup instead of a
scan-by-project_id. Backfills existing projects with a ``project_group``
conversation seeded from their ``project_members``, so the new
Discussion tab shows something on day one.

The FK is nullable + ON DELETE SET NULL — deleting a conversation
(rare, HR-only) shouldn't cascade-nuke the project. Deleting a project
DOES delete its conversation explicitly in the router (safer than a
cascade that might catch a conversation shared elsewhere in the future).

Revision ID: 0038_project_chat
Revises: 0037_attendance_desktop_fields
Create Date: 2026-07-17
"""
from alembic import op


revision = "0038_project_chat"
down_revision = "0037_attendance_desktop_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.projects
            ADD COLUMN IF NOT EXISTS conversation_id uuid
                REFERENCES public.conversations(id) ON DELETE SET NULL;
        """
    )

    # Backfill: every existing project gets a project_group conversation
    # seeded from its project_members. Idempotent — re-running the
    # migration is a no-op because projects that already have a
    # conversation_id are skipped.
    op.execute(
        """
        DO $$
        DECLARE
            p RECORD;
            new_conv_id uuid;
        BEGIN
            FOR p IN
                SELECT id, title, owner_id, created_by
                FROM public.projects
                WHERE conversation_id IS NULL
            LOOP
                new_conv_id := gen_random_uuid();
                INSERT INTO public.conversations
                    (id, channel_type, title, created_by, project_id, visibility)
                VALUES
                    (new_conv_id, 'project_group', p.title,
                     COALESCE(p.owner_id, p.created_by), p.id, 'team');
                UPDATE public.projects
                   SET conversation_id = new_conv_id
                 WHERE id = p.id;
                INSERT INTO public.conversation_members
                    (conversation_id, user_id, member_role, last_read_at)
                SELECT new_conv_id, pm.user_id,
                       CASE WHEN pm.user_id = p.owner_id THEN 'owner' ELSE 'member' END,
                       now()
                FROM public.project_members pm
                WHERE pm.project_id = p.id
                ON CONFLICT DO NOTHING;
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    # Not deleting the backfilled conversations on downgrade — data loss.
    # Just drop the column; the conversations remain reachable via
    # conversations.project_id (which was there before this migration).
    op.execute(
        """
        ALTER TABLE public.projects
            DROP COLUMN IF EXISTS conversation_id;
        """
    )
