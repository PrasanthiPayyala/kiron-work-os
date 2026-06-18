"""Asset management router.

Endpoints:
- GET    /assets                       list (HR + ops roles see all;
                                       everyone else only sees their
                                       own currently-held assets)
- GET    /assets/{id}                  detail (same scope as list)
- POST   /assets                       create (manage roles)
- PATCH  /assets/{id}                  edit (manage roles)
- DELETE /assets/{id}                  delete (super_admin / founder)
- POST   /assets/{id}/issue            assign to a user (manage roles)
- POST   /assets/{id}/return           return from current holder
- GET    /assets/{id}/history          all past assignments

Manage roles: super_admin, founder, founder_office_coordinator,
founder_office_support, hr_admin. The same set that handles attendance
follow-up — keeps the ops surface consistent.
"""
import datetime as dt
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..ledger_link import delete_ledger_for_source, upsert_ledger_for_source
from ..util import row

router = APIRouter(prefix="/assets", tags=["assets"])

ASSET_MANAGE_ROLES = {
    "super_admin", "founder",
    "founder_office_coordinator", "founder_office_support",
    "hr_admin",
}
ALLOWED_STATUSES = {"in_stock", "issued", "in_repair", "retired", "lost"}
ALLOWED_CONDITIONS = {"new", "good", "fair", "poor"}


class AssetCreate(BaseModel):
    asset_tag: Optional[str] = None
    category: str = "laptop"
    brand: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    company_id: Optional[str] = None
    purchase_date: Optional[str] = None
    purchase_cost: Optional[float] = None
    supplier: Optional[str] = None
    condition: str = "good"
    notes: Optional[str] = None


class AssetUpdate(BaseModel):
    asset_tag: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    company_id: Optional[str] = None
    purchase_date: Optional[str] = None
    purchase_cost: Optional[float] = None
    supplier: Optional[str] = None
    status: Optional[str] = None
    condition: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class IssueBody(BaseModel):
    user_id: str
    issue_note: Optional[str] = None
    condition_at_issue: Optional[str] = None


class ReturnBody(BaseModel):
    return_note: Optional[str] = None
    condition_at_return: Optional[str] = None


def _require_manage(user: CurrentUser) -> None:
    if not has_any_role(user.roles, ASSET_MANAGE_ROLES):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / founder's office / super_admin can do this",
        )


def _get(db: Session, asset_id: str) -> dict:
    r = db.execute(text("SELECT * FROM assets WHERE id = :id"), {"id": asset_id}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    return row(r)


def _can_view(asset: dict, user: CurrentUser) -> bool:
    if has_any_role(user.roles, ASSET_MANAGE_ROLES):
        return True
    return str(asset.get("current_holder_id") or "") == user.id


# ---------- CRUD ----------


@router.post("", status_code=status.HTTP_201_CREATED)
def create_asset(
    body: AssetCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    if body.condition not in ALLOWED_CONDITIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"condition must be one of {sorted(ALLOWED_CONDITIONS)}")

    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO assets ("
            "  id, asset_tag, category, brand, model, serial_number, "
            "  company_id, purchase_date, purchase_cost, supplier, "
            "  condition, notes, status, created_by, updated_by"
            ") VALUES ("
            "  :id, :tag, :cat, :brand, :model, :sn, "
            "  :co, :pd, :cost, :sup, "
            "  :cond, :n, 'in_stock', :u, :u"
            ")"
        ),
        {
            "id": new_id, "tag": body.asset_tag, "cat": body.category,
            "brand": body.brand, "model": body.model, "sn": body.serial_number,
            "co": body.company_id, "pd": body.purchase_date or None,
            "cost": body.purchase_cost, "sup": body.supplier,
            "cond": body.condition, "n": body.notes, "u": user.id,
        },
    )

    # Mirror into the ledger when a real cost + a buying entity are set.
    if body.purchase_cost and float(body.purchase_cost) > 0 and body.company_id:
        upsert_ledger_for_source(
            db,
            source_kind="asset", source_id=new_id,
            company_id=body.company_id,
            txn_date=body.purchase_date or str(dt.date.today()),
            direction="out",
            amount=float(body.purchase_cost), currency="INR",
            description=f"Asset: {body.brand or ''} {body.model or ''} ({body.category})".strip(),
            category="capex",
            payee_text=body.supplier,
            created_by=user.id,
        )

    db.commit()
    return _get(db, new_id)


