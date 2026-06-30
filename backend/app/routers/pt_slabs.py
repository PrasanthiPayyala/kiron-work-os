"""Professional Tax slab reference table.

Each Indian state has its own PT schedule — typically a stepped
gross-salary range mapping to a monthly flat amount. Slabs are
maintained by HR and looked up by the payroll-run generator to
pre-compute the pt_employee deduction per payslip.

Endpoints
---------
GET    /pt-slabs           list all (any authed user; structure editor
                           needs them for the live deduction hint)
POST   /pt-slabs           create (HR / super_admin / founder)
PATCH  /pt-slabs/{id}      update
DELETE /pt-slabs/{id}      soft-deactivate

Same authz gate as offices — anyone who can edit a company's basics
can maintain PT slabs. UNIQUE (state, min_gross) means re-importing
the same row is a 409.
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

router = APIRouter(tags=["payroll"])


class PtSlabCreate(BaseModel):
    state: str = Field(..., min_length=1, max_length=8)
    min_gross: float = Field(..., ge=0)
    max_gross: Optional[float] = Field(None, gt=0)
    amount: float = Field(..., ge=0)


class PtSlabUpdate(BaseModel):
    state: Optional[str] = Field(None, min_length=1, max_length=8)
    min_gross: Optional[float] = Field(None, ge=0)
    max_gross: Optional[float] = Field(None, gt=0)
    amount: Optional[float] = Field(None, ge=0)
    is_active: Optional[bool] = None


def _get(db: Session, slab_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM pt_slabs WHERE id = :id"), {"id": slab_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "PT slab not found")
    return row(found)


def _require_editor(user: CurrentUser) -> None:
    if not can_edit_company_basic(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / super_admin / founder / founder_office_coordinator "
            "can manage PT slabs",
        )


@router.get("/pt-slabs")
def list_pt_slabs(
    user: CurrentUser = Depends(get_current_user),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            "SELECT * FROM pt_slabs "
            "ORDER BY state ASC, min_gross ASC"
        )
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/pt-slabs", status_code=status.HTTP_201_CREATED)
def create_pt_slab(
    body: PtSlabCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    if body.max_gross is not None and body.max_gross <= body.min_gross:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "max_gross must be greater than min_gross",
        )
    sid = str(uuid.uuid4())
    try:
        db.execute(
            text(
                "INSERT INTO pt_slabs "
                "  (id, state, min_gross, max_gross, amount) "
                "VALUES (:id, :s, :lo, :hi, :a)"
            ),
            {
                "id": sid, "s": body.state.strip().upper(),
                "lo": body.min_gross, "hi": body.max_gross, "a": body.amount,
            },
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        if "pt_slabs_state_min_gross_key" in str(e):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"A slab for {body.state} starting at {body.min_gross} already exists",
            )
        raise
    return _get(db, sid)


@router.patch("/pt-slabs/{slab_id}")
def update_pt_slab(
    slab_id: str,
    patch: PtSlabUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    existing = _get(db, slab_id)
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return existing
    # Cross-field validation when one of min/max is being changed.
    new_min = fields.get("min_gross", existing.get("min_gross"))
    new_max = fields.get("max_gross", existing.get("max_gross"))
    if new_max is not None and new_min is not None and float(new_max) <= float(new_min):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "max_gross must be greater than min_gross",
        )
    set_parts: list[str] = []
    params: dict = {"id": slab_id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v.strip().upper() if k == "state" and isinstance(v, str) else v
    db.execute(
        text(f"UPDATE pt_slabs SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    db.commit()
    return _get(db, slab_id)


@router.delete("/pt-slabs/{slab_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pt_slab(
    slab_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    _get(db, slab_id)
    db.execute(
        text("UPDATE pt_slabs SET is_active = false WHERE id = :id"),
        {"id": slab_id},
    )
    db.commit()
    return None
