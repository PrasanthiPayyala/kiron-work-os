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

# Splits COMPANY_MANAGE_ROLES into a scoped pair so HR can fix addresses /
# phone / logo / schedule but cannot quietly rewrite GST/CIN/PAN/bank refs.
# Used by routers/companies.py PATCH to enforce per-field access; the gate
# (`can_edit_company_basic`) stays unchanged for any HR access.
COMPANY_EDIT_BASIC = COMPANY_MANAGE_ROLES
COMPANY_EDIT_FINANCE = {"super_admin", "founder", "founder_office_coordinator"}

# ---------- Contacts ----------
# Who can see the Contacts page at all. Managers get in to see business
# contacts (clients, vendors, partners) — read-only at the category level.
CONTACTS_VIEW_ROLES = {
    "super_admin", "founder", "founder_office_coordinator",
    "founder_office_support", "hr_admin", "manager",
}
# Who can create / edit / delete contacts in general. Per-category edit
# permissions further restrict this (e.g. HR can edit recruitment but not
# investor contacts).
CONTACTS_EDIT_ROLES = {
    "super_admin", "founder", "founder_office_coordinator", "hr_admin",
}

# Category → set of roles allowed to *see* the contact rows + their fields
# in the API response. The Contacts page filters server-side using this,
# so a role that can't see "investor" never receives those rows at all.
CONTACT_CATEGORY_VIEW: dict[str, set[str]] = {
    # Compliance — sensitive
    "ca":            {"super_admin", "founder", "founder_office_coordinator", "founder_office_support", "hr_admin"},
    "cs":            {"super_admin", "founder", "founder_office_coordinator", "founder_office_support", "hr_admin"},
    "auditor":       {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"},
    "lawyer":        {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"},
    "banker":        {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"},
    "insurance":     {"super_admin", "founder", "founder_office_coordinator", "founder_office_support", "hr_admin"},
    "investor":      {"super_admin", "founder", "founder_office_coordinator"},
    "govt_official": {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"},
    # Business — managers can see (read-only enforced at the EDIT map)
    "client_poc":      CONTACTS_VIEW_ROLES,
    "vendor_poc":      CONTACTS_VIEW_ROLES,
    "channel_partner": CONTACTS_VIEW_ROLES,
    "collaborator":    CONTACTS_VIEW_ROLES,
    "advisor":         {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"},
    "mentor":          {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"},
    "press":           {"super_admin", "founder", "founder_office_coordinator"},
    "industry_body":   {"super_admin", "founder", "founder_office_coordinator", "founder_office_support"},
    # Recruitment — HR + founder office (+ managers for awareness)
    "college":            {"super_admin", "founder", "founder_office_coordinator", "hr_admin", "manager"},
    "tpo":                {"super_admin", "founder", "founder_office_coordinator", "hr_admin", "manager"},
    "training_institute": {"super_admin", "founder", "founder_office_coordinator", "hr_admin", "manager"},
    "recruitment_agency": {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
    # IT / Vendor
    "domain_registrar": {"super_admin", "founder", "founder_office_coordinator", "founder_office_support", "hr_admin"},
    "hosting_saas":     {"super_admin", "founder", "founder_office_coordinator", "founder_office_support", "hr_admin"},
    "agency":           CONTACTS_VIEW_ROLES,
    "other":            CONTACTS_VIEW_ROLES,
}

# Category → set of roles allowed to *edit* contact rows of that category.
# Managers are excluded across the board — they read business contacts but
# additions/corrections route through founder office for quality control.
CONTACT_CATEGORY_EDIT: dict[str, set[str]] = {
    # Compliance — only super_admin + founder office coord (not HR, not founder_office_support)
    "ca":            {"super_admin", "founder", "founder_office_coordinator"},
    "cs":            {"super_admin", "founder", "founder_office_coordinator"},
    "auditor":       {"super_admin", "founder", "founder_office_coordinator"},
    "lawyer":        {"super_admin", "founder", "founder_office_coordinator"},
    "banker":        {"super_admin", "founder", "founder_office_coordinator"},
    "insurance":     {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
    "investor":      {"super_admin", "founder"},
    "govt_official": {"super_admin", "founder", "founder_office_coordinator"},
    # Business
    "client_poc":      {"super_admin", "founder", "founder_office_coordinator"},
    "vendor_poc":      {"super_admin", "founder", "founder_office_coordinator"},
    "channel_partner": {"super_admin", "founder", "founder_office_coordinator"},
    "collaborator":    {"super_admin", "founder", "founder_office_coordinator"},
    "advisor":         {"super_admin", "founder", "founder_office_coordinator"},
    "mentor":          {"super_admin", "founder", "founder_office_coordinator"},
    "press":           {"super_admin", "founder", "founder_office_coordinator"},
    "industry_body":   {"super_admin", "founder", "founder_office_coordinator"},
    # Recruitment
    "college":            {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
    "tpo":                {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
    "training_institute": {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
    "recruitment_agency": {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
    # IT / Vendor
    "domain_registrar": {"super_admin", "founder", "founder_office_coordinator"},
    "hosting_saas":     {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
    "agency":           {"super_admin", "founder", "founder_office_coordinator"},
    "other":            {"super_admin", "founder", "founder_office_coordinator", "hr_admin"},
}

# All known categories — derived from the VIEW map so the source of truth
# stays single. Must match the CHECK constraint in migration 0010.
CONTACT_CATEGORIES = set(CONTACT_CATEGORY_VIEW.keys())


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


def can_edit_company_basic(roles: set[str]) -> bool:
    """Can edit non-finance company fields (logo, addresses, phone, schedule).
    HR is included — they may correct day-to-day operational info."""
    return has_any_role(roles, COMPANY_EDIT_BASIC)


def can_edit_company_finance(roles: set[str]) -> bool:
    """Can edit finance/regulatory fields (CIN, GST, PAN, TAN, MSME, DPIIT,
    bank accounts). Tighter than basic — HR is excluded so tax IDs can't be
    quietly rewritten."""
    return has_any_role(roles, COMPANY_EDIT_FINANCE)


# ---------- Contacts ----------

def can_view_contacts(roles: set[str]) -> bool:
    """Can open the Contacts page at all. Per-category visibility still
    gates which rows the API returns."""
    return has_any_role(roles, CONTACTS_VIEW_ROLES)


def can_edit_contacts(roles: set[str]) -> bool:
    """Can create / edit / delete contacts in general. Per-category edit
    rules further restrict this."""
    return has_any_role(roles, CONTACTS_EDIT_ROLES)


def can_view_contact_category(roles: set[str], category: str) -> bool:
    """True iff caller may see contact rows of the given category."""
    allowed = CONTACT_CATEGORY_VIEW.get(category)
    return allowed is not None and has_any_role(roles, allowed)


def can_edit_contact_category(roles: set[str], category: str) -> bool:
    """True iff caller may create / edit contact rows of the given category."""
    allowed = CONTACT_CATEGORY_EDIT.get(category)
    return allowed is not None and has_any_role(roles, allowed)


def visible_categories(roles: set[str]) -> set[str]:
    """All categories the caller may see — used for server-side filtering."""
    return {cat for cat, allowed in CONTACT_CATEGORY_VIEW.items() if has_any_role(roles, allowed)}
