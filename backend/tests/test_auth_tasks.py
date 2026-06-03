"""End-to-end-ish tests against a running DB (seeded). Run:  pytest

Requires DATABASE_URL pointing at the seeded `kiron` DB (same as the app).
"""
from fastapi.testclient import TestClient

from app.main import app
from app.seed import U_VARSHA

client = TestClient(app)

CONFIDENTIAL_TASK = "c0000000-0000-0000-0000-0000000000c2"  # assigned to manager, not Varsha


def login(email: str) -> str:
    r = client.post("/auth/login", json={"email": email, "password": "Kiron@2025"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth(email: str) -> dict:
    return {"Authorization": f"Bearer {login(email)}"}


def test_login_and_me():
    h = auth("varsha.cheriyala@kirongroup.in")
    me = client.get("/auth/me", headers=h).json()
    assert me["profile"]["id"] == U_VARSHA
    assert me["roles"] == ["employee"]


def test_bad_password_rejected():
    r = client.post("/auth/login", json={"email": "varsha.cheriyala@kirongroup.in", "password": "wrong"})
    assert r.status_code == 401


def test_superadmin_sees_all_tasks_employee_does_not():
    admin_tasks = client.get("/bootstrap", headers=auth("kiran@kirongroup.in")).json()["tasks"]
    emp_tasks = client.get("/bootstrap", headers=auth("varsha.cheriyala@kirongroup.in")).json()["tasks"]
    admin_ids = {t["id"] for t in admin_tasks}
    emp_ids = {t["id"] for t in emp_tasks}
    assert CONFIDENTIAL_TASK in admin_ids
    assert CONFIDENTIAL_TASK not in emp_ids  # RLS parity: employee can't see unrelated task


def test_employee_cannot_edit_unrelated_task():
    r = client.patch(
        f"/tasks/{CONFIDENTIAL_TASK}",
        json={"status": "done"},
        headers=auth("varsha.cheriyala@kirongroup.in"),
    )
    assert r.status_code == 403


def test_employee_can_edit_own_task():
    own = "c0000000-0000-0000-0000-0000000000c4"  # created by + assigned to Varsha
    r = client.patch(f"/tasks/{own}", json={"priority": "high"}, headers=auth("varsha.cheriyala@kirongroup.in"))
    assert r.status_code == 200, r.text
    assert r.json()["priority"] == "high"
