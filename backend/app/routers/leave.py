import datetime as dt
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import NOTIFY_HR_ROLES, can_update_leave
from ..config import settings
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..notifications_email import notify_email
from ..util import row
from . import ws as ws_router
from .leave_balances import apply_balance_delta

router = APIRouter(prefix="/leave", tags=["leave"])

DECISION_STATUSES = {"approved", "rejected"}
# Statuses that "consume" the balance — used to decide whether to
# increment leave_balances.used on transition. ``approved`` is the
# only one today; if we add a paid 'on_hold' or similar later,
# extend this set.
APPROVED_STATES = {"approved"}


class LeaveCreate(BaseModel):
    leave_type: str
    start_date: str
    end_date: str
    days: float = 1
    # Mandatory — HR needs context to approve. Trimmed non-empty enforced.
    reason: str = Field(..., min_length=1)
    # Only meaningful for comp-off advances. Ignored for other types.
    # Planned date the employee will work an off-day to settle this advance.
    comp_off_repay_by: str | None = None


class LeaveUpdate(BaseModel):
    status: str
    hr_comments: str | None = None


def _get(db: Session, leave_id: str) -> dict:
    found = db.execute(text("SELECT * FROM leave_requests WHERE id = :id"), {"id": leave_id}).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Leave request not found")
    return row(found)


_LEAVE_TYPE_LABELS = {
    "casual_leave": "Casual leave",
    "sick_leave": "Sick leave",
    "loss_of_pay": "Unpaid leave",
    "comp_off": "Comp-off",
    "optional_holiday": "Optional holiday",
}


@router.post("", status_code=status.HTTP_201_CREATED)
def apply(
    body: LeaveCreate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO leave_requests (id, user_id, leave_type, start_date, end_date, "
            "                            days, reason, status, comp_off_repay_by) "
            "VALUES (:id, :uid, :lt, :sd, :ed, :days, :reason, 'pending', :repay)"
        ),
        {"id": new_id, "uid": user.id, "lt": body.leave_type, "sd": body.start_date,
         "ed": body.end_date, "days": body.days, "reason": body.reason,
         "repay": body.comp_off_repay_by if body.leave_type == "comp_off" else None},
    )
    db.commit()
    fresh = _get(db, new_id)

    # Notify HR + the requester's reporting manager so the bell pings them
    # (and the Team Attendance "Pending leave" tab updates in realtime).
    # Mirrors the attendance_permissions pattern. NOTIFY_HR_ROLES (not
    # HR_ROLES) — founder/super_admin can still decide anything from Team
    # Attendance, they just don't get paged for every routine request.
    hr_user_ids = {
        str(r[0]) for r in db.execute(
            text(
                "SELECT DISTINCT ur.user_id FROM user_roles ur "
                "JOIN profiles p ON p.id = ur.user_id "
                "WHERE p.is_active = true AND ur.role::text = ANY(:roles)"
            ),
            {"roles": list(NOTIFY_HR_ROLES)},
        ).all()
    }
    mgr_row = db.execute(
        text(
            "SELECT reporting_manager_id, full_name FROM profiles WHERE id = :id"
        ),
        {"id": user.id},
    ).mappings().first()
    req_name = (mgr_row or {}).get("full_name") or "Someone"
    if mgr_row and mgr_row.get("reporting_manager_id"):
        hr_user_ids.add(str(mgr_row["reporting_manager_id"]))
    hr_user_ids.discard(user.id)  # don't ping self when HR applies own leave

    if hr_user_ids:
        type_label = _LEAVE_TYPE_LABELS.get(body.leave_type, body.leave_type.replace("_", " "))
        days_str = f"{body.days:g} day" + ("s" if body.days != 1 else "")
        date_part = (body.start_date
                     if body.start_date == body.end_date
                     else f"{body.start_date} → {body.end_date}")
        title = f"{req_name}: {type_label} ({days_str})"
        body_text = (body.reason[:140] if body.reason else
                     f"Requested for {date_part}. Tap to review.")
        link = f"/team-attendance?leave={new_id}"
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        for uid in hr_user_ids:
            nid = str(uuid.uuid4())
            db.execute(
                text(
                    "INSERT INTO notifications "
                    "  (id, user_id, notification_type, title, body, link) "
                    "VALUES (:id, :u, 'pending_approval', :t, :b, :l)"
                ),
                {"id": nid, "u": uid, "t": title, "b": body_text, "l": link},
            )
            background.add_task(ws_router.notification_new, {
                "id": nid, "user_id": uid,
                "notification_type": "pending_approval",
                "title": title, "body": body_text, "link": link,
                "is_read": False, "created_at": now_iso,
            })
        db.commit()

        # Email channel — one message per HR / manager. Reply-To =
        # applicant so Karunya's "Reply" lands in the requester's inbox.
        email_subject = (
            f"Leave request · {req_name} · {type_label} · {days_str} · {date_part}"
        )
        email_body = (
            f"{req_name} filed a {type_label.lower()} request for {date_part} "
            f"({days_str}).\n\n"
            f"Reason: {body.reason or '(none)'}\n\n"
            f"Approve or reject: {settings.app_base_url}{link}"
        )
        notify_email(
            background, db,
            to_user_ids=hr_user_ids,
            subject=email_subject,
            body_text=email_body,
            reply_to_user_id=user.id,
            from_name_user_id=user.id,
        )
    return fresh


