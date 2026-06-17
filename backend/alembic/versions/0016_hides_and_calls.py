"""Per-viewer hides + scheduled task calls.

Adds five tables:

- ``message_hides``      — (message_id, user_id) rows: messages the user
                           has hidden from their own view. Other employees
                           still see them; founder + super_admin always
                           see them (with a small marker in the UI).
- ``conversation_hides`` — (conversation_id, user_id) rows: conversations
                           the user has hidden. Auto-removed when a new
                           message arrives so the chat reappears
                           (WhatsApp-style).
- ``task_calls``         — scheduled calls anchored to a task. One task
                           may have many.
- ``task_call_participants`` — N attendees per call (default = assignee +
                           reviewer + reporting manager).
- ``task_call_reminders`` — log of (call_id, kind) reminders already sent.
                           Kinds: ``morning_of`` (9 am IST same-day),
                           ``t_minus_20``, ``t_zero``.

Plus a trigger on ``messages`` INSERT that clears any
``conversation_hides`` for that conversation so the chat reappears for
everyone who hid it. We don't restrict by sender — a new inbound message
should resurrect the thread in the recipient's list.

Revision ID: 0016_hides_and_calls
Revises: 0015_field_work_status
Create Date: 2026-06-17
"""
from alembic import op


revision = "0016_hides_and_calls"
down_revision = "0015_field_work_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.message_hides (
            message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
            user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            hidden_at  timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (message_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_message_hides_user
            ON public.message_hides(user_id);

        CREATE TABLE IF NOT EXISTS public.conversation_hides (
            conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
            user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            hidden_at       timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (conversation_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_conversation_hides_user
            ON public.conversation_hides(user_id);

        CREATE TABLE IF NOT EXISTS public.task_calls (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
            scheduled_at    timestamptz NOT NULL,
            duration_mins   int NOT NULL DEFAULT 30,
            meeting_link    text,
            notes           text,
            status          text NOT NULL DEFAULT 'scheduled',
            created_by      uuid REFERENCES public.profiles(id),
            created_at      timestamptz NOT NULL DEFAULT now(),
            cancelled_at    timestamptz,
            cancelled_by    uuid REFERENCES public.profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_calls_task
            ON public.task_calls(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_calls_scheduled
            ON public.task_calls(scheduled_at)
            WHERE status = 'scheduled';

        CREATE TABLE IF NOT EXISTS public.task_call_participants (
            call_id uuid NOT NULL REFERENCES public.task_calls(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
            PRIMARY KEY (call_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS public.task_call_reminders (
            call_id uuid NOT NULL REFERENCES public.task_calls(id) ON DELETE CASCADE,
            kind    text NOT NULL,
            sent_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (call_id, kind)
        );
        """
    )

    # Auto-unhide a conversation for everyone when a new message lands.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.unhide_conversation_on_new_message()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            DELETE FROM public.conversation_hides
            WHERE conversation_id = NEW.conversation_id;
            RETURN NEW;
        END;
        $$;

        DROP TRIGGER IF EXISTS messages_unhide_conversation ON public.messages;
        CREATE TRIGGER messages_unhide_conversation
            AFTER INSERT ON public.messages
            FOR EACH ROW
            EXECUTE FUNCTION public.unhide_conversation_on_new_message();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER IF EXISTS messages_unhide_conversation ON public.messages;
        DROP FUNCTION  IF EXISTS public.unhide_conversation_on_new_message();
        DROP TABLE     IF EXISTS public.task_call_reminders;
        DROP TABLE     IF EXISTS public.task_call_participants;
        DROP TABLE     IF EXISTS public.task_calls;
        DROP TABLE     IF EXISTS public.conversation_hides;
        DROP TABLE     IF EXISTS public.message_hides;
        """
    )
