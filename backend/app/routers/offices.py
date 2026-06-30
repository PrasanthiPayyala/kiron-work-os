"""Per-company offices with optional geofence.

An office is an addressable location belonging to a company. Each
office has a name, optional address, optional (latitude, longitude),
and a radius_m. When an employee is assigned to an office via
profiles.office_id, attendance check-in compares the captured geo
against (latitude, longitude, radius_m) and stamps the row's
geo_outside_office flag for HR review.

Endpoints
---------
GET    /companies/{company_id}/offices       list (any authed user — the
                                              People dropdown needs it)
POST   /companies/{company_id}/offices       create (HR / super_admin /
                                              founder / founder_office_coord)
PATCH  /offices/{office_id}                  update (same gate)
DELETE /offices/{office_id}                  soft-deactivate by default;
                                              hard delete only when no
                                              profile references it

Authz mirrors companies.py — the same set that can edit company
addresses can manage offices, since offices are essentially structured
address rows.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_edit_company_basic
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(tags=["companies"])


class OfficeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    address: Optional[str] = None
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    radius_m: int = Field(200, gt=0, le=10000)


class OfficeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    address: Optional[str] = None
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    radius_m: Optional[int] = Field(None, gt=0, le=10000)
    is_active: Optional[bool] = None


def _get(db: Session, office_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM offices WHERE id = :id"), {"id": office_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Office not found")
    return row(found)


def _require_company_editor(user: CurrentUser) -> None:
    if not can_edit_company_basic(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / super_admin / founder / founder_office_coordinator "
            "can manage offices",
        )


# ---------- List ----------

@router.get("/companies/{company_id}/offices")
def list_offices(
    company_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List offices for a company. Public to any authed user — the
    People dialog's office dropdown needs to enumerate them. Inactive
    rows surface too (front-end filters)."""
    rows = db.execute(
        text(
            "SELECT * FROM offices WHERE company_id = :co "
            "ORDER BY is_active DESC, name ASC"
        ),
        {"co": company_id},
    ).mappings().all()
    return [row(r) for r in rows]


# ---------- Create ----------

@router.post("/companies/{company_id}/offices", status_code=status.HTTP_201_CREATED)
def create_office(
    company_id: str,
    body: OfficeCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_company_editor(user)
    # Sanity: company exists
    co = db.execute(
        text("SELECT id FROM companies WHERE id = :id"), {"id": company_id},
    ).first()
    if not co:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")

    oid = str(uuid.uuid4())
    try:
        db.execute(
            text(
                "INSERT INTO offices "
                "  (id, company_id, name, address, latitude, longitude, radius_m) "
                "VALUES (:id, :co, :n, :a, :lat, :lng, :r)"
            ),
            {
                "id": oid, "co": company_id, "n": body.name.strip(),
                "a": body.address, "lat": body.latitude, "lng": body.longitude,
                "r": body.radius_m,
            },
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        # UNIQUE (company_id, name) violation lands here.
        if "offices_company_id_name_key" in str(e):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"An office named '{body.name}' already exists for this company",
            )
        raise
    return _get(db, oid)


# ---------- Update ----------

@router.patch("/offices/{office_id}")
def update_office(
    office_id: str,
    patch: OfficeUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_company_editor(user)
    existing = _get(db, office_id)  # noqa: F841 — for 404 side-effect

    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return existing

    set_parts: list[str] = []
    params: dict = {"id": office_id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v.strip() if k == "name" and isinstance(v, str) else v
    db.execute(
        text(f"UPDATE offices SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    db.commit()
    return _get(db, office_id)


# ---------- Delete (soft by default) ----------

@router.delete("/offices/{office_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_office(
    office_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft-deactivate (is_active=false) so historical attendance rows
    that referenced this office through the employee still resolve.
    Hard delete is intentionally not exposed — drop directly via SQL if
    you really need to."""
    _require_company_editor(user)
    _get(db, office_id)
    db.execute(
        text("UPDATE offices SET is_active = false WHERE id = :id"),
        {"id": office_id},
    )
    db.commit()
    return None