@router.patch("/{leave_id}")
def update(
    leave_id: str,
    body: LeaveUpdate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    leave = _get(db, leave_id)
    if not can_update_leave(leave, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to update this leave request")

    params: dict = {"id": leave_id, "status": body.status}
    sets = ["status = :status"]
    if body.hr_comments is not None:
        sets.append("hr_comments = :hr_comments")
        params["hr_comments"] = body.hr_comments
    # An HR decision stamps the approver + decision time server-side.
    if body.status in DECISION_STATUSES:
        sets.append("hr_approver_id = :approver")
        sets.append("decided_at = :decided")
        params["approver"] = user.id
        params["decided"] = dt.datetime.now(dt.timezone.utc).isoformat()
    db.execute(text(f"UPDATE leave_requests SET {', '.join(sets)} WHERE id = :id"), params)

    # Balance accounting: when status transitions cross the approved
    # boundary, push ±days into leave_balances.used for the requestor.
    was_approved = leave.get("status") in APPROVED_STATES
    now_approved = body.status in APPROVED_STATES
    if was_approved != now_approved:
        delta = float(leave.get("days") or 0)
        if not now_approved:
            delta = -delta  # reverting an approval — give the days back
        # Bucket the delta into the year of the leave start (handles
        # year-straddling leaves by keeping the deduction on the calendar
        # year the leave started — most leave policies operate that way).
        try:
            sd = leave.get("start_date")
            year = int(str(sd)[:4]) if sd else dt.date.today().year
        except (TypeError, ValueError):
            year = dt.date.today().year
        apply_balance_delta(
            db,
            user_id=str(leave.get("user_id")),
            leave_type=str(leave.get("leave_type")),
            days=delta,
            year=year,
        )
    db.commit()

    # Notify the applicant when an HR/manager decides their request,
    # unless they decided their own (HR cancelling their own pending).
    applicant_id = str(leave.get("user_id") or "")
    if body.status in DECISION_STATUSES and applicant_id and applicant_id != user.id:
        type_label = _LEAVE_TYPE_LABELS.get(
            str(leave.get("leave_type") or ""),
            str(leave.get("leave_type") or "leave").replace("_", " "),
        )
        sd, ed = leave.get("start_date"), leave.get("end_date")
        date_part = str(sd) if sd == ed else f"{sd} → {ed}"
        verdict = "approved" if body.status == "approved" else "rejected"
        title = f"{type_label} {verdict}"
        body_text = (body.hr_comments[:140] if body.hr_comments else
                     f"Your leave for {date_part} was {verdict}.")
        link = "/leave"
        nid = str(uuid.uuid4())
        db.execute(
            text(
                "INSERT INTO notifications "
                "  (id, user_id, notification_type, title, body, link) "
                "VALUES (:id, :u, 'general', :t, :b, :l)"
            ),
            {"id": nid, "u": applicant_id, "t": title, "b": body_text, "l": link},
        )
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        background.add_task(ws_router.notification_new, {
            "id": nid, "user_id": applicant_id,
            "notification_type": "general",
            "title": title, "body": body_text, "link": link,
            "is_read": False, "created_at": now_iso,
        })
        db.commit()

        # Email the applicant. Reply-To = deciding user so hitting Reply
        # in Gmail lands with HR / the manager who decided.
        days = float(leave.get("days") or 0)
        days_str = f"{days:g} day" + ("s" if days != 1 else "")
        email_subject = f"Leave {verdict} · {type_label} · {days_str}"
        note = f"\n\nNote: {body.hr_comments}" if body.hr_comments else ""
        email_body = (
            f"Your {type_label.lower()} request for {date_part} "
            f"({days_str}) was {verdict}.{note}\n\n"
            f"See your leave history: {settings.app_base_url}/leave"
        )
        notify_email(
            background, db,
            to_user_ids=[applicant_id],
            subject=email_subject,
            body_text=email_body,
            reply_to_user_id=user.id,
            from_name_user_id=user.id,
        )
    return _get(db, leave_id)
