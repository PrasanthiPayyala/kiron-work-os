"""Attendance permissions — hour-scale signed-off shortfalls.

Lets employees record "I'll be 2 hours late tomorrow" or "I need to
leave 30 minutes early today", and HR/manager approve. Approved
permissions reduce the expected-hours number in the monthly rollup
so a permitted late doesn't show up as a deficit.

Endpoints
---------
POST   /attendance-permissions                 file (employee or HR)
PATCH  /attendance-permissions/{id}            decide (HR/super_admin/founder)
DELETE /attendance-permissions/{id}            cancel own pending request
GET    /attendance-permissions                 list — own by default;
                                               ?user_id= or ?status= or
                                               ?from=&to= for HR / managers
GET    /attendance-permissions/hours-summary   per-employee monthly
                                               hours rollup with permissions
                                               factored into expected total

The hours-summary endpoint joins attendance_logs (actual worked
hours), leave_requests (full-day adjustments), and
attendance_permissions (hour-scale adjustments) against each
employee's effective schedule + the company holiday calendar.

Conventions match the rest of the backend: SQLAlchemy text() queries,
authz checks before any write, and BackgroundTasks for the WebSocket
fan-out so the response isn't blocked.
"""
from __future__ import annotations

import datetime as _dt
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import HR_ROLES, has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row
from . import ws as ws_router

router = APIRouter(prefix="/attendance-permissions", tags=["attendance"])

ALLOWED_KINDS = {"late_in", "early_out", "mid_out"}
ALLOWED_DECISIONS = {"approved", "rejected"}

IST = _dt.timezone(_dt.timedelta(hours=5, minutes=30))


# ---------- Models ----------

class PermissionCreate(BaseModel):
    date: str                          # YYYY-MM-DD
    kind: str                          # one of ALLOWED_KINDS
    minutes: int = Field(..., gt=0, le=720)
    reason: Optional[str] = None
    # HR can create on behalf of someone else and pre-approve in one go.
    # Ignored for non-HR callers (they always get user_id = self, status =
    # pending).
    user_id: Optional[str] = None
    pre_approve: bool = False


class PermissionDecide(BaseModel):
    decision: str                      # 'approved' | 'rejected'
    note: Optional[str] = None


# ---------- Helpers ----------

