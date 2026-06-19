import datetime as _dt
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..authz import HR_ROLES, can_update_attendance, can_view_attendance_followup, has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row
from . import ws as ws_router
from .leave_balances import apply_balance_delta

router = APIRouter(prefix="/attendance", tags=["attendance"])

UPDATABLE = {"check_out_at", "worked_hours", "status", "notes"}

# Leave types HR can mark a missed check-in as. Mirrors the leave_type
# enum minus "work_from_home" — WFH is a working state set at check-in
# (attendance_logs.status='work_from_home'), not a leave type. The
# Apply-for-leave UI no longer offers it either.
MARK_LEAVE_TYPES = {
    "casual_leave", "sick_leave", "loss_of_pay",
    "comp_off", "optional_holiday",
}


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
def update(
    log_id: str,
    patch: dict,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
    fresh = _get(db, log_id)
    # Push the new row to the affected employee's open sessions. Critical
    # for the HR "Resume work" path: the employee's tab is showing stale
    # "Day closed" until this broadcast lands and the dataStore splices in
    # the patched row. Self-PATCHes also broadcast — cheap, idempotent on
    # the receiver (own POST already updated the local store, the WS event
    # then no-ops via the id-match guard in dataStore).
    background.add_task(ws_router.attendance_changed, fresh)
    return fresh


# -------------------- HR: mark a missed check-in as approved leave --------------------

class MarkLeaveBody(BaseModel):
    user_id: str
    work_date: str             # YYYY-MM-DD
    leave_type: str            # one of MARK_LEAVE_TYPES
    reason: Optional[str] = None


@router.post("/mark-leave", status_code=status.HTTP_201_CREATED)
def mark_leave(
    body: MarkLeaveBody,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """HR marks a missed check-in as an approved leave for the day.

    Used from the Team Attendance follow-up view: instead of chasing
    the person, HR confirms they're on leave and the row flips from
    'missed_check_in' to 'on_leave' in the next refresh. Triple effect:

      * Inserts an attendance_logs row with status='leave', source
        'hr_marked_leave' — the employee's calendar shades the day
        purple and the 30-day drawer shows the leave badge.
      * Inserts a leave_requests row stamped status='approved' with
        the HR caller as `hr_approver_id` — so payroll's leave-day
        rollup picks it up exactly as if the employee had filed and
        Karunya had approved.
      * Bumps `leave_balances.used` for balanced types (casual / sick
        / comp_off / earned / maternity / paternity) so quota accounting
        is real-time.

    Only HR / super_admin / founder may call this — see HR_ROLES in
    authz.py. Returns the two created rows so the frontend can splice
    them into the local store.

    Idempotency: if an attendance_logs row already exists for the
    target (user, date) we 409 instead of silently double-inserting.
    HR can fix existing rows via PATCH /attendance/{id} instead.
    """
    if not has_any_role(user.roles, HR_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only HR / super_admin / founder can mark leave for someone else")
    if body.leave_type not in MARK_LEAVE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Unsupported leave type for HR-marked leave: {body.leave_type}. "
                            f"Use the Apply-for-leave flow for unusual types.")

    # Sanity check the user exists.
    target = db.execute(
        text("SELECT id, full_name FROM profiles WHERE id = :id"),
        {"id": body.user_id},
    ).mappings().first()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    # --- 1. Insert the attendance log
    att_id = str(uuid.uuid4())
    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    try:
        db.execute(
            text(
                "INSERT INTO attendance_logs (id, user_id, work_date, status, source, notes) "
                "VALUES (:id, :uid, :d, 'leave', 'hr_marked_leave', :notes)"
            ),
            {
                "id": att_id, "uid": body.user_id, "d": body.work_date,
                "notes": f"Marked as leave by HR. {body.reason or ''}".strip(),
            },
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "An attendance log already exists for this date — edit that row instead.",
        )

    # --- 2. Insert the approved leave request
    leave_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO leave_requests "
            "  (id, user_id, leave_type, start_date, end_date, days, reason, "
            "   status, hr_approver_id, decided_at) "
            "VALUES (:id, :uid, :lt, :d, :d, 1, :reason, 'approved', :approver, :decided)"
        ),
        {
            "id": leave_id, "uid": body.user_id, "lt": body.leave_type,
            "d": body.work_date, "reason": body.reason,
            "approver": user.id, "decided": now_iso,
        },
    )

    # --- 3. Balance accounting for the year of the leave
    try:
        year = int(body.work_date[:4])
    except ValueError:
        year = _dt.date.today().year
    apply_balance_delta(
        db, user_id=body.user_id, leave_type=body.leave_type,
        days=1.0, year=year,
    )

    db.commit()

    # --- 4. Push the new attendance row to the employee's open sessions
    # (same channel HR's Resume work already uses). Their calendar +
    # Today card flip to the leave state without a manual refresh.
    fresh_log = _get(db, att_id)
    background.add_task(ws_router.attendance_changed, fresh_log)

    leave_row = row(db.execute(
        text("SELECT * FROM leave_requests WHERE id = :id"),
        {"id": leave_id},
    ).mappings().first())

    return {"attendance": fresh_log, "leave": leave_row}


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


