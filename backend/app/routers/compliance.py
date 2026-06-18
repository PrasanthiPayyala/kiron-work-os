"""Compliance reminders router.

Endpoints:
- GET    /compliance/obligations               list templates
- POST   /compliance/obligations               create
- PATCH  /compliance/obligations/{id}          edit
- DELETE /compliance/obligations/{id}          delete (manage)
- GET    /compliance/occurrences               list (filtered)
- POST   /compliance/occurrences/{id}/file     mark as filed
- POST   /compliance/occurrences/{id}/skip     mark as skipped
- POST   /compliance/occurrences/{id}/reopen   revert to pending
- DELETE /compliance/occurrences/{id}          delete
- POST   /compliance/generate                  generate occurrences
                                                for next 120 days
                                                (idempotent — also
                                                called by the daily
                                                scheduler)

Manage roles: super_admin, founder, founder_office_coordinator,
founder_office_support, hr_admin. Same set as Vendors / Assets.
"""
import calendar
import datetime as dt
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/compliance", tags=["compliance"])

COMPLIANCE_MANAGE_ROLES = {
    "super_admin", "founder",
    "founder_office_coordinator", "founder_office_support",
    "hr_admin",
}
ALLOWED_CADENCES = {"monthly", "quarterly", "half_yearly", "yearly"}
ALLOWED_STATUSES = {"pending", "filed", "skipped"}


class ObligationCreate(BaseModel):
    company_id: str
    kind: str = Field(..., min_length=1, max_length=60)
    name: str = Field(..., min_length=1, max_length=200)
    cadence: str = "monthly"
    due_day: int = Field(20, ge=1, le=31)
    due_month_offset: int = Field(1, ge=0, le=12)
    assigned_to_user_id: Optional[str] = None
    assigned_contact_id: Optional[str] = None
    reminder_days_before: int = Field(7, ge=0, le=60)
    notes: Optional[str] = None


class ObligationUpdate(BaseModel):
    kind: Optional[str] = Field(None, min_length=1, max_length=60)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    cadence: Optional[str] = None
    due_day: Optional[int] = Field(None, ge=1, le=31)
    due_month_offset: Optional[int] = Field(None, ge=0, le=12)
    assigned_to_user_id: Optional[str] = None
    assigned_contact_id: Optional[str] = None
    reminder_days_before: Optional[int] = Field(None, ge=0, le=60)
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class OccurrenceFile(BaseModel):
    reference: Optional[str] = None
    amount: Optional[float] = None
    notes: Optional[str] = None


