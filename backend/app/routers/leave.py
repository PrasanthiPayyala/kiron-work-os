import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_update_leave
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row
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
    reason: str | None = None
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


@router.post("", status_code=status.HTTP_201_CREATED)
def apply(body: LeaveCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
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
    return _get(db, new_id)


@router.patch("/{leave_id}")
def update(leave_id: str, body: LeaveUpdate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
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
    return _get(db, leave_id)
