"""Authorization rules ported from the Postgres RLS policies.

In Supabase these lived as RLS + has_role/has_any_role. Here they are plain
Python so every endpoint enforces the same row access the DB used to.
"""

# Roles that could see everything in the task/project RLS policies.
GLOBAL_ROLES = {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"}
# HR-style data (attendance, leave) added hr_admin to the elevated set.
HR_ROLES = {"super_admin", "founder", "hr_admin"}
# Who may create tasks (tasks_insert_auth).
TASK_CREATE_ROLES = {"super_admin", "founder", "manager", "founder_office_coordinator", "hr_admin"}
# Who may decide an approval regardless of being the named approver.
APPROVAL_DECIDE_ROLES = {"super_admin", "founder"}


def has_any_role(roles: set[str], allowed: set[str]) -> bool:
    return bool(roles & allowed)


def can_update_leave(leave: dict, uid: str, roles: set[str]) -> bool:
    # leave_update_scoped: own row (self can only touch pending) OR HR/super_admin.
    if has_any_role(roles, HR_ROLES):
        return True
    return leave.get("user_id") == uid and leave.get("status") == "pending"


def can_update_attendance(log: dict, uid: str, roles: set[str]) -> bool:
    # attendance_update_scoped: own row OR super_admin/hr_admin.
    return log.get("user_id") == uid or has_any_role(roles, HR_ROLES)


def can_decide_approval(approval: dict, uid: str, roles: set[str]) -> bool:
    # approvals_update_approver: named approver OR super_admin/founder.
    return approval.get("approver_id") == uid or has_any_role(roles, APPROVAL_DECIDE_ROLES)


def can_see_all_tasks(roles: set[str]) -> bool:
    return has_any_role(roles, GLOBAL_ROLES)


def can_update_task(task: dict, uid: str, roles: set[str]) -> bool:
    if has_any_role(roles, GLOBAL_ROLES):
        return True
    return uid in {
        task.get("assignee_id"),
        task.get("reviewer_id"),
        task.get("reporting_manager_id"),
        task.get("created_by"),
    }


def can_view_task(task: dict, uid: str, roles: set[str], member_project_ids: set[str]) -> bool:
    if can_update_task(task, uid, roles):
        return True
    pid = task.get("project_id")
    return pid is not None and pid in member_project_ids


def can_create_task(created_by: str | None, uid: str, roles: set[str]) -> bool:
    # tasks_insert_auth: created_by = self OR an elevated role.
    return created_by == uid or has_any_role(roles, TASK_CREATE_ROLES)
