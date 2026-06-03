import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..authz import can_update_attendance
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/attendance", tags=["attendance"])

UPDATABLE = {"check_out_at", "worked_hours", "status", "notes"}


class CheckIn(BaseModel):
    work_date: str
    check_in_at: str
    status: str = "present"
    source: str = "self_checkin"


def _get(db: Session, log_id: str) -> dict:
    found = db.execute(text("SELECT * FROM attendance_logs WHERE id = :id"), {"id": log_id}).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendance log not found")
    return row(found)


@router.post("", status_code=status.HTTP_201_CREATED)
def check_in(body: CheckIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    new_id = str(uuid.uuid4())
    try:
        db.execute(
            text(
                "INSERT INTO attendance_logs (id, user_id, work_date, check_in_at, status, source) "
                "VALUES (:id, :uid, :work_date, :check_in_at, :status, :source)"
            ),
            {"id": new_id, "uid": user.id, "work_date": body.work_date,
             "check_in_at": body.check_in_at, "status": body.status, "source": body.source},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Already checked in for this date")
    return _get(db, new_id)


@router.patch("/{log_id}")
def update(log_id: str, patch: dict, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    log = _get(db, log_id)
    if not can_update_attendance(log, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this attendance log")
    fields = {k: v for k, v in patch.items() if k in UPDATABLE}
    if not fields:
        return log
    set_clause = ", ".join(f"{c} = :{c}" for c in fields)
    params = dict(fields, id=log_id)
    db.execute(text(f"UPDATE attendance_logs SET {set_clause} WHERE id = :id"), params)
    db.commit()
    return _get(db, log_id)
