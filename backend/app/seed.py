"""Seed the self-hosted DB with the demo accounts + sample data.

Replaces the Supabase `provision-seed-users` edge function. Idempotent: uses
fixed UUIDs and ON CONFLICT DO NOTHING, so re-running is safe.

Run:  python -m app.seed
"""
from sqlalchemy import text

from .db import engine
from .security import hash_password

PASSWORD = "Kiron@2025"

CO = "a0000000-0000-0000-0000-0000000000a1"
DEPT = "a0000000-0000-0000-0000-0000000000b1"

# (id, email, full_name, role, designation, manager_id)
U_KIRAN = "00000000-0000-0000-0000-000000000001"
U_PRAS = "00000000-0000-0000-0000-000000000002"
U_ANITA = "00000000-0000-0000-0000-000000000003"
U_SAMI = "00000000-0000-0000-0000-000000000004"
U_VARSHA = "00000000-0000-0000-0000-000000000005"
U_PALLAVI = "00000000-0000-0000-0000-000000000006"

USERS = [
    (U_KIRAN, "kiran@kirongroup.in", "Kiran", "super_admin", "Super Admin", None),
    (U_PRAS, "prasanthi@kirongroup.in", "Prasanthi", "founder", "Founder", None),
    (U_ANITA, "anita@kirongroup.in", "Anita", "hr_admin", "HR Admin", None),
    (U_SAMI, "samiyuddin.mohammed@kirongroup.in", "Samiyuddin Mohammed", "manager", "Manager", U_PRAS),
    (U_VARSHA, "varsha.cheriyala@kirongroup.in", "Varsha Cheriyala", "employee", "Associate", U_SAMI),
    (U_PALLAVI, "pallavi.gonepalli@kirongroup.in", "Pallavi Gonepalli", "intern", "Intern", U_SAMI),
]

# (id, title, status, priority, assignee, created_by, reporting_manager)
TASKS = [
    ("c0000000-0000-0000-0000-0000000000c1", "Prepare Q2 board deck", "in_progress", "high", U_VARSHA, U_SAMI, U_SAMI),
    ("c0000000-0000-0000-0000-0000000000c2", "Confidential founder review", "created", "critical", U_SAMI, U_SAMI, U_PRAS),
    ("c0000000-0000-0000-0000-0000000000c3", "Intern onboarding checklist", "assigned", "medium", U_PALLAVI, U_SAMI, U_SAMI),
    ("c0000000-0000-0000-0000-0000000000c4", "Update vendor tracker", "created", "low", U_VARSHA, U_VARSHA, U_SAMI),
]

# Approval requested by Varsha, routed to her manager Samiyuddin as approver.
APPROVAL = "d0000000-0000-0000-0000-0000000000d1"
# A team conversation Kiran/Samiyuddin/Varsha belong to (Pallavi does not).
CONV = "e0000000-0000-0000-0000-0000000000e1"
CONV_MEMBERS = [U_KIRAN, U_SAMI, U_VARSHA]
MSG = "e0000000-0000-0000-0000-0000000000f1"
# Notifications for Varsha.
NOTIFS = [
    ("f0000000-0000-0000-0000-000000000001", U_VARSHA, "mention", "You were mentioned", "Samiyuddin mentioned you in Operations Team."),
    ("f0000000-0000-0000-0000-000000000002", U_VARSHA, "general", "Welcome to Kiron", "Your account is ready."),
]


def run() -> None:
    pw = hash_password(PASSWORD)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO companies (id, name, short_name, initials, code) "
                 "VALUES (:id,'Kiron Group','Kiron','KG','KIRON') ON CONFLICT (id) DO NOTHING"),
            {"id": CO},
        )
        conn.execute(
            text("INSERT INTO departments (id, company_id, name) "
                 "VALUES (:id,:co,'Operations') ON CONFLICT (id) DO NOTHING"),
            {"id": DEPT, "co": CO},
        )
        for uid, email, name, role, desig, mgr in USERS:
            conn.execute(
                text("INSERT INTO users (id, email, password_hash) VALUES (:id,:email,:pw) "
                     "ON CONFLICT (id) DO NOTHING"),
                {"id": uid, "email": email, "pw": pw},
            )
            conn.execute(
                text("INSERT INTO profiles (id, full_name, email, designation, home_company_id, "
                     "department_id, reporting_manager_id) "
                     "VALUES (:id,:name,:email,:desig,:co,:dept,:mgr) ON CONFLICT (id) DO NOTHING"),
                {"id": uid, "name": name, "email": email, "desig": desig, "co": CO, "dept": DEPT, "mgr": mgr},
            )
            conn.execute(
                text("INSERT INTO user_roles (user_id, role) VALUES (:uid,:role) "
                     "ON CONFLICT (user_id, role) DO NOTHING"),
                {"uid": uid, "role": role},
            )
        for tid, title, status, prio, assignee, creator, mgr in TASKS:
            conn.execute(
                text("INSERT INTO tasks (id, title, status, priority, company_id, assignee_id, "
                     "created_by, reporting_manager_id) "
                     "VALUES (:id,:title,:status,:prio,:co,:assignee,:creator,:mgr) "
                     "ON CONFLICT (id) DO NOTHING"),
                {"id": tid, "title": title, "status": status, "prio": prio, "co": CO,
                 "assignee": assignee, "creator": creator, "mgr": mgr},
            )

        conn.execute(
            text("INSERT INTO approvals (id, approval_type, target_type, target_id, target_label, "
                 "requested_by, approver_id, status) "
                 "VALUES (:id,'task_completion','task',:target,'Prepare Q2 board deck',:req,:appr,'pending') "
                 "ON CONFLICT (id) DO NOTHING"),
            {"id": APPROVAL, "target": "c0000000-0000-0000-0000-0000000000c1", "req": U_VARSHA, "appr": U_SAMI},
        )

        conn.execute(
            text("INSERT INTO conversations (id, channel_type, company_id, title, created_by) "
                 "VALUES (:id,'team_group',:co,'Operations Team',:creator) ON CONFLICT (id) DO NOTHING"),
            {"id": CONV, "co": CO, "creator": U_SAMI},
        )
        for uid in CONV_MEMBERS:
            conn.execute(
                text("INSERT INTO conversation_members (conversation_id, user_id) VALUES (:cid,:uid) "
                     "ON CONFLICT (conversation_id, user_id) DO NOTHING"),
                {"cid": CONV, "uid": uid},
            )
        conn.execute(
            text("INSERT INTO messages (id, conversation_id, sender_id, body) "
                 "VALUES (:id,:cid,:sender,'Kicking off the Q2 board deck — Varsha owns the draft.') "
                 "ON CONFLICT (id) DO NOTHING"),
            {"id": MSG, "cid": CONV, "sender": U_SAMI},
        )

        for nid, uid, ntype, title, body in NOTIFS:
            conn.execute(
                text("INSERT INTO notifications (id, user_id, notification_type, title, body) "
                     "VALUES (:id,:uid,:ntype,:title,:body) ON CONFLICT (id) DO NOTHING"),
                {"id": nid, "uid": uid, "ntype": ntype, "title": title, "body": body},
            )
    print(f"Seeded {len(USERS)} users, {len(TASKS)} tasks, 1 approval, 1 conversation, {len(NOTIFS)} notifications. "
          f"Password for all: {PASSWORD}")


if __name__ == "__main__":
    run()
