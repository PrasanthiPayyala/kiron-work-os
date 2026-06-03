"""baseline schema (ported from supabase/migrations)

Revision ID: 0001_baseline
Revises:
Create Date: 2026-05-28
"""
from pathlib import Path

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA_SQL = Path(__file__).resolve().parents[2] / "sql" / "schema.sql"
TABLES = [
    "notifications", "attachments", "messages", "conversation_members", "conversations",
    "leave_requests", "attendance_logs", "approvals", "task_activity", "task_dependencies",
    "tasks", "project_members", "projects", "user_roles", "profiles", "departments",
    "companies", "users",
]
ENUMS = [
    "channel_type", "notification_type", "attendance_status", "leave_status", "leave_type",
    "approval_status", "approval_type", "dependency_type", "priority_level", "task_status",
    "visibility_scope", "user_status", "user_role",
]


def upgrade() -> None:
    sql = SCHEMA_SQL.read_text(encoding="utf-8")
    op.execute(sql)


def downgrade() -> None:
    for t in TABLES:
        op.execute(f"DROP TABLE IF EXISTS public.{t} CASCADE")
    op.execute("DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE")
    for e in ENUMS:
        op.execute(f"DROP TYPE IF EXISTS public.{e} CASCADE")