def _require_manage(user: CurrentUser) -> None:
    if not has_any_role(user.roles, COMPLIANCE_MANAGE_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only HR / founder's office / super_admin")


def _get_obligation(db: Session, oid: str) -> dict:
    r = db.execute(text("SELECT * FROM compliance_obligations WHERE id = :id"), {"id": oid}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Obligation not found")
    return row(r)


def _get_occurrence(db: Session, oid: str) -> dict:
    r = db.execute(text("SELECT * FROM compliance_occurrences WHERE id = :id"), {"id": oid}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Occurrence not found")
    return row(r)


def _safe_day(year: int, month: int, day: int) -> dt.date:
    """Clamp ``day`` to the last valid day of (year, month). e.g.
    feb 30 → feb 28/29. Required because some obligations have
    due_day = 31 but plenty of months end before that."""
    last = calendar.monthrange(year, month)[1]
    return dt.date(year, month, min(day, last))


def _shift_months(d: dt.date, months: int) -> dt.date:
    """Return d shifted by ``months`` calendar months (clamped to the
    last valid day of the resulting month). Days carried verbatim."""
    total = d.year * 12 + (d.month - 1) + months
    year, month = divmod(total, 12)
    return _safe_day(year, month + 1, d.day)


def _period_for(cadence: str, ref: dt.date) -> tuple[dt.date, dt.date, str]:
    """Given a cadence + a date inside the period, return
    (period_start, period_end, period_label).

    - monthly:     1st → last day of that month.    Label "Jun 2026".
    - quarterly:   start = first month of the quarter [1,4,7,10].
                   label "Q3 2026" (Apr-Jun).
    - half_yearly: start = first month of H1 / H2 (Jan or Jul).
                   label "H1 2026" / "H2 2026".
    - yearly:      start = Apr 1 of FY (Indian fiscal year).
                   label "FY 2026-27".
    """
    y, m = ref.year, ref.month
    if cadence == "monthly":
        start = dt.date(y, m, 1)
        end = dt.date(y, m, calendar.monthrange(y, m)[1])
        return start, end, start.strftime("%b %Y")
    if cadence == "quarterly":
        q = (m - 1) // 3
        q_start_month = q * 3 + 1
        start = dt.date(y, q_start_month, 1)
        end_month = q_start_month + 2
        end = dt.date(y, end_month, calendar.monthrange(y, end_month)[1])
        return start, end, f"Q{q + 1} {y}"
    if cadence == "half_yearly":
        h = (m - 1) // 6  # 0 = Jan-Jun (H1), 1 = Jul-Dec (H2)
        start = dt.date(y, h * 6 + 1, 1)
        end_month = h * 6 + 6
        end = dt.date(y, end_month, calendar.monthrange(y, end_month)[1])
        return start, end, f"H{h + 1} {y}"
    if cadence == "yearly":
        # Indian fiscal year: Apr 1 to Mar 31. A date in Jan-Mar
        # belongs to the FY that started the previous calendar year.
        if m < 4:
            fy_start_year = y - 1
        else:
            fy_start_year = y
        start = dt.date(fy_start_year, 4, 1)
        end = dt.date(fy_start_year + 1, 3, 31)
        return start, end, f"FY {fy_start_year}-{(fy_start_year + 1) % 100:02d}"
    raise ValueError(f"Unknown cadence: {cadence}")


def _next_period_start(cadence: str, after: dt.date) -> dt.date:
    """Get the first day of the period strictly after the period that
    contains ``after``."""
    start, _, _ = _period_for(cadence, after)
    if cadence == "monthly":
        return _shift_months(start, 1)
    if cadence == "quarterly":
        return _shift_months(start, 3)
    if cadence == "half_yearly":
        return _shift_months(start, 6)
    if cadence == "yearly":
        return dt.date(start.year + 1, 4, 1)
    raise ValueError(f"Unknown cadence: {cadence}")


def _generate_for_obligation(db: Session, ob: dict, until: dt.date) -> int:
    """Insert any missing occurrences for this obligation whose
    due_date is <= ``until``. Returns count of newly-inserted rows.
    Idempotent via the (obligation_id, due_date) UNIQUE constraint."""
    cadence = ob["cadence"]
    today = dt.date.today()
    # Start a period back so we also generate the current/upcoming one
    # if it isn't yet present. The unique index makes the retry safe.
    period_ref = _shift_months(today, -1)
    created = 0
    while True:
        start, end, label = _period_for(cadence, period_ref)
        due = _safe_day(end.year, end.month, ob["due_day"])
        due = _shift_months(due, ob["due_month_offset"])
        if due > until:
            break
        # Insert; ignore conflict.
        r = db.execute(
            text(
                "INSERT INTO compliance_occurrences "
                "  (obligation_id, period_label, period_start, period_end, due_date) "
                "VALUES (:o, :pl, :ps, :pe, :due) "
                "ON CONFLICT (obligation_id, due_date) DO NOTHING "
                "RETURNING id"
            ),
            {"o": ob["id"], "pl": label, "ps": start, "pe": end, "due": due},
        ).first()
        if r is not None:
            created += 1
        # Advance to the next period.
        period_ref = _next_period_start(cadence, period_ref)
        # Safety belt — never loop more than 200 periods (16 yrs monthly).
        if created > 200:
            break
    return created


# ---------- Obligations ----------


@router.get("/obligations")
def list_obligations(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    rows = db.execute(
        text(
            "SELECT * FROM compliance_obligations "
            "ORDER BY company_id, kind"
        )
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/obligations", status_code=status.HTTP_201_CREATED)
def create_obligation(
    body: ObligationCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    if body.cadence not in ALLOWED_CADENCES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"cadence must be one of {sorted(ALLOWED_CADENCES)}")
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO compliance_obligations ("
            "  id, company_id, kind, name, cadence, due_day, due_month_offset, "
            "  assigned_to_user_id, assigned_contact_id, reminder_days_before, "
            "  notes, created_by, updated_by"
            ") VALUES ("
            "  :id, :co, :kind, :name, :cad, :dd, :dmo, "
            "  :au, :ac, :rdb, :n, :u, :u"
            ")"
        ),
        {
            "id": new_id, "co": body.company_id, "kind": body.kind,
            "name": body.name.strip(), "cad": body.cadence,
            "dd": body.due_day, "dmo": body.due_month_offset,
            "au": body.assigned_to_user_id, "ac": body.assigned_contact_id,
            "rdb": body.reminder_days_before, "n": body.notes, "u": user.id,
        },
    )
    # Generate the first batch of occurrences inline so the UI lights
    # up immediately instead of waiting for the daily cron tick.
    ob = _get_obligation(db, new_id)
    until = dt.date.today() + dt.timedelta(days=120)
    _generate_for_obligation(db, ob, until)
    db.commit()
    return _get_obligation(db, new_id)


@router.patch("/obligations/{ob_id}")
def update_obligation(
    ob_id: str,
    patch: ObligationUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_obligation(db, ob_id)
    fields = patch.model_dump(exclude_unset=True)
    if "cadence" in fields and fields["cadence"] not in ALLOWED_CADENCES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"cadence must be one of {sorted(ALLOWED_CADENCES)}")
    if not fields:
        return _get_obligation(db, ob_id)
    set_parts: list[str] = ["updated_by = :u", "updated_at = now()"]
    params: dict = {"id": ob_id, "u": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE compliance_obligations SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get_obligation(db, ob_id)


@router.delete("/obligations/{ob_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_obligation(
    ob_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_obligation(db, ob_id)
    db.execute(text("DELETE FROM compliance_obligations WHERE id = :id"), {"id": ob_id})
    db.commit()
    return None


# ---------- Occurrences ----------


@router.get("/occurrences")
def list_occurrences(
    company_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    where = ["1=1"]
    params: dict = {}
    if company_id:
        where.append("o.company_id = :co")
        params["co"] = company_id
    if status_filter:
        if status_filter not in ALLOWED_STATUSES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_STATUSES)}")
        where.append("c.status = :st")
        params["st"] = status_filter
    if from_date:
        where.append("c.due_date >= :fd")
        params["fd"] = from_date
    if to_date:
        where.append("c.due_date <= :td")
        params["td"] = to_date

    rows = db.execute(
        text(
            "SELECT c.*, o.company_id, o.kind, o.name AS obligation_name, "
            "       o.assigned_to_user_id, o.reminder_days_before "
            "FROM compliance_occurrences c "
            "JOIN compliance_obligations o ON o.id = c.obligation_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY c.due_date ASC LIMIT 500"
        ),
        params,
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/occurrences/{occ_id}/file")
def file_occurrence(
    occ_id: str,
    body: OccurrenceFile,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_occurrence(db, occ_id)
    db.execute(
        text(
            "UPDATE compliance_occurrences SET "
            "  status = 'filed', filed_at = now(), filed_by = :u, "
            "  reference = COALESCE(:ref, reference), "
            "  amount    = COALESCE(:amt, amount), "
            "  notes     = COALESCE(:n, notes) "
            "WHERE id = :id"
        ),
        {
            "id": occ_id, "u": user.id,
            "ref": body.reference, "amt": body.amount, "n": body.notes,
        },
    )
    db.commit()
    return _get_occurrence(db, occ_id)


@router.post("/occurrences/{occ_id}/skip")
def skip_occurrence(
    occ_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_occurrence(db, occ_id)
    db.execute(
        text("UPDATE compliance_occurrences SET status = 'skipped' WHERE id = :id"),
        {"id": occ_id},
    )
    db.commit()
    return _get_occurrence(db, occ_id)


@router.post("/occurrences/{occ_id}/reopen")
def reopen_occurrence(
    occ_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_occurrence(db, occ_id)
    db.execute(
        text(
            "UPDATE compliance_occurrences SET "
            "  status = 'pending', filed_at = NULL, filed_by = NULL "
            "WHERE id = :id"
        ),
        {"id": occ_id},
    )
    # Clear reminders so the cron can re-fire if still due.
    db.execute(
        text("DELETE FROM compliance_reminders WHERE occurrence_id = :id"),
        {"id": occ_id},
    )
    db.commit()
    return _get_occurrence(db, occ_id)


@router.delete("/occurrences/{occ_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_occurrence(
    occ_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_occurrence(db, occ_id)
    db.execute(text("DELETE FROM compliance_occurrences WHERE id = :id"), {"id": occ_id})
    db.commit()
    return None


# ---------- Generation (also called by the scheduler) ----------


@router.post("/generate")
def generate_now(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Force a generation pass right now. Idempotent — uses the
    unique key on (obligation_id, due_date)."""
    _require_manage(user)
    until = dt.date.today() + dt.timedelta(days=120)
    obs = db.execute(
        text("SELECT * FROM compliance_obligations WHERE is_active = true")
    ).mappings().all()
    total = 0
    for ob in obs:
        total += _generate_for_obligation(db, row(ob), until)
    db.commit()
    return {"created": total, "until": str(until)}
