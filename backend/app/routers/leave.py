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

router = APIRouter(prefix="/leave", tags=["leave"])

DECISION_STATUSES = {"approved", "rejected"}


class LeaveCreate(BaseModel):
    leave_type: str
    start_date: str
    end_date: str
    days: float = 1
    reason: str | None = None


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
            "INSERT INTO leave_requests (id, user_id, leave_type, start_date, end_date, days, reason, status) "
            "VALUES (:id, :uid, :lt, :sd, :ed, :days, :reason, 'pending')"
        ),
        {"id": new_id, "uid": user.id, "lt": body.leave_type, "sd": body.start_date,
         "ed": body.end_date, "days": body.days, "reason": body.reason},
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
    db.commit()
    return _get(db, leave_id)
