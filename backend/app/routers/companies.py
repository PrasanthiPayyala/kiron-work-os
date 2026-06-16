"""Company profile + working-hours config.

Endpoints:
    POST   /companies             — create a new entity (HR / founder office)
    GET    /companies/{id}        — read one (any signed-in user)
    PATCH  /companies/{id}        — update profile, schedule, anything else
                                    (HR / founder office / founder / super_admin)

Authorization for create + edit lives in COMPANY_MANAGE_ROLES (authz.py).
GET stays open because every client needs the full company list to render
attendance, projects, badges, etc. Everyone reads; only the privileged roles
write.

The profile fields (CIN, addresses, directors, etc.) are nullable — older
rows from before migration 0009 are fine being mostly NULL. The frontend
treats NULL as "not provided yet" and renders blank inputs.
"""
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_manage_companies
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/companies", tags=["companies"])


def _get(db: Session, company_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM companies WHERE id = :id"), {"id": company_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    return row(found)


def _validate_schedule(work_days: Optional[list[int]],
                       work_start: Optional[str],
                       work_end: Optional[str],
                       saturday_weeks_working: Optional[list[int]] = None) -> None:
    if work_days is not None:
        if not work_days:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "work_days can't be empty")
        if any(d < 1 or d > 7 for d in work_days):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "work_days uses ISO day numbers (1=Mon..7=Sun)")
    if work_start and work_end and work_start >= work_end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "work_start must be earlier than work_end")
    if saturday_weeks_working is not None:
        if any(w < 1 or w > 5 for w in saturday_weeks_working):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "saturday_weeks_working values must be 1..5")


# Columns the PATCH endpoint can write directly. Keep this list as the
# single source of truth; any new column added to migration 0009+ should
# land here too.
_WRITABLE = {
    # Display / identity
    "short_name", "initials", "color", "domain", "code", "logo_url", "is_active",
    # Schedule
    "work_days", "work_start", "work_end", "saturday_weeks_working",
    # Profile basics
    "website_urls", "website_technologies", "nature_of_business",
    "date_of_incorporation", "is_startup",
    # Registration / tax IDs
    "cin", "gst", "pan", "tan", "tin",
    "msme_udyam_number", "msme_udyam_mobile", "msme_udyam_email",
    "dpiit_startup_number",
    # Addresses + phones
    "registered_address", "corporate_addresses", "operations_addresses", "phone_numbers",
    # Directors (legal — registered with MCA, get a DIN) and leadership
    # (operational — CEO/COO/heads-of, no DIN). Both jsonb lists of
    # {name, designation, …}. Founder principal designations are stored
    # per-entity as plain text columns.
    "directors", "leadership", "kiran_designation", "prashanti_designation",
    # Compliance — managing_ca_* moved into Contacts (migration 0011).
    # Linked CAs are now contacts with category='ca' joined via
    # contact_companies. ca_documents_held stays on the company (it's a
    # list of certificates the company holds, not specific to one CA).
    "certificates", "ca_documents_held",
    # Renaming a company is allowed but rare; the unique constraint surfaces
    # the conflict at the DB layer.
    "name",
}


class CompanyProfile(BaseModel):
    """Full editable surface of a company. Every field is optional so PATCH
    behaves as a sparse update (unset = don't touch). POST uses the same
    schema but requires `name` upfront."""
    # Display / identity
    short_name: Optional[str] = None
    initials: Optional[str] = None
    color: Optional[str] = None
    domain: Optional[str] = None
    code: Optional[str] = None
    logo_url: Optional[str] = None
    is_active: Optional[bool] = None
    # Schedule
    work_days: Optional[list[int]] = Field(None, description="ISO 1=Mon..7=Sun")
    work_start: Optional[str] = Field(None, description="HH:MM 24h")
    work_end: Optional[str] = Field(None, description="HH:MM 24h")
    saturday_weeks_working: Optional[list[int]] = Field(None, description="1..5")
    # Profile basics
    website_urls: Optional[list[str]] = None
    website_technologies: Optional[str] = None
    nature_of_business: Optional[str] = None
    date_of_incorporation: Optional[str] = Field(None, description="YYYY-MM-DD")
    is_startup: Optional[bool] = None
    # Registration / tax IDs
    cin: Optional[str] = None
    gst: Optional[str] = None
    pan: Optional[str] = None
    tan: Optional[str] = None
    tin: Optional[str] = None
    msme_udyam_number: Optional[str] = None
    msme_udyam_mobile: Optional[str] = None
    msme_udyam_email: Optional[EmailStr] = None
    dpiit_startup_number: Optional[str] = None
    # Addresses + phones
    registered_address: Optional[str] = None
    corporate_addresses: Optional[list[str]] = None
    operations_addresses: Optional[list[str]] = None
    phone_numbers: Optional[list[str]] = None
    # Directors + founder principal designations
    directors: Optional[list[dict]] = Field(
        None, description="List of {name, designation, din?} — registered with MCA"
    )
    leadership: Optional[list[dict]] = Field(
        None, description="List of {name, designation} — operational leadership (CEO/COO/etc.)"
    )
    kiran_designation: Optional[str] = None
    prashanti_designation: Optional[str] = None
    # Compliance — CA contacts now live in the contacts table linked via
    # contact_companies (migration 0011). Only the document-list stays here.
    certificates: Optional[list[str]] = None
    ca_documents_held: Optional[list[str]] = None


