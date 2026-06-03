"""P2 data-layer endpoint tests: attendance, leave, approvals, chat, notifications.

Requires the seeded `kiron` DB (run `python -m app.seed`).
"""
import datetime as dt
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.seed import APPROVAL, CONV

client = TestClient(app)


def auth(email: str) -> dict:
    r = client.post("/auth/login", json={"email": email, "password": "Kiron@2025"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


EMP = "varsha.cheriyala@kirongroup.in"
HR = "anita@kirongroup.in"
MANAGER = "samiyuddin.mohammed@kirongroup.in"
INTERN = "pallavi.gonepalli@kirongroup.in"


def test_attendance_checkin_duplicate_and_checkout():
    h = auth(EMP)
    day = f"2026-01-{uuid.uuid4().int % 27 + 1:02d}"  # random-ish unique day
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    r = client.post("/attendance", json={"work_date": day, "check_in_at": now}, headers=h)
    assert r.status_code == 201, r.text
    log_id = r.json()["id"]
    # duplicate same date -> 409
    dup = client.post("/attendance", json={"work_date": day, "check_in_at": now}, headers=h)
    assert dup.status_code == 409
    # check out
    out = client.patch(f"/attendance/{log_id}", json={"check_out_at": now}, headers=h)
    assert out.status_code == 200
    assert out.json()["check_out_at"] is not None


def test_leave_apply_then_hr_decides_employee_cannot():
    emp = auth(EMP)
    r = client.post("/leave", json={"leave_type": "casual_leave", "start_date": "2026-06-01",
                                    "end_date": "2026-06-02", "days": 2, "reason": "trip"}, headers=emp)
    assert r.status_code == 201, r.text
    leave_id = r.json()["id"]
    assert r.json()["status"] == "pending"
    # another employee (intern) cannot decide it
    bad = client.patch(f"/leave/{leave_id}", json={"status": "approved"}, headers=auth(INTERN))
    assert bad.status_code == 403
    # HR approves -> stamps approver server-side
    ok = client.patch(f"/leave/{leave_id}", json={"status": "approved"}, headers=auth(HR))
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved"
    assert ok.json()["hr_approver_id"] is not None


def test_approval_decided_by_approver_not_requester():
    # Varsha is the requester -> cannot decide
    bad = client.patch(f"/approvals/{APPROVAL}", json={"status": "approved"}, headers=auth(EMP))
    assert bad.status_code == 403
    # Samiyuddin is the named approver -> can decide
    ok = client.patch(f"/approvals/{APPROVAL}", json={"status": "approved", "comments": "lgtm"}, headers=auth(MANAGER))
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved"
    assert ok.json()["approver_id"] is not None


def test_chat_member_can_send_nonmember_cannot():
    ok = client.post("/messages", json={"conversation_id": CONV, "body": "hello team"}, headers=auth(EMP))
    assert ok.status_code == 201, ok.text
    assert ok.json()["sender_id"] is not None
    # Pallavi (intern) is not a member of this conversation
    bad = client.post("/messages", json={"conversation_id": CONV, "body": "intruder"}, headers=auth(INTERN))
    assert bad.status_code == 403


def test_notifications_mark_read_and_all():
    h = auth(EMP)
    boot = client.get("/bootstrap", headers=h).json()
    notifs = boot["notifications"]
    assert len(notifs) >= 1
    one = notifs[0]["id"]
    r = client.patch(f"/notifications/{one}/read", headers=h)
    assert r.status_code == 204
    allr = client.post("/notifications/mark-all-read", headers=h)
    assert allr.status_code == 200
    assert "updated" in allr.json()
