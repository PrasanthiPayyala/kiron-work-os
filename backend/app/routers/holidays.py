"""Holiday calendar — public read, HR/super_admin write.

A holiday row is either company-specific (company_id set) or global
(company_id NULL, applies to every company). The Attendance and Leave UIs
treat a row whose date falls inside a query window the same way regardless
of which kind it is; matching by company_id happens client-side.

Bulk import is the path HR will use to load a year's list from a doc —
duplicate rows (same company_id + date + name) are skipped so re-runs don't
double up.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_manage_users
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/holidays", tags=["holidays"])

ALLOWED_TYPES = {"gazetted", "optional", "informational"}


def _require_manager(user: CurrentUser) -> None:
    if not can_manage_users(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit holidays")


def _get(db: Session, holiday_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM holidays WHERE id = :id"), {"id": holiday_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Holiday not found")
    return row(found)


# ---------- List ----------

@router.get("")
def list_holidays(
    year: Optional[int] = None,
    company_id: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read-only for everyone authenticated.

    Without filters, returns every holiday. `year` is the common case (the
    Attendance and Settings pages both call this). `company_id` narrows to
    a single company plus its global rows.
    """
    where = []
    params: dict = {}
    if year is not None:
        where.append("extract(year from date) = :year")
        params["year"] = year
    if company_id is not None:
        where.append("(company_id = :co OR company_id IS NULL)")
        params["co"] = company_id
    sql = "SELECT * FROM holidays"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY date ASC, name ASC"
    return [row(m) for m in db.execute(text(sql), params).mappings().all()]


# ---------- Create ----------

class HolidayCreate(BaseModel):
    date: str = Field(..., description="YYYY-MM-DD")
    name: str = Field(..., min_length=1, max_length=120)
    type: str = "gazetted"
    company_id: Optional[str] = Field(None, description="NULL = applies to every company")
    notes: Optional[str] = None


@router.post("", status_code=status.HTTP_201_CREATED)
def create_holiday(
    body: HolidayCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    if body.type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"type must be one of {sorted(ALLOWED_TYPES)}")
    new_id = db.execute(
        text(
            "INSERT INTO holidays (company_id, date, name, type, notes, created_by) "
            "VALUES (:co, :dt, :name, :tp, :notes, :cb) "
            "ON CONFLICT DO NOTHING RETURNING id"
        ),
        {"co": body.company_id, "dt": body.date, "name": body.name,
         "tp": body.type, "notes": body.notes, "cb": user.id},
    ).first()
    if not new_id:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "A holiday with this date + name already exists for that company")
    db.commit()
    return _get(db, str(new_id[0]))


# ---------- Update ----------

class HolidayUpdate(BaseModel):
    date: Optional[str] = None
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    type: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/{holiday_id}")
def update_holiday(
    holiday_id: str,
    body: HolidayUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    _get(db, holiday_id)
    if body.type is not None and body.type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"type must be one of {sorted(ALLOWED_TYPES)}")
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return _get(db, holiday_id)
    set_parts = []
    params: dict = {"id": holiday_id}
    for col, val in fields.items():
        set_parts.append(f"{col} = :{col}")
        params[col] = val
    db.execute(text(f"UPDATE holidays SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get(db, holiday_id)


# ---------- Delete ----------

@router.delete("/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holiday(
    holiday_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    _get(db, holiday_id)
    db.execute(text("DELETE FROM holidays WHERE id = :id"), {"id": holiday_id})
    db.commit()
    return None


# ---------- Bulk import ----------

class HolidayBulkIn(BaseModel):
    holidays: list[HolidayCreate]
    # If true, existing rows for the same (company, date, name) are replaced
    # (type / notes can change year to year if HR re-imports a corrected list).
    # If false (default), duplicates are simply skipped.
    replace: bool = False


@router.post("/bulk")
def bulk_import(
    body: HolidayBulkIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import many holidays at once — the typical "load 2026 list" flow.

    Returns counts so HR can tell whether duplicates were silently dropped.
    """
    _require_manager(user)
    bad = [h.type for h in body.holidays if h.type not in ALLOWED_TYPES]
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown holiday types: {sorted(set(bad))}")

    inserted = 0
    updated = 0
    skipped = 0
    for h in body.holidays:
        if body.replace:
            # Look up an existing row with the same (company_id, date, lower(name))
            # — the unique index keys it the same way. PATCH the type/notes
            # rather than DELETE+INSERT so the id stays stable for any UI
            # state that references it.
            existing = db.execute(
                text(
                    "SELECT id FROM holidays WHERE "
                    "coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid) = "
                    " coalesce(CAST(:co AS uuid), '00000000-0000-0000-0000-000000000000'::uuid) "
                    "AND date = :dt AND lower(name) = lower(:name)"
                ),
                {"co": h.company_id, "dt": h.date, "name": h.name},
            ).first()
            if existing:
                db.execute(
                    text("UPDATE holidays SET type = :tp, notes = :notes WHERE id = :id"),
                    {"tp": h.type, "notes": h.notes, "id": str(existing[0])},
                )
                updated += 1
                continue
        new_id = db.execute(
            text(
                "INSERT INTO holidays (company_id, date, name, type, notes, created_by) "
                "VALUES (:co, :dt, :name, :tp, :notes, :cb) "
                "ON CONFLICT DO NOTHING RETURNING id"
            ),
            {"co": h.company_id, "dt": h.date, "name": h.name,
             "tp": h.type, "notes": h.notes, "cb": user.id},
        ).first()
        if new_id:
            inserted += 1
        else:
            skipped += 1
    db.commit()
    return {"inserted": inserted, "updated": updated, "skipped": skipped}
