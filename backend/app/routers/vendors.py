"""Vendor management router.

Endpoints:
- GET    /vendors                       list (manage roles only — same
                                         set as Assets / attendance)
- POST   /vendors                       create
- GET    /vendors/{id}                  detail + contracts + payments
- PATCH  /vendors/{id}                  edit
- DELETE /vendors/{id}                  delete (super_admin / founder)
- POST   /vendors/{id}/contracts        add a contract
- PATCH  /vendors/contracts/{id}        edit a contract
- DELETE /vendors/contracts/{id}        delete a contract
- POST   /vendors/{id}/payments         log a payment
- DELETE /vendors/payments/{id}         delete a payment
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/vendors", tags=["vendors"])

VENDOR_MANAGE_ROLES = {
    "super_admin", "founder",
    "founder_office_coordinator", "founder_office_support",
    "hr_admin",
}

ALLOWED_CONTRACT_TYPES = {"subscription", "retainer", "one_time", "license", "other"}
ALLOWED_CADENCES = {"monthly", "quarterly", "half_yearly", "yearly", "one_time"}
ALLOWED_CONTRACT_STATUSES = {"active", "expired", "cancelled"}


class VendorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = "other"
    website: Optional[str] = None
    gstin: Optional[str] = None
    address: Optional[str] = None
    primary_contact: Optional[str] = None
    primary_email: Optional[str] = None
    primary_phone: Optional[str] = None
    notes: Optional[str] = None
    organization_id: Optional[str] = None
    owner_id: Optional[str] = None
    company_id: Optional[str] = None


class VendorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = None
    website: Optional[str] = None
    gstin: Optional[str] = None
    address: Optional[str] = None
    primary_contact: Optional[str] = None
    primary_email: Optional[str] = None
    primary_phone: Optional[str] = None
    notes: Optional[str] = None
    organization_id: Optional[str] = None
    owner_id: Optional[str] = None
    company_id: Optional[str] = None
    is_active: Optional[bool] = None


class ContractCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    contract_type: str = "subscription"
    amount: Optional[float] = None
    currency: str = "INR"
    billing_cadence: str = "monthly"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    auto_renews: bool = False
    reminder_days_before: int = Field(30, ge=0, le=365)
    status: str = "active"
    notes: Optional[str] = None


class ContractUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    contract_type: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    billing_cadence: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    auto_renews: Optional[bool] = None
    reminder_days_before: Optional[int] = Field(None, ge=0, le=365)
    status: Optional[str] = None
    notes: Optional[str] = None


class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    currency: str = "INR"
    paid_at: str   # YYYY-MM-DD
    contract_id: Optional[str] = None
    mode: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None


def _require_manage(user: CurrentUser) -> None:
    if not has_any_role(user.roles, VENDOR_MANAGE_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only HR / founder's office / super_admin")


def _get(db: Session, vendor_id: str) -> dict:
    r = db.execute(text("SELECT * FROM vendors WHERE id = :id"), {"id": vendor_id}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return row(r)


def _get_contract(db: Session, contract_id: str) -> dict:
    r = db.execute(
        text("SELECT * FROM vendor_contracts WHERE id = :id"), {"id": contract_id},
    ).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contract not found")
    return row(r)


def _validate_contract_fields(c: ContractCreate | ContractUpdate, full: bool) -> None:
    if full or c.contract_type is not None:
        ct = c.contract_type if c.contract_type is not None else "subscription"
        if ct not in ALLOWED_CONTRACT_TYPES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"contract_type must be one of {sorted(ALLOWED_CONTRACT_TYPES)}")
    if full or c.billing_cadence is not None:
        bc = c.billing_cadence if c.billing_cadence is not None else "monthly"
        if bc not in ALLOWED_CADENCES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"billing_cadence must be one of {sorted(ALLOWED_CADENCES)}")
    if full or c.status is not None:
        st = c.status if c.status is not None else "active"
        if st not in ALLOWED_CONTRACT_STATUSES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_CONTRACT_STATUSES)}")


# ---------- Vendor CRUD ----------


@router.post("", status_code=status.HTTP_201_CREATED)
def create_vendor(
    body: VendorCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO vendors ("
            "  id, name, category, website, gstin, address, "
            "  primary_contact, primary_email, primary_phone, notes, "
            "  organization_id, owner_id, company_id, created_by, updated_by"
            ") VALUES ("
            "  :id, :name, :cat, :web, :gst, :addr, "
            "  :pc, :pe, :pp, :n, "
            "  :org, :own, :co, :u, :u"
            ")"
        ),
        {
            "id": new_id, "name": body.name.strip(), "cat": body.category,
            "web": body.website, "gst": body.gstin, "addr": body.address,
            "pc": body.primary_contact, "pe": body.primary_email, "pp": body.primary_phone,
            "n": body.notes, "org": body.organization_id, "own": body.owner_id or user.id,
            "co": body.company_id, "u": user.id,
        },
    )
    db.commit()
    return _get(db, new_id)


@router.get("")
def list_vendors(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    rows = db.execute(
        text(
            "SELECT * FROM vendors WHERE is_active = true "
            "ORDER BY category, name"
        )
    ).mappings().all()
    return [row(r) for r in rows]


@router.get("/{vendor_id}")
def get_vendor(
    vendor_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    v = _get(db, vendor_id)
    contracts = db.execute(
        text(
            "SELECT * FROM vendor_contracts WHERE vendor_id = :v "
            "ORDER BY end_date NULLS LAST, created_at DESC"
        ),
        {"v": vendor_id},
    ).mappings().all()
    payments = db.execute(
        text(
            "SELECT * FROM vendor_payments WHERE vendor_id = :v "
            "ORDER BY paid_at DESC LIMIT 200"
        ),
        {"v": vendor_id},
    ).mappings().all()
    return {
        **v,
        "contracts": [row(r) for r in contracts],
        "payments": [row(r) for r in payments],
    }


@router.patch("/{vendor_id}")
def update_vendor(
    vendor_id: str,
    patch: VendorUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get(db, vendor_id)
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return _get(db, vendor_id)
    set_parts: list[str] = ["updated_by = :u", "updated_at = now()"]
    params: dict = {"id": vendor_id, "u": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE vendors SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get(db, vendor_id)


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor(
    vendor_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not has_any_role(user.roles, {"super_admin", "founder"}):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super_admin / founder can delete a vendor")
    _get(db, vendor_id)
    db.execute(text("DELETE FROM vendors WHERE id = :id"), {"id": vendor_id})
    db.commit()
    return None


# ---------- Contracts ----------


@router.post("/{vendor_id}/contracts", status_code=status.HTTP_201_CREATED)
def create_contract(
    vendor_id: str,
    body: ContractCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get(db, vendor_id)
    _validate_contract_fields(body, full=True)
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO vendor_contracts ("
            "  id, vendor_id, title, contract_type, amount, currency, "
            "  billing_cadence, start_date, end_date, auto_renews, "
            "  reminder_days_before, status, notes, created_by, updated_by"
            ") VALUES ("
            "  :id, :v, :t, :ct, :amt, :cur, "
            "  :bc, :sd, :ed, :ar, "
            "  :rdb, :st, :n, :u, :u"
            ")"
        ),
        {
            "id": new_id, "v": vendor_id, "t": body.title.strip(),
            "ct": body.contract_type, "amt": body.amount, "cur": body.currency,
            "bc": body.billing_cadence,
            "sd": body.start_date or None, "ed": body.end_date or None,
            "ar": body.auto_renews, "rdb": body.reminder_days_before,
            "st": body.status, "n": body.notes, "u": user.id,
        },
    )
    db.commit()
    return _get_contract(db, new_id)


@router.patch("/contracts/{contract_id}")
def update_contract(
    contract_id: str,
    patch: ContractUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    existing = _get_contract(db, contract_id)
    _validate_contract_fields(patch, full=False)
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return existing
    set_parts: list[str] = ["updated_by = :u", "updated_at = now()"]
    params: dict = {"id": contract_id, "u": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE vendor_contracts SET {', '.join(set_parts)} WHERE id = :id"), params)

    # If end_date moved, allow the reminder to re-fire for the new
    # end_date by removing any stale reminder dedup row that points at
    # the old end_date.
    if "end_date" in fields:
        db.execute(
            text("DELETE FROM vendor_contract_reminders WHERE contract_id = :id"),
            {"id": contract_id},
        )

    db.commit()
    return _get_contract(db, contract_id)


@router.delete("/contracts/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contract(
    contract_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_contract(db, contract_id)
    db.execute(text("DELETE FROM vendor_contracts WHERE id = :id"), {"id": contract_id})
    db.commit()
    return None


# ---------- Payments ----------


@router.post("/{vendor_id}/payments", status_code=status.HTTP_201_CREATED)
def create_payment(
    vendor_id: str,
    body: PaymentCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get(db, vendor_id)
    if body.contract_id:
        _get_contract(db, body.contract_id)
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO vendor_payments "
            "  (id, vendor_id, contract_id, amount, currency, paid_at, "
            "   mode, reference, notes, paid_by, created_by) "
            "VALUES (:id, :v, :c, :amt, :cur, :paid, "
            "        :m, :ref, :n, :pb, :cb)"
        ),
        {
            "id": new_id, "v": vendor_id, "c": body.contract_id,
            "amt": body.amount, "cur": body.currency, "paid": body.paid_at,
            "m": body.mode, "ref": body.reference, "n": body.notes,
            "pb": user.id, "cb": user.id,
        },
    )
    db.commit()
    r = db.execute(text("SELECT * FROM vendor_payments WHERE id = :id"), {"id": new_id}).mappings().first()
    return row(r)


@router.delete("/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payment(
    payment_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    found = db.execute(
        text("SELECT id FROM vendor_payments WHERE id = :id"), {"id": payment_id},
    ).first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    db.execute(text("DELETE FROM vendor_payments WHERE id = :id"), {"id": payment_id})
    db.commit()
    return None
