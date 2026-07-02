import datetime as _dt
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..authz import HR_ROLES, can_update_attendance, can_view_attendance_followup, has_any_role
from ..config import settings
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..notifications_email import notify_email
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
    # Geo capture from navigator.geolocation (Attendance.tsx). Optional —
    # browser denial or 5s timeout sends geo_denied=true with no coords.
    # WFH / field_work skip geo entirely on the client side.
    check_in_lat: Optional[float] = None
    check_in_lng: Optional[float] = None
    check_in_accuracy_m: Optional[int] = None
    geo_denied: bool = False


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in metres between two (lat, lng) points. Uses the standard
    haversine on the earth's mean radius (6,371,000 m)."""
    import math
    r = 6_371_000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.asin(min(1.0, math.sqrt(a)))
    return r * c


def _get(db: Session, log_id: str) -> dict:
    found = db.execute(text("SELECT * FROM attendance_logs WHERE id = :id"), {"id": log_id}).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendance log not found")
    return row(found)


# Statuses that count as "working today" for comp-off earning purposes.
# present + half_day + WFH + field_work all entitle the employee to a
# comp-off credit when worked on an off-day; leave / weekly_off /
# holiday / absent obviously don't.
COMP_OFF_EARNING_STATUSES = {"present", "half_day", "work_from_home", "field_work"}


def _is_off_day_for_user(db: Session, user_id: str, work_date: _dt.date) -> bool:
    """True iff ``work_date`` is normally a non-working day for ``user_id``
    (weekend, off-Saturday-of-month, or holiday on their home company).
    Used by the check-in path to decide whether to stamp a pending
    comp-off credit."""
    p = db.execute(
        text(
            "SELECT work_days, saturday_weeks_working, home_company_id "
            "FROM profiles WHERE id = :id"
        ),
        {"id": user_id},
    ).mappings().first()
    if not p:
        return False
    company = None
    if p.get("home_company_id"):
        c = db.execute(
            text(
                "SELECT work_days, saturday_weeks_working "
                "FROM companies WHERE id = :id"
            ),
            {"id": str(p["home_company_id"])},
        ).mappings().first()
        company = dict(c) if c else None
    work_days = _effective_work_days(dict(p), company)
    iso_day = work_date.isoweekday()
    if iso_day not in work_days:
        return True
    if iso_day == 6 and not _saturday_working_today(work_date, dict(p), company):
        return True
    # Holiday on the employee's company also counts as an off-day.
    if p.get("home_company_id"):
        h = db.execute(
            text(
                "SELECT 1 FROM holidays "
                "WHERE company_id = :co AND date = :d LIMIT 1"
            ),
            {"co": str(p["home_company_id"]), "d": work_date.isoformat()},
        ).first()
        if h is not None:
            return True
    return False