@router.get("")
def list_assets(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """HR + ops see every asset; everyone else only their currently
    held ones (so the future "my assets" widget works without
    re-implementing the scope)."""
    if has_any_role(user.roles, ASSET_MANAGE_ROLES):
        rows = db.execute(
            text(
                "SELECT * FROM assets WHERE is_active = true "
                "ORDER BY category, asset_tag NULLS LAST, brand, model"
            )
        ).mappings().all()
    else:
        rows = db.execute(
            text(
                "SELECT * FROM assets "
                "WHERE is_active = true AND current_holder_id = :u "
                "ORDER BY category"
            ),
            {"u": user.id},
        ).mappings().all()
    return [row(r) for r in rows]


@router.get("/{asset_id}")
def get_asset(
    asset_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    a = _get(db, asset_id)
    if not _can_view(a, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this asset")
    return a


@router.patch("/{asset_id}")
def update_asset(
    asset_id: str,
    patch: AssetUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get(db, asset_id)
    fields = patch.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] not in ALLOWED_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_STATUSES)}")
    if "condition" in fields and fields["condition"] not in ALLOWED_CONDITIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"condition must be one of {sorted(ALLOWED_CONDITIONS)}")
    if not fields:
        return _get(db, asset_id)
    set_parts: list[str] = ["updated_by = :u", "updated_at = now()"]
    params: dict = {"id": asset_id, "u": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE assets SET {', '.join(set_parts)} WHERE id = :id"), params)

    # If purchase metadata changed, keep the ledger row in sync. The
    # upsert helper handles both "row doesn't exist yet" (asset was
    # created before the ledger landed) and "amount changed".
    if any(k in fields for k in ("purchase_cost", "purchase_date", "company_id", "supplier", "brand", "model", "category")):
        fresh = _get(db, asset_id)
        if fresh.get("purchase_cost") and float(fresh["purchase_cost"]) > 0 and fresh.get("company_id"):
            upsert_ledger_for_source(
                db,
                source_kind="asset", source_id=asset_id,
                company_id=str(fresh["company_id"]),
                txn_date=fresh.get("purchase_date") and str(fresh["purchase_date"]) or str(dt.date.today()),
                direction="out",
                amount=float(fresh["purchase_cost"]), currency="INR",
                description=f"Asset: {fresh.get('brand') or ''} {fresh.get('model') or ''} ({fresh.get('category')})".strip(),
                category="capex",
                payee_text=fresh.get("supplier"),
                created_by=user.id,
            )

    db.commit()
    return _get(db, asset_id)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not has_any_role(user.roles, {"super_admin", "founder"}):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super_admin / founder can delete an asset")
    _get(db, asset_id)
    delete_ledger_for_source(db, source_kind="asset", source_id=asset_id)
    db.execute(text("DELETE FROM assets WHERE id = :id"), {"id": asset_id})
    db.commit()
    return None


# ---------- Issue / Return ----------


@router.post("/{asset_id}/issue", status_code=status.HTTP_201_CREATED)
def issue_asset(
    asset_id: str,
    body: IssueBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    a = _get(db, asset_id)
    # Block double-issue. The unique partial index would also reject,
    # but a clean 409 is friendlier than a constraint violation.
    active = db.execute(
        text("SELECT id FROM asset_assignments WHERE asset_id = :a AND returned_at IS NULL"),
        {"a": asset_id},
    ).first()
    if active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Asset is already issued — return it first")
    if body.condition_at_issue and body.condition_at_issue not in ALLOWED_CONDITIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"condition_at_issue must be one of {sorted(ALLOWED_CONDITIONS)}")

    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO asset_assignments "
            "  (id, asset_id, user_id, issued_by, issue_note, condition_at_issue) "
            "VALUES (:id, :a, :u, :ib, :n, :c)"
        ),
        {
            "id": new_id, "a": asset_id, "u": body.user_id,
            "ib": user.id, "n": body.issue_note,
            "c": body.condition_at_issue,
        },
    )
    db.execute(
        text(
            "UPDATE assets SET "
            "  current_holder_id = :u, status = 'issued', updated_by = :ub, updated_at = now() "
            "WHERE id = :id"
        ),
        {"u": body.user_id, "ub": user.id, "id": asset_id},
    )
    db.commit()
    return _get(db, asset_id)


@router.post("/{asset_id}/return")
def return_asset(
    asset_id: str,
    body: ReturnBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get(db, asset_id)
    active = db.execute(
        text("SELECT id FROM asset_assignments WHERE asset_id = :a AND returned_at IS NULL"),
        {"a": asset_id},
    ).mappings().first()
    if not active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Asset is not currently issued")
    if body.condition_at_return and body.condition_at_return not in ALLOWED_CONDITIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"condition_at_return must be one of {sorted(ALLOWED_CONDITIONS)}")
    db.execute(
        text(
            "UPDATE asset_assignments SET "
            "  returned_at = now(), returned_by = :rb, "
            "  return_note = :n, condition_at_return = :c "
            "WHERE id = :id"
        ),
        {"id": active["id"], "rb": user.id, "n": body.return_note, "c": body.condition_at_return},
    )
    new_condition = body.condition_at_return or None
    set_parts = [
        "current_holder_id = NULL", "status = 'in_stock'",
        "updated_by = :ub", "updated_at = now()",
    ]
    params: dict = {"id": asset_id, "ub": user.id}
    if new_condition:
        set_parts.append("condition = :cond")
        params["cond"] = new_condition
    db.execute(text(f"UPDATE assets SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get(db, asset_id)


@router.get("/{asset_id}/history")
def list_history(
    asset_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    a = _get(db, asset_id)
    if not _can_view(a, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this asset")
    rows = db.execute(
        text(
            "SELECT * FROM asset_assignments WHERE asset_id = :a "
            "ORDER BY issued_at DESC LIMIT 200"
        ),
        {"a": asset_id},
    ).mappings().all()
    return [row(r) for r in rows]
