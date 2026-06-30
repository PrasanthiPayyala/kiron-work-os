"""Income tax slab + regime-config reference tables.

Two related tables drive auto-TDS computation in the payroll-run
draft generator:

  tax_slabs          — per (regime, fy_label), the income brackets
                       and percentage rates.
  tax_regime_config  — per (regime, fy_label), the supporting
                       constants: standard_deduction, rebate_threshold
                       (87A), and cess_pct.

HR maintains both when Budget changes them. Both endpoints use the
same authz gate (HR / super_admin / founder).

Endpoints
---------
GET    /tax-slabs                    list all (any authed user; the
                                      salary structure editor uses
                                      them for the live TDS preview)
POST   /tax-slabs                    create a slab
PATCH  /tax-slabs/{id}               update a slab
DELETE /tax-slabs/{id}               soft-deactivate

GET    /tax-regime-config            list all configs
POST   /tax-regime-config            create a (regime, fy) config row
PATCH  /tax-regime-config/{id}       update
DELETE /tax-regime-config/{id}       soft-deactivate
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

ALLOWED_REGIMES = {"new", "old"}


def _require_editor(user: CurrentUser) -> None:
    if not can_edit_company_basic(user.roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only HR / super_admin / founder / founder_office_coordinator "
            "can manage tax slabs",
        )


# ============================= TAX SLABS =============================

class TaxSlabCreate(BaseModel):
    regime: str = Field(..., min_length=1)
    fy_label: str = Field(..., min_length=1, max_length=32)
    min_income: float = Field(..., ge=0)
    max_income: Optional[float] = Field(None, gt=0)
    rate_pct: float = Field(..., ge=0, le=100)


class TaxSlabUpdate(BaseModel):
    regime: Optional[str] = None
    fy_label: Optional[str] = None
    min_income: Optional[float] = Field(None, ge=0)
    max_income: Optional[float] = Field(None, gt=0)
    rate_pct: Optional[float] = Field(None, ge=0, le=100)
    is_active: Optional[bool] = None


def _get_slab(db: Session, slab_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM tax_slabs WHERE id = :id"), {"id": slab_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tax slab not found")
    return row(found)


@router.get("/tax-slabs")
def list_tax_slabs(
    user: CurrentUser = Depends(get_current_user),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            "SELECT * FROM tax_slabs "
            "ORDER BY fy_label DESC, regime ASC, min_income ASC"
        )
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/tax-slabs", status_code=status.HTTP_201_CREATED)
def create_tax_slab(
    body: TaxSlabCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    if body.regime not in ALLOWED_REGIMES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"regime must be one of {sorted(ALLOWED_REGIMES)}",
        )
    if body.max_income is not None and body.max_income <= body.min_income:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "max_income must be greater than min_income",
        )
    sid = str(uuid.uuid4())
    try:
        db.execute(
            text(
                "INSERT INTO tax_slabs "
                "  (id, regime, fy_label, min_income, max_income, rate_pct) "
                "VALUES (:id, :r, :f, :lo, :hi, :p)"
            ),
            {
                "id": sid, "r": body.regime, "f": body.fy_label.strip(),
                "lo": body.min_income, "hi": body.max_income, "p": body.rate_pct,
            },
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        if "tax_slabs_regime_fy_label_min_income_key" in str(e):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"A slab for {body.regime} / {body.fy_label} starting at {body.min_income} already exists",
            )
        raise
    return _get_slab(db, sid)


@router.patch("/tax-slabs/{slab_id}")
def update_tax_slab(
    slab_id: str,
    patch: TaxSlabUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    existing = _get_slab(db, slab_id)
    fields = patch.model_dump(exclude_unset=True)
    if "regime" in fields and fields["regime"] not in ALLOWED_REGIMES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"regime must be one of {sorted(ALLOWED_REGIMES)}",
        )
    if not fields:
        return existing
    new_min = fields.get("min_income", existing.get("min_income"))
    new_max = fields.get("max_income", existing.get("max_income"))
    if new_max is not None and new_min is not None and float(new_max) <= float(new_min):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "max_income must be greater than min_income",
        )
    set_parts: list[str] = []
    params: dict = {"id": slab_id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v.strip() if k in {"regime", "fy_label"} and isinstance(v, str) else v
    db.execute(
        text(f"UPDATE tax_slabs SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    db.commit()
    return _get_slab(db, slab_id)


@router.delete("/tax-slabs/{slab_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tax_slab(
    slab_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    _get_slab(db, slab_id)
    db.execute(
        text("UPDATE tax_slabs SET is_active = false WHERE id = :id"),
        {"id": slab_id},
    )
    db.commit()
    return None


# ========================== REGIME CONFIG ==========================

class RegimeConfigCreate(BaseModel):
    regime: str = Field(..., min_length=1)
    fy_label: str = Field(..., min_length=1, max_length=32)
    standard_deduction: float = Field(0, ge=0)
    rebate_threshold: Optional[float] = Field(None, ge=0)
    cess_pct: float = Field(4, ge=0, le=100)


class RegimeConfigUpdate(BaseModel):
    standard_deduction: Optional[float] = Field(None, ge=0)
    rebate_threshold: Optional[float] = Field(None, ge=0)
    cess_pct: Optional[float] = Field(None, ge=0, le=100)
    is_active: Optional[bool] = None


def _get_cfg(db: Session, cfg_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM tax_regime_config WHERE id = :id"), {"id": cfg_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tax regime config not found")
    return row(found)


@router.get("/tax-regime-config")
def list_regime_configs(
    user: CurrentUser = Depends(get_current_user),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            "SELECT * FROM tax_regime_config "
            "ORDER BY fy_label DESC, regime ASC"
        )
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/tax-regime-config", status_code=status.HTTP_201_CREATED)
def create_regime_config(
    body: RegimeConfigCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    if body.regime not in ALLOWED_REGIMES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"regime must be one of {sorted(ALLOWED_REGIMES)}",
        )
    cid = str(uuid.uuid4())
    try:
        db.execute(
            text(
                "INSERT INTO tax_regime_config "
                "  (id, regime, fy_label, standard_deduction, rebate_threshold, cess_pct) "
                "VALUES (:id, :r, :f, :sd, :rb, :c)"
            ),
            {
                "id": cid, "r": body.regime, "f": body.fy_label.strip(),
                "sd": body.standard_deduction, "rb": body.rebate_threshold,
                "c": body.cess_pct,
            },
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        if "tax_regime_config_regime_fy_label_key" in str(e):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Config for {body.regime} / {body.fy_label} already exists",
            )
        raise
    return _get_cfg(db, cid)


@router.patch("/tax-regime-config/{cfg_id}")
def update_regime_config(
    cfg_id: str,
    patch: RegimeConfigUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    existing = _get_cfg(db, cfg_id)
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return existing
    set_parts = [f"{k} = :{k}" for k in fields.keys()]
    params = {"id": cfg_id, **fields}
    db.execute(
        text(f"UPDATE tax_regime_config SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    db.commit()
    return _get_cfg(db, cfg_id)


@router.delete("/tax-regime-config/{cfg_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_regime_config(
    cfg_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_editor(user)
    _get_cfg(db, cfg_id)
    db.execute(
        text("UPDATE tax_regime_config SET is_active = false WHERE id = :id"),
        {"id": cfg_id},
    )
    db.commit()
    return None