class CompanyCreate(CompanyProfile):
    """Create-only — `name` is required."""
    name: str = Field(..., min_length=1, max_length=200)


# Columns stored as Postgres jsonb. We bind the value as a JSON string and
# cast in SQL — psycopg's Python list -> Postgres ARRAY adapter would
# otherwise mis-route the bind for jsonb targets.
_JSONB_COLS = {"directors", "leadership"}


def _build_update(fields: dict, company_id: str) -> tuple[str | None, dict]:
    """Build the UPDATE SQL + params for a sparse fields dict. Returns
    (sql, params) — sql is None when there's nothing to update so the
    caller can skip the execute()."""
    set_parts: list[str] = []
    params: dict = {"id": company_id}
    for col, val in fields.items():
        if col not in _WRITABLE:
            continue
        # Coerce empty array / blank string to NULL for nullable columns.
        if isinstance(val, list) and not val:
            val = None
        if isinstance(val, str) and not val.strip():
            val = None
        if col in _JSONB_COLS:
            params[col] = json.dumps(val) if val is not None else None
            # CAST(:name AS jsonb), not :name::jsonb — SQLAlchemy's text()
            # parser refuses to bind :directors when it is immediately
            # followed by `::` (postgres cast operator), so substitution
            # silently failed and the params dict dropped the key. Every
            # company save with a directors field (incl. empty list ->
            # None) ended up 500-ing on a malformed UPDATE.
            set_parts.append(f"{col} = CAST(:{col} AS jsonb)")
        else:
            params[col] = val
            set_parts.append(f"{col} = :{col}")
    if not set_parts:
        return None, params
    return f"UPDATE companies SET {', '.join(set_parts)} WHERE id = :id", params


def _apply_update(db: Session, company_id: str, fields: dict) -> dict:
    """PATCH helper — apply a sparse update and commit. Used by the PATCH
    endpoint where the row already exists."""
    sql, params = _build_update(fields, company_id)
    if sql is not None:
        db.execute(text(sql), params)
    db.commit()
    return _get(db, company_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_company(
    body: CompanyCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not can_manage_companies(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to create companies")
    _validate_schedule(body.work_days, body.work_start, body.work_end,
                       body.saturday_weeks_working)

    # Reject duplicate names early so the API surface gives a clean message
    # instead of leaking the unique-constraint detail to the client.
    dup = db.execute(
        text("SELECT 1 FROM companies WHERE lower(name) = lower(:n)"),
        {"n": body.name},
    ).first()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, "A company with this name already exists")

    new_id = str(uuid.uuid4())
    fields = body.model_dump(exclude_unset=True)
    name = fields.pop("name")

    # Single transaction: INSERT bare row, then UPDATE with the profile
    # fields, then commit. If the UPDATE throws (constraint violation,
    # cast error, etc.) the bare INSERT rolls back too — so we never leak
    # a half-filled row that subsequently 409s on retry.
    try:
        db.execute(
            text("INSERT INTO companies (id, name) VALUES (:id, :n)"),
            {"id": new_id, "n": name},
        )
        update_sql, update_params = _build_update(fields, new_id)
        if update_sql is not None:
            db.execute(text(update_sql), update_params)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _get(db, new_id)


@router.patch("/{company_id}")
def update_company(
    company_id: str,
    body: CompanyProfile,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not can_manage_companies(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit company config")
    _get(db, company_id)
    _validate_schedule(body.work_days, body.work_start, body.work_end,
                       body.saturday_weeks_working)
    fields = body.model_dump(exclude_unset=True)
    return _apply_update(db, company_id, fields)
