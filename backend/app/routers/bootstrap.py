"""Single hydration endpoint replacing dataStore's 14 parallel Supabase queries.

Returns rows in the same snake_case shape the Supabase client returned, so the
frontend mappers (src/lib/mappers.ts) work unchanged. Row access mirrors the old
RLS policies (see app/authz.py).
"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import (
    ATTENDANCE_VIEW_ROLES, GLOBAL_ROLES, HR_ROLES, PROJECT_VIEW_ALL_ROLES,
    can_view_task, has_any_role,
)
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(tags=["bootstrap"])

APPROVAL_ELEVATED = {"super_admin", "founder", "founder_office_coordinator", "hr_admin"}
CONV_ELEVATED = {"super_admin", "founder"}


def _rows(db: Session, sql: str, params: dict | None = None) -> list[dict]:
    return [row(m) for m in db.execute(text(sql), params or {}).mappings().all()]


@router.get("/bootstrap")
def bootstrap(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    uid = user.id
    roles = user.roles

    # --- reference tables: visible to all authenticated users ---
    companies = _rows(db, "SELECT * FROM companies")
    departments = _rows(db, "SELECT * FROM departments")
    profiles = _rows(db, "SELECT * FROM profiles")

    # user_roles: everyone sees everyone's roles. Profiles are already
    # exposed to all signed-in users (line above), and the People page
    # renders role labels — hiding the rows just left non-super_admin
    # viewers seeing every colleague as the default "employee" fallback,
    # which also broke HR's ability to confirm role edits visually after
    # saving. Old behaviour (own row only) is the Supabase RLS legacy.
    user_roles = _rows(db, "SELECT user_id, role FROM user_roles")

    # --- the caller's memberships, used for scoping below ---
    member_project_ids = {
        r["project_id"]
        for r in _rows(db, "SELECT project_id FROM project_members WHERE user_id = :uid", {"uid": uid})
    }
    member_conv_ids = {
        r["conversation_id"]
        for r in _rows(db, "SELECT conversation_id FROM conversation_members WHERE user_id = :uid", {"uid": uid})
    }
    # users who report to the caller (for attendance/leave manager visibility)
    managed_user_ids = {
        r["id"]
        for r in _rows(db, "SELECT id FROM profiles WHERE reporting_manager_id = :uid", {"uid": uid})
    }

    # --- projects ---
    # PROJECT_VIEW_ALL_ROLES (GLOBAL_ROLES + hr_admin) see every project
    # regardless of membership — HR needs the full list for performance
    # reviews and staffing decisions, founders/founder office for cross-
    # company coordination. Everyone else sees only projects they own,
    # created, approve, or are a member of.
    all_projects = _rows(db, "SELECT * FROM projects")
    if has_any_role(roles, PROJECT_VIEW_ALL_ROLES):
        projects = all_projects
    else:
        projects = [
            p for p in all_projects
            if uid in {p.get("owner_id"), p.get("created_by"), p.get("approver_id")}
            or p["id"] in member_project_ids
        ]
    visible_project_ids = {p["id"] for p in projects}
    project_members = _rows(
        db,
        "SELECT project_id, user_id FROM project_members WHERE project_id = ANY(:ids)",
        {"ids": list(visible_project_ids)} if visible_project_ids else {"ids": []},
    )

    # --- tasks (the scoping proof) ---
    all_tasks = _rows(db, "SELECT * FROM tasks")
    tasks = [t for t in all_tasks if can_view_task(t, uid, roles, member_project_ids)]

    # --- approvals ---
    all_approvals = _rows(db, "SELECT * FROM approvals")
    if has_any_role(roles, APPROVAL_ELEVATED):
        approvals = all_approvals
    else:
        approvals = [a for a in all_approvals if uid in {a.get("requested_by"), a.get("approver_id")}]

    # --- attendance / leave (self, managed reports, or HR/elevated) ---
    # Attendance has a wider view set than leave on purpose: founder's
    # office needs to see the company-wide check-in roster to follow up,
    # even though they don't approve leave. Leave stays gated to HR
    # (super_admin / founder / hr_admin) + manager-of-record.
    elevated_attendance = has_any_role(roles, ATTENDANCE_VIEW_ROLES)
    elevated_hr = has_any_role(roles, HR_ROLES)
    all_attendance = _rows(db, "SELECT * FROM attendance_logs")
    attendance = all_attendance if elevated_attendance else [
        a for a in all_attendance if a.get("user_id") == uid or a.get("user_id") in managed_user_ids
    ]
    all_leaves = _rows(db, "SELECT * FROM leave_requests")
    leaves = all_leaves if elevated_hr else [
        l for l in all_leaves if l.get("user_id") == uid or l.get("user_id") in managed_user_ids
    ]

    # Attendance permissions: hour-scale signed-off shortfalls. HR sees
    # everything for the approval queue + hours rollup; everyone else
    # sees their own + their managed reports' (so a manager can review).
    all_permissions = _rows(db, "SELECT * FROM attendance_permissions")
    attendance_permissions = all_permissions if elevated_hr else [
        p for p in all_permissions if p.get("user_id") == uid or p.get("user_id") in managed_user_ids
    ]

    # --- conversations / members / messages ---
    all_convs = _rows(db, "SELECT * FROM conversations")
    is_elevated = has_any_role(roles, CONV_ELEVATED)
    # Per-viewer hides (delete chat from my view). Founder + super_admin
    # see everything regardless — that's the audit layer the founders
    # asked for. The trigger on messages INSERT auto-clears the hide so
    # a new inbound message reopens the chat.
    hidden_conv_ids: set[str] = set()
    hidden_msg_ids: set[str] = set()
    if not is_elevated:
        hidden_conv_ids = {
            r["conversation_id"]
            for r in _rows(
                db,
                "SELECT conversation_id FROM conversation_hides WHERE user_id = :uid",
                {"uid": uid},
            )
        }
        hidden_msg_ids = {
            r["message_id"]
            for r in _rows(
                db,
                "SELECT message_id FROM message_hides WHERE user_id = :uid",
                {"uid": uid},
            )
        }
    if is_elevated:
        conversations = all_convs
    else:
        conversations = [
            c for c in all_convs
            if c["id"] in member_conv_ids and c["id"] not in hidden_conv_ids
        ]
    visible_conv_ids = {c["id"] for c in conversations}
    conv_members = _rows(
        db,
        "SELECT conversation_id, user_id, last_read_at "
        "FROM conversation_members WHERE conversation_id = ANY(:ids)",
        {"ids": list(visible_conv_ids)} if visible_conv_ids else {"ids": []},
    )
    messages = _rows(
        db,
        "SELECT * FROM messages WHERE conversation_id = ANY(:ids) ORDER BY created_at ASC",
        {"ids": list(visible_conv_ids)} if visible_conv_ids else {"ids": []},
    )
    if not is_elevated and hidden_msg_ids:
        messages = [m for m in messages if m["id"] not in hidden_msg_ids]
    # For elevated viewers, decorate every message with the list of users
    # who hid it from their own view — that's the audit signal the UI uses
    # to render "Karunya hid this from her view" on the bubble.
    if is_elevated and messages:
        msg_ids = [m["id"] for m in messages]
        hide_rows = _rows(
            db,
            "SELECT message_id, user_id FROM message_hides WHERE message_id = ANY(:ids)",
            {"ids": msg_ids},
        )
        by_msg: dict[str, list[str]] = {}
        for h in hide_rows:
            by_msg.setdefault(h["message_id"], []).append(h["user_id"])
        for m in messages:
            m["hidden_by"] = by_msg.get(m["id"], [])
    # Pull attachments for the visible messages in one round-trip so chat
    # bubbles render with file chips on reload + when WS broadcasts are missed
    # (recipient tab closed / network blip, no replay). Same shape mapMessage
    # already understands.
    if messages:
        msg_ids = [m["id"] for m in messages]
        att_rows = _rows(
            db,
            "SELECT id, entity_id, file_name, file_size, mime_type "
            "FROM attachments WHERE entity_type = 'message' AND entity_id = ANY(:ids)",
            {"ids": msg_ids},
        )
        by_msg: dict[str, list[dict]] = {}
        for a in att_rows:
            by_msg.setdefault(a["entity_id"], []).append({
                "id": a["id"],
                "file_name": a["file_name"],
                "file_size": a["file_size"],
                "mime_type": a["mime_type"],
            })
        for m in messages:
            m["attachments"] = by_msg.get(m["id"], [])

    # --- notifications (self only) ---
    notifications = _rows(db, "SELECT * FROM notifications WHERE user_id = :uid", {"uid": uid})

    # --- holidays (all rows; the client filters by company_id where needed) ---
    holidays = _rows(db, "SELECT * FROM holidays ORDER BY date ASC, name ASC")

    # --- offices (active rows only; the client filters by company_id
    # in the People + Attendance flows). Cheap query — at our scale this
    # is a couple dozen rows max.
    offices = _rows(
        db,
        "SELECT * FROM offices WHERE is_active = true ORDER BY company_id, name",
    )

    # --- teams ---
    # Global-team viewers (super_admin / founder / founder_office_coordinator)
    # see every team; everyone else sees only the teams they belong to.
    GLOBAL_TEAM_ROLES = {"super_admin", "founder", "founder_office_coordinator"}
    if has_any_role(roles, GLOBAL_TEAM_ROLES):
        teams_rows = _rows(db, "SELECT * FROM teams ORDER BY created_at DESC")
    else:
        teams_rows = _rows(
            db,
            "SELECT t.* FROM teams t "
            "JOIN team_members m ON m.team_id = t.id "
            "WHERE m.user_id = :uid "
            "ORDER BY t.created_at DESC",
            {"uid": uid},
        )
    team_ids = [t["id"] for t in teams_rows]
    if team_ids:
        team_members = _rows(
            db,
            "SELECT team_id, user_id, member_role FROM team_members WHERE team_id = ANY(:ids)",
            {"ids": team_ids},
        )
    else:
        team_members = []

    return {
        "companies": companies,
        "departments": departments,
        "profiles": profiles,
        "user_roles": user_roles,
        "projects": projects,
        "project_members": project_members,
        "tasks": tasks,
        "approvals": approvals,
        "attendance_logs": attendance,
        "leave_requests": leaves,
        "attendance_permissions": attendance_permissions,
        "conversations": conversations,
        "conversation_members": conv_members,
        "messages": messages,
        "notifications": notifications,
        "holidays": holidays,
        "offices": offices,
        "teams": teams_rows,
        "team_members": team_members,
    }
