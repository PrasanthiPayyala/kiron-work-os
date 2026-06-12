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
# Who may create, edit, deactivate, or reactivate user accounts.
USER_MANAGE_ROLES = {"super_admin", "hr_admin"}
# Who may create, edit, or change the schedule of a company. Wider than
# USER_MANAGE_ROLES because the founder + founder office are the people who
# actually onboard new group entities and keep their profile data current.
COMPANY_MANAGE_ROLES = {"super_admin", "founder", "founder_office_coordinator", "hr_admin"}


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


# ---------- Projects ----------

def can_create_project(roles: set[str]) -> bool:
    # Mirrors src/lib/auth.tsx `can.createProjects`: anyone except intern.
    return "intern" not in roles or has_any_role(roles, GLOBAL_ROLES)


def can_manage_project(project: dict, uid: str, roles: set[str]) -> bool:
    """Allowed to edit project fields, add/remove members, or delete."""
    if has_any_role(roles, GLOBAL_ROLES):
        return True
    return uid in {
        project.get("owner_id"),
        project.get("created_by"),
        project.get("approver_id"),
    }


# ---------- Users ----------

def can_manage_users(roles: set[str]) -> bool:
    """Create new accounts, edit profile fields, set roles, deactivate."""
    return has_any_role(roles, USER_MANAGE_ROLES)


def can_manage_companies(roles: set[str]) -> bool:
    """Create a company, edit its profile (CIN/GST/addresses/directors/etc.),
    or change its schedule. Wider than user management because onboarding
    new entities is a founder-office / HR responsibility, not just IT."""
    return has_any_role(roles, COMPANY_MANAGE_ROLES)