IST = _dt.timezone(_dt.timedelta(hours=5, minutes=30))
# Grace windows — small + intentionally invisible in the UI. 20 minutes
# covers ~10 min of typical arrival slack + ~10 min for the app sign-in
# itself. No end-of-day grace: leaving even a minute before work_end
# needs an approved leave or a marked status (half_day / WFH /
# field_work). Tune these if behavior shifts; do not surface to users.
GRACE_LATE_MINUTES = 20
GRACE_EARLY_MINUTES = 0


def _effective_time(profile_val, company_val, default: _dt.time) -> _dt.time:
    """Per-user time override > company default > caller-supplied fallback."""
    if profile_val is not None:
        return profile_val if isinstance(profile_val, _dt.time) else _dt.time.fromisoformat(str(profile_val))
    if company_val is not None:
        return company_val if isinstance(company_val, _dt.time) else _dt.time.fromisoformat(str(company_val))
    return default


@router.get("/followup")
def followup(
    date: Optional[str] = Query(None, description="YYYY-MM-DD in IST. Defaults to today."),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Buckets the day's roster into actionable lists for HR / TA follow-up:

      * `need_followup` — people who should be here today AND haven't
        checked in past their grace window, OR checked out early
        without a half-day / WFH / approved leave excuse.
      * `present` — checked in (still in OR already checked out
        normally + on time).
      * `not_yet_arrived` — should be here but their work_start + grace
        window hasn't elapsed yet (too early to chase — shown as a
        small info count, not as actionable rows).
      * `on_leave` — approved leave covering this date.
      * `off_today` — schedule says today is off (weekend / Saturday-
        of-month pattern).

    Authz: caller in ATTENDANCE_FOLLOWUP_ROLES or per-user opt-in flag.
    """

    me = db.execute(
        text("SELECT attendance_followup_access FROM profiles WHERE id = :id"),
        {"id": user.id},
    ).mappings().first()
    if not can_view_attendance_followup(user.roles, dict(me) if me else None):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to see the attendance follow-up")

    try:
        target = _dt.date.fromisoformat(date) if date else _dt.datetime.now(IST).date()
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "date must be YYYY-MM-DD")

    iso_day = target.isoweekday()
    now_ist = _dt.datetime.now(IST)
    today_ist = now_ist.date()

    # For past dates, treat "now" as end-of-target-day so everyone is
    # past their work_start + grace (nobody is "not yet arrived").
    if target < today_ist:
        reference_now = _dt.datetime.combine(target, _dt.time(23, 59), IST)
    elif target > today_ist:
        # Future date — nothing has happened yet. Set reference to start
        # of that day so nobody is late.
        reference_now = _dt.datetime.combine(target, _dt.time(0, 0), IST)
    else:
        reference_now = now_ist

    profiles = db.execute(
        text(
            "SELECT id, full_name, email, designation, home_company_id, "
            "       reporting_manager_id, work_days, saturday_weeks_working, "
            "       work_start, work_end, phone "
            "FROM profiles WHERE is_active = true"
        )
    ).mappings().all()

    companies = db.execute(
        text(
            "SELECT id, work_days, saturday_weeks_working, work_start, work_end "
            "FROM companies"
        )
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
            "SELECT user_id, leave_type, days, start_date, end_date "
            "FROM leave_requests "
            "WHERE status = 'approved' AND start_date <= :d AND end_date >= :d"
        ),
        {"d": target.isoformat()},
    ).mappings().all()
    leave_by_user = {str(l["user_id"]): dict(l) for l in leave_today}

    need_followup: list[dict] = []
    present: list[dict] = []
    not_yet_arrived: list[dict] = []
    on_leave: list[dict] = []
    off_today: list[dict] = []

    for p in profiles:
        pid = str(p["id"])
        company = co_by_id.get(str(p.get("home_company_id"))) if p.get("home_company_id") else None
        work_days = _effective_work_days(dict(p), company)

        # Is today a working day for this person?
        is_work_day = iso_day in work_days
        if is_work_day and iso_day == 6 and not _saturday_working_today(target, dict(p), company):
            is_work_day = False

        row_data: dict = {
            "user_id": pid,
            "name": p.get("full_name"),
            "email": p.get("email"),
            "phone": p.get("phone"),
            "designation": p.get("designation"),
            "home_company_id": str(p["home_company_id"]) if p.get("home_company_id") else None,
            "reporting_manager_id": str(p["reporting_manager_id"]) if p.get("reporting_manager_id") else None,
        }

        if pid in leave_by_user:
            lv = leave_by_user[pid]
            row_data["leave_type"] = lv["leave_type"]
            on_leave.append(row_data)
            continue

        if not is_work_day:
            off_today.append(row_data)
            continue

        # Resolve their work-window for the target date in IST.
        work_start_t = _effective_time(p.get("work_start"), company.get("work_start") if company else None, _dt.time(9, 30))
        work_end_t = _effective_time(p.get("work_end"), company.get("work_end") if company else None, _dt.time(18, 30))
        work_start_dt = _dt.datetime.combine(target, work_start_t, IST)
        work_end_dt = _dt.datetime.combine(target, work_end_t, IST)
        late_cutoff = work_start_dt + _dt.timedelta(minutes=GRACE_LATE_MINUTES)
        early_cutoff = work_end_dt - _dt.timedelta(minutes=GRACE_EARLY_MINUTES)

        att = att_by_user.get(pid)
        if not att:
            # Hasn't checked in. Was the cutoff hit?
            if reference_now < late_cutoff:
                row_data["expected_by"] = late_cutoff.isoformat()
                not_yet_arrived.append(row_data)
            else:
                row_data["reason"] = "missed_check_in"
                row_data["expected_by"] = late_cutoff.isoformat()
                need_followup.append(row_data)
            continue

        ci = att.get("check_in_at")
        co = att.get("check_out_at")
        att_status = att.get("status")
        row_data["check_in_at"] = ci.isoformat() if ci else None
        row_data["check_in_status"] = att_status

        # Early checkout follow-up — only meaningful if they have a
        # check_out and it's before the early_cutoff. Excused if the
        # attendance status itself marks half-day / WFH, or if there's
        # an approved leave for today (the on_leave bucket already
        # caught full leaves; this guards against half-day leaves the
        # excuse path missed).
        if co:
            co_dt = co if co.tzinfo else co.replace(tzinfo=IST)
            row_data["check_out_at"] = co.isoformat() if co else None
            # Field work, WFH, and half-day all excuse an early checkout —
            # the employee marked their day with intent. Approved leaves
            # for the date already routed people into on_leave above.
            excused = att_status in {"half_day", "work_from_home", "field_work"}
            if co_dt < early_cutoff and not excused:
                minutes_early = int((early_cutoff - co_dt).total_seconds() // 60)
                row_data["reason"] = "left_early"
                row_data["minutes_early"] = minutes_early
                need_followup.append(row_data)
            else:
                present.append(row_data)
        else:
            present.append(row_data)

    return {
        "date": target.isoformat(),
        "iso_weekday": iso_day,
        "now": reference_now.isoformat(),
        "totals": {
            "need_followup": len(need_followup),
            "present": len(present),
            "not_yet_arrived": len(not_yet_arrived),
            "on_leave": len(on_leave),
            "off_today": len(off_today),
        },
        "need_followup": need_followup,
        "present": present,
        "not_yet_arrived": not_yet_arrived,
        "on_leave": on_leave,
        "off_today": off_today,
    }
