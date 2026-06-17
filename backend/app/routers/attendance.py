import datetime as _dt
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..authz import can_update_attendance, can_view_attendance_followup
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


# -------------------- Follow-up (today's missing check-ins) --------------------

def _effective_work_days(profile: dict, company: dict | None) -> list[int]:
    """ISO 1..7 list of working days. Profile override > company default
    > a sane fallback of Mon-Sat."""
    p_days = profile.get("work_days")
    if p_days:
        return list(p_days)
    if company:
        c_days = company.get("work_days")
        if c_days:
            return list(c_days)
    return [1, 2, 3, 4, 5, 6]


def _saturday_working_today(today: _dt.date, profile: dict, company: dict | None) -> bool:
    """True iff today is Sat (ISO 6) AND the Saturday-of-month pattern
    accepts the current week-of-month. The pattern is a list of 1..5
    where 1=first Sat of month, etc. Empty / null = every Saturday works
    (back-compat with the pre-0008 schema)."""
    if today.isoweekday() != 6:
        return True
    sat_weeks = profile.get("saturday_weeks_working")
    if sat_weeks is None and company:
        sat_weeks = company.get("saturday_weeks_working")
    if not sat_weeks:
        return True
    # which Saturday-of-month is today? 1..5. Integer math without arrays.
    week_of_month = ((today.day - 1) // 7) + 1
    return week_of_month in list(sat_weeks)


@router.get("/followup")
def followup(
    date: Optional[str] = Query(None, description="YYYY-MM-DD. Defaults to today (server local date, IST)."),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns three buckets for the given date: people who SHOULD be
    here today but haven't checked in (`missing`), people who have
    (`checked_in`), and people on approved leave (`on_leave`). Used by
    the Team Attendance page so HR / TA can follow up.

    Authz: caller must be in ATTENDANCE_FOLLOWUP_ROLES or have the
    per-user opt-in flag set on their own profile (granted by HR for
    TA / recruitment staff)."""

    # Self-profile lookup is needed because the per-user opt-in flag
    # lives on the profile row, not on the JWT claims.
    me = db.execute(
        text("SELECT attendance_followup_access FROM profiles WHERE id = :id"),
        {"id": user.id},
    ).mappings().first()
    if not can_view_attendance_followup(user.roles, dict(me) if me else None):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to see the attendance follow-up")

    try:
        target = _dt.date.fromisoformat(date) if date else _dt.date.today()
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "date must be YYYY-MM-DD")

    iso_day = target.isoweekday()

    # Active employees (exclude exited / inactive). Pull every field the
    # UI renders for the row + the schedule override fields needed to
    # decide if today is a working day for them.
    profiles = db.execute(
        text(
            "SELECT id, full_name, email, designation, home_company_id, "
            "       reporting_manager_id, work_days, saturday_weeks_working, "
            "       phone "
            "FROM profiles WHERE is_active = true"
        )
    ).mappings().all()

    companies = db.execute(
        text("SELECT id, work_days, saturday_weeks_working FROM companies")
    ).mappings().all()
    co_by_id = {str(c["id"]): dict(c) for c in companies}

    today_attendance = db.execute(
        text(
            "SELECT user_id, check_in_at, check_out_at, status, source "
            "FROM attendance_logs WHERE work_date = :d"
        ),
        {"d": target.isoformat()},
    ).mappings().all()
    att_by_user = {str(a["user_id"]): dict(a) for a in today_attendance}

    leave_today = db.execute(
        text(
            "SELECT user_id, leave_type, start_date, end_date "
            "FROM leave_requests "
            "WHERE status = 'approved' AND start_date <= :d AND end_date >= :d"
        ),
        {"d": target.isoformat()},
    ).mappings().all()
    leave_by_user = {str(l["user_id"]): dict(l) for l in leave_today}

    missing: list[dict] = []
    checked_in: list[dict] = []
    on_leave: list[dict] = []
    off_today: list[dict] = []

    for p in profiles:
        pid = str(p["id"])
        company = co_by_id.get(str(p.get("home_company_id"))) if p.get("home_company_id") else None
        work_days = _effective_work_days(dict(p), company)

        # Schedule eligibility — is today a working day for this person?
        is_work_day = iso_day in work_days
        if is_work_day and iso_day == 6:
            # Saturday-of-month pattern can shrink the set further.
            if not _saturday_working_today(target, dict(p), company):
                is_work_day = False

        # Common payload fields rendered in the UI.
        row_data = {
            "user_id": pid,
            "name": p.get("full_name"),
            "email": p.get("email"),
            "phone": p.get("phone"),
            "designation": p.get("designation"),
            "home_company_id": str(p["home_company_id"]) if p.get("home_company_id") else None,
            "reporting_manager_id": str(p["reporting_manager_id"]) if p.get("reporting_manager_id") else None,
        }

        if pid in leave_by_user:
            row_data["leave_type"] = leave_by_user[pid]["leave_type"]
            on_leave.append(row_data)
            continue

        if not is_work_day:
            off_today.append(row_data)
            continue

        if pid in att_by_user:
            att = att_by_user[pid]
            ci = att.get("check_in_at")
            row_data["check_in_at"] = ci.isoformat() if ci else None
            row_data["check_in_status"] = att.get("status")
            checked_in.append(row_data)
        else:
            missing.append(row_data)

    return {
        "date": target.isoformat(),
        "iso_weekday": iso_day,
        "totals": {
            "missing": len(missing),
            "checked_in": len(checked_in),
            "on_leave": len(on_leave),
            "off_today": len(off_today),
        },
        "missing": missing,
        "checked_in": checked_in,
        "on_leave": on_leave,
        "off_today": off_today,
    }