def _get(db: Session, perm_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM attendance_permissions WHERE id = :id"),
        {"id": perm_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Permission not found")
    return row(found)


def _is_hr(roles: set[str]) -> bool:
    return has_any_role(roles, HR_ROLES)


# ---------- Create ----------

@router.post("", status_code=status.HTTP_201_CREATED)
def create_permission(
    body: PermissionCreate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Either an employee filing for themselves (status='pending') or HR
    creating + pre-approving on behalf of someone else.

    Validation:
    - kind must be in ALLOWED_KINDS
    - minutes 1..720 (Pydantic guards this)
    - if user_id is provided and != caller, caller must be HR_ROLES
    - if pre_approve is True, caller must be HR_ROLES
    """
    if body.kind not in ALLOWED_KINDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"kind must be one of {sorted(ALLOWED_KINDS)}",
        )
    target_uid = body.user_id or user.id
    if target_uid != user.id and not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / super_admin / founder can file a permission for someone else",
        )
    if body.pre_approve and not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / super_admin / founder can pre-approve a permission",
        )

    # Confirm the target user exists. Cheap sanity check that gives a
    # cleaner error than a FK violation.
    target = db.execute(
        text("SELECT id FROM profiles WHERE id = :id"),
        {"id": target_uid},
    ).mappings().first()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    pid = str(uuid.uuid4())
    init_status = "approved" if body.pre_approve else "pending"
    decided_by = user.id if body.pre_approve else None
    decided_at = _dt.datetime.now(_dt.timezone.utc) if body.pre_approve else None

    db.execute(
        text(
            "INSERT INTO attendance_permissions "
            "  (id, user_id, date, kind, minutes, reason, status, "
            "   requested_by, decided_by, decided_at) "
            "VALUES (:id, :uid, :d, CAST(:k AS public.attendance_permission_kind), "
            "        :m, :r, CAST(:s AS public.attendance_permission_status), "
            "        :req, :dec_by, :dec_at)"
        ),
        {
            "id": pid, "uid": target_uid, "d": body.date, "k": body.kind,
            "m": body.minutes, "r": body.reason, "s": init_status,
            "req": user.id, "dec_by": decided_by, "dec_at": decided_at,
        },
    )
    db.commit()
    fresh = _get(db, pid)

    # Broadcast — the affected employee's tab refreshes their own list
    # via the existing notification.new path. For a pending request,
    # also notify HR users so the bell pings them.
    if init_status == "pending":
        hr_user_ids = [
            str(r[0]) for r in db.execute(
                text(
                    "SELECT DISTINCT ur.user_id FROM user_roles ur "
                    "JOIN profiles p ON p.id = ur.user_id "
                    "WHERE p.is_active = true AND ur.role::text = ANY(:roles)"
                ),
                {"roles": list(HR_ROLES)},
            ).all()
        ]
        # Pull the requester's name for a friendly title.
        requester = db.execute(
            text("SELECT full_name FROM profiles WHERE id = :id"),
            {"id": user.id},
        ).mappings().first()
        req_name = requester["full_name"] if requester else "Someone"
        kind_label = {
            "late_in": "late arrival", "early_out": "early leave",
            "mid_out": "mid-day step-out",
        }.get(body.kind, body.kind)
        hours_part = (
            f"{body.minutes // 60}h{body.minutes % 60}m"
            if body.minutes >= 60 else f"{body.minutes}m"
        )
        now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
        for hr_uid in hr_user_ids:
            if hr_uid == user.id:
                continue  # don't ping HR about their own request
            nid = str(uuid.uuid4())
            db.execute(
                text(
                    "INSERT INTO notifications "
                    "  (id, user_id, notification_type, title, body, link) "
                    "VALUES (:id, :u, 'pending_approval', :t, :b, :l)"
                ),
                {
                    "id": nid, "u": hr_uid,
                    "t": f"{req_name}: {hours_part} {kind_label}",
                    "b": (body.reason[:140] if body.reason else
                          f"Requested for {body.date}. Tap to review."),
                    "l": f"/attendance?permission={pid}",
                },
            )
            background.add_task(ws_router.notification_new, {
                "id": nid, "user_id": hr_uid,
                "notification_type": "pending_approval",
                "title": f"{req_name}: {hours_part} {kind_label}",
                "body": (body.reason[:140] if body.reason else
                         f"Requested for {body.date}. Tap to review."),
                "link": f"/attendance?permission={pid}",
                "is_read": False, "created_at": now_iso,
            })
        db.commit()
    return fresh


# ---------- Decide (HR) ----------

@router.patch("/{perm_id}")
def decide_permission(
    perm_id: str,
    body: PermissionDecide,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """HR approves or rejects a pending request. Idempotent on re-decide
    — flipping approved↔rejected is allowed (HR may correct a misclick),
    but pending↔pending is a no-op."""
    if body.decision not in ALLOWED_DECISIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"decision must be one of {sorted(ALLOWED_DECISIONS)}",
        )
    if not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / super_admin / founder can decide a permission",
        )
    existing = _get(db, perm_id)

    db.execute(
        text(
            "UPDATE attendance_permissions SET "
            "  status = CAST(:s AS public.attendance_permission_status), "
            "  decided_by = :dec_by, decided_at = now(), "
            "  decision_note = :note "
            "WHERE id = :id"
        ),
        {"s": body.decision, "dec_by": user.id, "note": body.note, "id": perm_id},
    )
    db.commit()
    fresh = _get(db, perm_id)

    # Tell the requester their permission flipped state.
    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    nid = str(uuid.uuid4())
    title = (
        "Permission approved" if body.decision == "approved"
        else "Permission rejected"
    )
    db.execute(
        text(
            "INSERT INTO notifications "
            "  (id, user_id, notification_type, title, body, link) "
            "VALUES (:id, :u, 'general', :t, :b, :l)"
        ),
        {
            "id": nid, "u": str(existing["user_id"]),
            "t": title,
            "b": f"Your {existing['minutes']}m {existing['kind']} on "
                 f"{existing['date']} was {body.decision}.",
            "l": f"/attendance?permission={perm_id}",
        },
    )
    db.commit()
    background.add_task(ws_router.notification_new, {
        "id": nid, "user_id": str(existing["user_id"]),
        "notification_type": "general", "title": title,
        "body": f"Your {existing['minutes']}m {existing['kind']} on "
                f"{existing['date']} was {body.decision}.",
        "link": f"/attendance?permission={perm_id}",
        "is_read": False, "created_at": now_iso,
    })
    return fresh


# ---------- Cancel own pending request ----------

@router.delete("/{perm_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_permission(
    perm_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Requester can withdraw a still-pending request. HR can delete any."""
    existing = _get(db, perm_id)
    if str(existing["user_id"]) != user.id and not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the requester or HR can cancel this permission",
        )
    if existing["status"] != "pending" and not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Already decided — only HR can delete a decided permission",
        )
    db.execute(
        text("DELETE FROM attendance_permissions WHERE id = :id"), {"id": perm_id},
    )
    db.commit()
    return None


# ---------- List ----------

@router.get("")
def list_permissions(
    user_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List permissions. Defaults to own; HR may pass user_id / leave
    blank for all. status / from / to are optional filters."""
    target_uid = user_id or user.id
    if target_uid != user.id and not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Can only view your own permissions",
        )
    # HR passing user_id=None (no filter) -> show everyone
    where_parts: list[str] = []
    params: dict = {}
    if user_id is not None or not _is_hr(user.roles):
        where_parts.append("user_id = :uid")
        params["uid"] = target_uid
    if status_filter:
        where_parts.append(
            "status = CAST(:status AS public.attendance_permission_status)"
        )
        params["status"] = status_filter
    if from_date:
        where_parts.append("date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        where_parts.append("date <= :to_date")
        params["to_date"] = to_date
    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    rows = db.execute(
        text(
            f"SELECT * FROM attendance_permissions {where_sql} "
            "ORDER BY date DESC, created_at DESC LIMIT 500"
        ),
        params,
    ).mappings().all()
    return [row(r) for r in rows]


# ---------- Hours summary (per-user monthly rollup) ----------

@router.get("/hours-summary")
def hours_summary(
    user_id: Optional[str] = Query(None),
    month: Optional[str] = Query(None, description="YYYY-MM, defaults to current IST month"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-employee monthly hours rollup.

    Returns:
      {
        user_id, month, days_in_period,
        expected_hours, actual_hours,
        full_leave_hours,        # subtracted from expected
        half_day_count,          # half-day adjustment
        permission_minutes,      # approved late/early/mid-out — subtracts from expected
        net_shortfall_hours,     # max(0, expected - permission - actual - full_leave)
        net_surplus_hours,       # max(0, actual - (expected - permission - full_leave))
      }
    """
    target_uid = user_id or user.id
    if target_uid != user.id and not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Can only view your own summary",
        )

    # Resolve month range in IST.
    now_ist = _dt.datetime.now(IST)
    if month:
        try:
            year, mon = month.split("-")
            year, mon = int(year), int(mon)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "month must be YYYY-MM",
            )
    else:
        year, mon = now_ist.year, now_ist.month
    start_date = _dt.date(year, mon, 1)
    # First of next month, then -1 day = last of this month
    if mon == 12:
        end_date = _dt.date(year + 1, 1, 1) - _dt.timedelta(days=1)
    else:
        end_date = _dt.date(year, mon + 1, 1) - _dt.timedelta(days=1)
    # Cap to today for the current month — don't count days that haven't
    # happened yet as deficits.
    today_ist = now_ist.date()
    if end_date > today_ist:
        end_date = today_ist

    # Profile + effective schedule
    prof = db.execute(
        text(
            "SELECT id, full_name, home_company_id, "
            "       work_days, work_start, work_end, saturday_weeks_working "
            "FROM profiles WHERE id = :id"
        ),
        {"id": target_uid},
    ).mappings().first()
    if not prof:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    company = None
    if prof.get("home_company_id"):
        company = db.execute(
            text(
                "SELECT work_days, work_start, work_end, saturday_weeks_working "
                "FROM companies WHERE id = :id"
            ),
            {"id": str(prof["home_company_id"])},
        ).mappings().first()

    # Resolve effective schedule fields.
    work_days = list(prof.get("work_days") or
                     (company.get("work_days") if company else None) or
                     [1, 2, 3, 4, 5, 6])
    sat_pattern = list(prof.get("saturday_weeks_working") or
                       (company.get("saturday_weeks_working") if company else None) or
                       [])
    def _to_time(v, fallback):
        if v is None:
            return fallback
        if isinstance(v, _dt.time):
            return v
        return _dt.time.fromisoformat(str(v))
    work_start = _to_time(prof.get("work_start"),
                          _to_time(company.get("work_start") if company else None,
                                   _dt.time(9, 30)))
    work_end = _to_time(prof.get("work_end"),
                        _to_time(company.get("work_end") if company else None,
                                 _dt.time(18, 30)))
    per_day_minutes = (
        _dt.datetime.combine(_dt.date.today(), work_end)
        - _dt.datetime.combine(_dt.date.today(), work_start)
    ).total_seconds() / 60

    # Holidays applicable to this employee — company-specific OR global.
    co_id = str(prof["home_company_id"]) if prof.get("home_company_id") else None
    holidays = {
        r["date"] for r in db.execute(
            text(
                "SELECT date FROM holidays "
                "WHERE date BETWEEN :s AND :e AND "
                "      (company_id IS NULL OR company_id = :co)"
            ),
            {"s": start_date, "e": end_date, "co": co_id},
        ).mappings().all()
    }

    # Count expected working days in period.
    expected_minutes = 0
    days_in_period = 0
    cur = start_date
    while cur <= end_date:
        days_in_period += 1
        iso = cur.isoweekday()
        is_working = iso in work_days
        if is_working and iso == 6 and sat_pattern:
            week_of_month = ((cur.day - 1) // 7) + 1
            if week_of_month not in sat_pattern:
                is_working = False
        if is_working and cur in holidays:
            is_working = False
        if is_working:
            expected_minutes += per_day_minutes
        cur += _dt.timedelta(days=1)

    # Actual worked hours (sum) — count only logs in period.
    actual_row = db.execute(
        text(
            "SELECT COALESCE(SUM(worked_hours), 0) AS h, "
            "       COUNT(*) FILTER (WHERE status = 'half_day') AS half, "
            "       COALESCE(SUM(idle_minutes), 0) AS idle "
            "FROM attendance_logs "
            "WHERE user_id = :u AND work_date BETWEEN :s AND :e"
        ),
        {"u": target_uid, "s": start_date, "e": end_date},
    ).mappings().first()
    raw_actual_hours = float(actual_row["h"] or 0)
    half_day_count = int(actual_row["half"] or 0)
    idle_minutes_total = int(actual_row["idle"] or 0)
    # Active hours = stamped hours minus idle gaps. Floor at 0 in case
    # idle exceeds stamped (shouldn't happen but defensive).
    actual_hours = max(0.0, raw_actual_hours - idle_minutes_total / 60)

    # Full-day approved leaves in period (each day with an approved leave
    # subtracts per_day_minutes from expected).
    # Iterate each day in range and check if covered by an approved leave.
    full_leave_minutes = 0.0
    leave_rows = db.execute(
        text(
            "SELECT leave_type, start_date, end_date FROM leave_requests "
            "WHERE user_id = :u AND status = 'approved' "
            "  AND start_date <= :e AND end_date >= :s"
        ),
        {"u": target_uid, "s": start_date, "e": end_date},
    ).mappings().all()
    leave_days = set()
    for lr in leave_rows:
        d = max(lr["start_date"], start_date)
        last = min(lr["end_date"], end_date)
        while d <= last:
            leave_days.add(d)
            d += _dt.timedelta(days=1)
    full_leave_minutes = len(leave_days) * per_day_minutes

    # Approved permissions in period — sum minutes.
    perm_row = db.execute(
        text(
            "SELECT COALESCE(SUM(minutes), 0) AS m "
            "FROM attendance_permissions "
            "WHERE user_id = :u AND status = 'approved' "
            "  AND date BETWEEN :s AND :e"
        ),
        {"u": target_uid, "s": start_date, "e": end_date},
    ).mappings().first()
    permission_minutes = int(perm_row["m"] or 0)

    # Half-day adjustment: a half-day status means expected for that day
    # is per_day / 2 instead of per_day. We can't easily know which day
    # without another query, so approximate: subtract per_day/2 per half_day.
    half_day_adjust_minutes = half_day_count * (per_day_minutes / 2)

    # Net expected after every excuse.
    net_expected_minutes = max(
        0,
        expected_minutes - full_leave_minutes - permission_minutes - half_day_adjust_minutes,
    )

    actual_minutes = actual_hours * 60
    net_shortfall_minutes = max(0, net_expected_minutes - actual_minutes)
    net_surplus_minutes = max(0, actual_minutes - net_expected_minutes)

    return {
        "user_id": target_uid,
        "name": prof.get("full_name"),
        "month": f"{year:04d}-{mon:02d}",
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "days_in_period": days_in_period,
        "expected_hours": round(expected_minutes / 60, 2),
        "actual_hours": round(actual_hours, 2),
        "raw_actual_hours": round(raw_actual_hours, 2),
        "idle_minutes": idle_minutes_total,
        "full_leave_hours": round(full_leave_minutes / 60, 2),
        "half_day_count": half_day_count,
        "permission_minutes": permission_minutes,
        "net_expected_hours": round(net_expected_minutes / 60, 2),
        "net_shortfall_hours": round(net_shortfall_minutes / 60, 2),
        "net_surplus_hours": round(net_surplus_minutes / 60, 2),
    }


# ---------- Roster-wide hours summary (HR) ----------

@router.get("/hours-summary/roster")
def hours_summary_roster(
    month: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All active employees' monthly hours rollup, for the HR table. HR-only.

    Implemented as N calls to hours_summary(user_id=...) — the per-user
    computation is cheap (a handful of indexed queries) and 30 employees
    finish in well under a second. If the org ever crosses ~200 we can
    flatten into a single CTE.
    """
    if not _is_hr(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / super_admin / founder can see the roster summary",
        )
    profiles = db.execute(
        text(
            "SELECT id FROM profiles WHERE is_active = true "
            "ORDER BY full_name ASC"
        ),
    ).mappings().all()
    out: list[dict] = []
    for p in profiles:
        try:
            out.append(hours_summary(user_id=str(p["id"]), month=month,
                                     user=user, db=db))
        except HTTPException:
            continue
    return out