@router.post("", status_code=status.HTTP_201_CREATED)
def check_in(
    body: CheckIn,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_id = str(uuid.uuid4())

    # Off-day check-in -> stamp pending comp-off. HR approves/denies from
    # Team Attendance; balance only credits on approval. Half-day status
    # halves the earned amount.
    comp_earned: float | None = None
    comp_status: str | None = None
    if body.status in COMP_OFF_EARNING_STATUSES:
        try:
            work_date_obj = _dt.date.fromisoformat(body.work_date)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "work_date must be YYYY-MM-DD")
        if _is_off_day_for_user(db, user.id, work_date_obj):
            comp_earned = 0.5 if body.status == "half_day" else 1.0
            comp_status = "pending"

    # Geofence: WFH / field_work skip entirely. Otherwise, if the
    # employee has an office_id and the office has a (lat, lng), compute
    # haversine distance and flag if outside radius. Soft warn — the
    # check-in still saves regardless.
    geo_outside_office = False
    geo_warning: dict | None = None
    if (
        body.status not in {"work_from_home", "field_work"}
        and body.check_in_lat is not None
        and body.check_in_lng is not None
    ):
        office = db.execute(
            text(
                "SELECT o.id, o.name, o.latitude, o.longitude, o.radius_m "
                "FROM profiles p "
                "JOIN offices o ON o.id = p.office_id "
                "WHERE p.id = :uid AND o.is_active = true"
            ),
            {"uid": user.id},
        ).mappings().first()
        if office and office.get("latitude") is not None and office.get("longitude") is not None:
            distance_m = _haversine_m(
                float(body.check_in_lat), float(body.check_in_lng),
                float(office["latitude"]), float(office["longitude"]),
            )
            radius_m = int(office["radius_m"])
            if distance_m > radius_m:
                geo_outside_office = True
                geo_warning = {
                    "office_name": office["name"],
                    "distance_m": int(distance_m),
                    "radius_m": radius_m,
                }

    try:
        db.execute(
            text(
                "INSERT INTO attendance_logs "
                "  (id, user_id, work_date, check_in_at, status, source, "
                "   comp_off_earned, comp_off_status, "
                "   check_in_lat, check_in_lng, check_in_accuracy_m, "
                "   geo_denied, geo_outside_office) "
                "VALUES (:id, :uid, :work_date, :check_in_at, :status, :source, "
                "        :co_earned, CAST(:co_status AS public.comp_off_status), "
                "        :lat, :lng, :acc, :gd, :goo)"
            ),
            {
                "id": new_id, "uid": user.id, "work_date": body.work_date,
                "check_in_at": body.check_in_at, "status": body.status, "source": body.source,
                "co_earned": comp_earned, "co_status": comp_status,
                "lat": body.check_in_lat, "lng": body.check_in_lng,
                "acc": body.check_in_accuracy_m,
                "gd": bool(body.geo_denied), "goo": geo_outside_office,
            },
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Already checked in for this date")
    log_row = _get(db, new_id)
    if geo_warning:
        log_row["geo_warning"] = geo_warning

    # Off-day work triggers a pending comp-off — email HR so they can
    # approve/deny from Team Attendance -> Comp-off pending.
    if comp_status == "pending":
        hr_user_ids = [
            str(r[0]) for r in db.execute(
                text(
                    "SELECT DISTINCT ur.user_id FROM user_roles ur "
                    "JOIN profiles p ON p.id = ur.user_id "
                    "WHERE p.is_active = true AND ur.role::text = ANY(:roles)"
                ),
                {"roles": list(HR_ROLES)},
            ).all()
            if str(r[0]) != user.id
        ]
        if hr_user_ids:
            requester = db.execute(
                text("SELECT full_name FROM profiles WHERE id = :id"),
                {"id": user.id},
            ).mappings().first()
            req_name = (requester or {}).get("full_name") or "Someone"
            earned_str = f"{comp_earned:g} day" + ("s" if comp_earned != 1 else "")
            try:
                weekday = _dt.date.fromisoformat(body.work_date).strftime("%a")
            except ValueError:
                weekday = ""
            date_label = f"{weekday} {body.work_date}" if weekday else body.work_date
            email_subject = (
                f"Comp-off earned · {req_name} · {earned_str} · worked {date_label}"
            )
            email_body = (
                f"{req_name} worked on {date_label} (an off-day) and is "
                f"claiming a comp-off credit of {earned_str}.\n\n"
                f"Approve or deny: {settings.app_base_url}"
                f"/team-attendance?tab=comp_off"
            )
            notify_email(
                background, db,
                to_user_ids=hr_user_ids,
                subject=email_subject,
                body_text=email_body,
                reply_to_user_id=user.id,
                from_name_user_id=user.id,
            )
    return log_row


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


# -------------------- HR: approve / deny a pending comp-off --------------------

class CompOffDecision(BaseModel):
    decision: str  # 'approved' or 'denied'
    note: Optional[str] = None


@router.post("/{log_id}/decide-comp-off")
def decide_comp_off(
    log_id: str,
    body: CompOffDecision,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """HR approves or denies a pending comp-off credit.

    When an employee checks in on a non-working day (2nd/4th Saturday,
    Sunday, a company holiday), the check-in handler stamps
    ``comp_off_status='pending'`` and ``comp_off_earned`` (1.0 full /
    0.5 half). The balance is NOT credited at that point — HR has to
    review and approve from the Team Attendance review queue.

    On 'approved': flips status, stamps the decider + decision time,
    and calls ``apply_balance_delta(-earned, comp_off)`` — negative
    delta because available = opening + accrued + adjustment - used,
    so subtracting from ``used`` adds to ``available``.

    On 'denied': flips status + decider stamps; balance untouched.
    The row stays for audit ("we saw you, we said no").

    Idempotent: a row already approved/denied 409s — re-decide isn't
    a thing. To reverse, edit ``adjustment`` on the leave_balance row
    via PATCH /leave/balances/{id}.
    """
    if not has_any_role(user.roles, HR_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only HR / super_admin / founder can decide comp-off")
    if body.decision not in {"approved", "denied"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "decision must be 'approved' or 'denied'")

    log = _get(db, log_id)
    if log.get("comp_off_status") != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Comp-off is not pending (current state: {log.get('comp_off_status') or 'none'})",
        )

    earned = float(log.get("comp_off_earned") or 0)
    if earned <= 0 and body.decision == "approved":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Nothing to credit (comp_off_earned is 0)")

    # Stamp the decision first so the audit row exists even if the
    # balance call fails later.
    note_clause = ""
    params: dict = {"id": log_id, "by": user.id, "d": body.decision}
    if body.note:
        note_clause = ", notes = COALESCE(notes, '') || :n"
        params["n"] = f"\nComp-off {body.decision} by HR: {body.note}"
    db.execute(
        text(
            "UPDATE attendance_logs SET "
            "  comp_off_status = CAST(:d AS public.comp_off_status), "
            "  comp_off_decided_by = :by, "
            "  comp_off_decided_at = now()"
            + note_clause
            + " WHERE id = :id"
        ),
        params,
    )

    if body.decision == "approved":
        # Negative `used` delta = adds to available comp-off balance.
        # Year derived from the work_date so credits land in the same
        # accounting year the work happened in (matters at year-end).
        year = _dt.date.fromisoformat(str(log["work_date"])).year
        apply_balance_delta(db, log["user_id"], "comp_off", -earned, year)

    db.commit()
    fresh = _get(db, log_id)
    # Push the change so the employee's attendance page reflects the
    # new comp_off_status without a refresh.
    background.add_task(ws_router.attendance_changed, fresh)

    # Email the applicant with the verdict. Reply-To = the deciding HR
    # user so a Reply in Gmail lands with them.
    applicant_id = str(log["user_id"])
    if applicant_id != user.id:
        earned_str = f"{earned:g} day" + ("s" if earned != 1 else "")
        try:
            weekday = _dt.date.fromisoformat(str(log["work_date"])).strftime("%a")
        except ValueError:
            weekday = ""
        date_label = f"{weekday} {log['work_date']}" if weekday else str(log["work_date"])
        verdict_label = "approved" if body.decision == "approved" else "denied"
        email_subject = (
            f"Comp-off {verdict_label} · {earned_str} · worked {date_label}"
        )
        note = f"\n\nNote: {body.note}" if body.note else ""
        if body.decision == "approved":
            body_line = (
                f"Your comp-off credit of {earned_str} for {date_label} "
                f"has been approved and added to your balance."
            )
        else:
            body_line = (
                f"Your comp-off request for {date_label} was denied."
            )
        email_body = (
            f"{body_line}{note}\n\n"
            f"See your leave balances: {settings.app_base_url}/leave"
        )
        notify_email(
            background, db,
            to_user_ids=[applicant_id],
            subject=email_subject,
            body_text=email_body,
            reply_to_user_id=user.id,
            from_name_user_id=user.id,
        )
    return fresh


# -------------------- HR: mark a missed check-in as approved leave --------------------

class MarkLeaveBody(BaseModel):
    user_id: str
    work_date: str             # YYYY-MM-DD
    leave_type: str            # one of MARK_LEAVE_TYPES
    reason: Optional[str] = None
    # Only used when the UI sends a comp-off advance. Ignored for other
    # leave types. Planned date the employee will work an off-day to
    # repay the advance; scheduler nags HR after this date if balance
    # is still negative.
    comp_off_repay_by: Optional[str] = None
    # When true, any existing attendance_log + approved leave_request for
    # this (user, date) is reverted (balance refunded) before inserting
    # the new pair. Used by the "Overwrite" confirm in the UI when HR
    # picks the wrong leave type the first time. Without this, the
    # second call 409s.
    overwrite: bool = False


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

    # --- 0. Overwrite path — revert the existing (attendance + leave +
    # balance) so the day is cleanly re-stampable. Only fires when the
    # caller explicitly opts in (frontend confirms after a first-call
    # 409). We refund the balance for any approved leave we're about to
    # delete so quotas don't end up double-charged.
    if body.overwrite:
        existing_leaves = db.execute(
            text(
                "SELECT id, leave_type, days, status "
                "FROM leave_requests "
                "WHERE user_id = :uid AND start_date = :d AND end_date = :d"
            ),
            {"uid": body.user_id, "d": body.work_date},
        ).mappings().all()
        for lr in existing_leaves:
            if lr["status"] == "approved":
                # Refund the prior balance hit. apply_balance_delta is a
                # no-op for unbalanced types (loss_of_pay etc.), so this
                # is safe to call unconditionally.
                try:
                    refund_year = int(body.work_date[:4])
                except ValueError:
                    refund_year = _dt.date.today().year
                apply_balance_delta(
                    db, user_id=body.user_id, leave_type=lr["leave_type"],
                    days=-float(lr["days"]), year=refund_year,
                )
            db.execute(
                text("DELETE FROM leave_requests WHERE id = :id"),
                {"id": str(lr["id"])},
            )
        db.execute(
            text(
                "DELETE FROM attendance_logs "
                "WHERE user_id = :uid AND work_date = :d"
            ),
            {"uid": body.user_id, "d": body.work_date},
        )

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
            "An attendance log already exists for this date — overwrite to replace it.",
        )

    # --- 2. Insert the approved leave request
    leave_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO leave_requests "
            "  (id, user_id, leave_type, start_date, end_date, days, reason, "
            "   status, hr_approver_id, decided_at, comp_off_repay_by) "
            "VALUES (:id, :uid, :lt, :d, :d, 1, :reason, 'approved', :approver, :decided, :repay)"
        ),
        {
            "id": leave_id, "uid": body.user_id, "lt": body.leave_type,
            "d": body.work_date, "reason": body.reason,
            "approver": user.id, "decided": now_iso,
            # Only meaningful for comp_off; we still pass NULL for the rest
            # so the column is never half-stamped on the wrong type.
            "repay": body.comp_off_repay_by if body.leave_type == "comp_off" else None,
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
            "SELECT user_id, check_in_at, check_out_at, status, source, "
            "       geo_outside_office, geo_denied, idle_minutes "
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

        att = att_by_user.get(pid)

        # Off-day work — they chose to come in on a normally-off day.
        # Always bucket as present (no late / early-leave follow-up;
        # they're voluntarily working, the late_cutoff doesn't apply).
        # The Comp-off pending tab sees their earned credit separately
        # via the local dataStore.
        if not is_work_day:
            if att:
                ci = att.get("check_in_at")
                co = att.get("check_out_at")
                row_data["check_in_at"] = ci.isoformat() if ci else None
                row_data["check_in_status"] = att.get("status")
                row_data["check_out_at"] = co.isoformat() if co else None
                row_data["geo_outside_office"] = bool(att.get("geo_outside_office"))
                row_data["idle_minutes"] = int(att.get("idle_minutes") or 0)
                present.append(row_data)
            else:
                off_today.append(row_data)
            continue

        # Resolve their work-window for the target date in IST.
        work_start_t = _effective_time(p.get("work_start"), company.get("work_start") if company else None, _dt.time(9, 30))
        work_end_t = _effective_time(p.get("work_end"), company.get("work_end") if company else None, _dt.time(18, 30))
        work_start_dt = _dt.datetime.combine(target, work_start_t, IST)
        work_end_dt = _dt.datetime.combine(target, work_end_t, IST)
        late_cutoff = work_start_dt + _dt.timedelta(minutes=GRACE_LATE_MINUTES)
        early_cutoff = work_end_dt - _dt.timedelta(minutes=GRACE_EARLY_MINUTES)

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
        row_data["geo_outside_office"] = bool(att.get("geo_outside_office"))
        row_data["idle_minutes"] = int(att.get("idle_minutes") or 0)

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


# -------------------- Idle intervals --------------------

class IdleInterval(BaseModel):
    started_at: str   # ISO 8601
    ended_at: str     # ISO 8601
    source: str       # 'idle' | 'hidden'


@router.post("/idle-intervals", status_code=status.HTTP_201_CREATED)
def record_idle_interval(
    body: IdleInterval,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Client pushes a confirmed idle interval (≥30 min of no input, or
    a `visibilitychange` hidden→visible flip with elapsed time). Two
    side-effects, atomic:

    * INSERT into idle_intervals (deduped by UNIQUE(user_id, started_at)
      so retries don't double-count)
    * BUMP attendance_logs.idle_minutes for the (user, work_date) row

    Returns {"recorded": true, "minutes": N} or {"recorded": false}
    when this is a duplicate POST.

    No-op if the user hasn't checked in for this date — idle before
    check-in doesn't make sense to track (lunchtime walkup, off-day
    browsing, etc.).
    """
    if body.source not in {"idle", "hidden"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "source must be 'idle' or 'hidden'")
    try:
        started = _dt.datetime.fromisoformat(body.started_at.replace("Z", "+00:00"))
        ended = _dt.datetime.fromisoformat(body.ended_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "started_at and ended_at must be ISO 8601")
    if ended <= started:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "ended_at must be after started_at")
    minutes = int((ended - started).total_seconds() // 60)
    if minutes <= 0:
        return {"recorded": False, "reason": "zero_minutes"}
    if minutes > 24 * 60:
        # Sanity guard — a single idle interval longer than a day is a
        # client bug. Clip rather than reject so the rest of the day's
        # idle still records.
        minutes = 24 * 60

    # Work date in IST. We use the started_at calendar day so a 30-min
    # idle that spans midnight gets attributed to the day it started.
    started_ist = started.astimezone(IST) if started.tzinfo else started.replace(tzinfo=IST)
    work_date = started_ist.date()

    # Skip if no attendance log exists for that day — no point bumping
    # idle_minutes on a row the rollup won't read.
    log = db.execute(
        text(
            "SELECT id FROM attendance_logs "
            "WHERE user_id = :u AND work_date = :d"
        ),
        {"u": user.id, "d": work_date.isoformat()},
    ).first()
    if not log:
        return {"recorded": False, "reason": "no_checkin"}

    # Idempotent insert. ON CONFLICT (user_id, started_at) DO NOTHING +
    # check RETURNING to know if the row was actually new.
    inserted = db.execute(
        text(
            "INSERT INTO idle_intervals "
            "  (user_id, work_date, started_at, ended_at, minutes, source) "
            "VALUES (:u, :d, :s, :e, :m, :src) "
            "ON CONFLICT (user_id, started_at) DO NOTHING "
            "RETURNING id"
        ),
        {
            "u": user.id, "d": work_date.isoformat(),
            "s": started, "e": ended, "m": minutes, "src": body.source,
        },
    ).first()
    if inserted is None:
        db.rollback()
        return {"recorded": False, "reason": "duplicate", "minutes": minutes}

    db.execute(
        text(
            "UPDATE attendance_logs "
            "SET idle_minutes = idle_minutes + :m "
            "WHERE user_id = :u AND work_date = :d"
        ),
        {"m": minutes, "u": user.id, "d": work_date.isoformat()},
    )
    db.commit()
    return {"recorded": True, "minutes": minutes}
