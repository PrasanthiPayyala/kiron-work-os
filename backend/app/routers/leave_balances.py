"""Leave policies + per-employee balance accounting.

Endpoints:
- GET    /leave/policies              list all per-company policies
- GET    /leave/policies/{company_id} list one company's policies
- PUT    /leave/policies/{company_id}/{leave_type}
                                       upsert a policy (HR / super_admin)
- DELETE /leave/policies/{company_id}/{leave_type}
                                       remove a policy (HR / super_admin)
- GET    /leave/balances?user_id=&year=
                                       current balances. Self by default;
                                       HR / super_admin can pass any user_id.
- PATCH  /leave/balances/{balance_id}  adjust an employee's balance
                                       (HR / super_admin only — bumps
                                       the ``adjustment`` column so the
                                       audit story stays clean).
- POST   /leave/balances/initialize    create missing balance rows for
                                       all active users for the current
                                       year, using each user's home
                                       company's policies as the seed.

The auto-deduct on approval lives in app/routers/leave.py — when a
leave_request flips to 'approved', we increment ``used`` by ``days``;
when it flips back from approved → cancelled / rejected we decrement.
"""
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import HR_ROLES, has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/leave", tags=["leave"])

# Types that participate in balance accounting (have a quota). The rest
# (loss_of_pay / work_from_home / optional_holiday) are tracked as
# leave_requests but never decrement a balance.
BALANCED_TYPES = {
    "casual_leave", "sick_leave", "earned_leave",
    "maternity_leave", "paternity_leave", "comp_off",
}
ACCRUAL_KINDS = {"upfront", "monthly"}


class PolicyUpsert(BaseModel):
    annual_quota: float = Field(0, ge=0, le=365)
    carry_forward_max: float = Field(0, ge=0, le=365)
    accrual_kind: str = "upfront"
    is_paid: bool = True
    notes: Optional[str] = None


class BalanceAdjust(BaseModel):
    adjustment: float = Field(..., description="Delta to set the manual adjustment column to (replaces, not adds).")
    note: Optional[str] = None


# ---------- helpers ----------


def _require_hr(user: CurrentUser) -> None:
    if not has_any_role(user.roles, HR_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only HR / super_admin / founder can do this")


def _current_year_ist() -> int:
    """Year in IST so a Jan-1 rollover lands on the right calendar day
    regardless of where the server is. UTC+5:30 hard-coded — same
    convention the rest of the app uses for attendance + reminders."""
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30)))
    return now.year


# ---------- policies ----------


@router.get("/policies")
def list_policies(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Anyone can read — surface so the leave-request UI can hint at quotas
    even for users who can't edit policies."""
    rows = db.execute(
        text("SELECT * FROM leave_policies ORDER BY company_id, leave_type")
    ).mappings().all()
    return [row(r) for r in rows]


@router.put("/policies/{company_id}/{leave_type}", status_code=status.HTTP_200_OK)
def upsert_policy(
    company_id: str,
    leave_type: str,
    body: PolicyUpsert,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_hr(user)
    if leave_type not in BALANCED_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"leave_type must be one of {sorted(BALANCED_TYPES)}",
        )
    if body.accrual_kind not in ACCRUAL_KINDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"accrual_kind must be one of {sorted(ACCRUAL_KINDS)}",
        )
    db.execute(
        text(
            "INSERT INTO leave_policies "
            "  (company_id, leave_type, annual_quota, carry_forward_max, "
            "   accrual_kind, is_paid, notes) "
            "VALUES (:co, :lt, :q, :cf, :ak, :paid, :n) "
            "ON CONFLICT (company_id, leave_type) DO UPDATE SET "
            "  annual_quota      = EXCLUDED.annual_quota, "
            "  carry_forward_max = EXCLUDED.carry_forward_max, "
            "  accrual_kind      = EXCLUDED.accrual_kind, "
            "  is_paid           = EXCLUDED.is_paid, "
            "  notes             = EXCLUDED.notes, "
            "  updated_at        = now()"
        ),
        {
            "co": company_id, "lt": leave_type, "q": body.annual_quota,
            "cf": body.carry_forward_max, "ak": body.accrual_kind,
            "paid": body.is_paid, "n": body.notes,
        },
    )
    db.commit()
    r = db.execute(
        text(
            "SELECT * FROM leave_policies "
            "WHERE company_id = :co AND leave_type = :lt"
        ),
        {"co": company_id, "lt": leave_type},
    ).mappings().first()
    return row(r)


@router.delete("/policies/{company_id}/{leave_type}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(
    company_id: str,
    leave_type: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_hr(user)
    db.execute(
        text("DELETE FROM leave_policies WHERE company_id = :co AND leave_type = :lt"),
        {"co": company_id, "lt": leave_type},
    )
    db.commit()
    return None


# ---------- balances ----------


@router.get("/balances")
def list_balances(
    user_id: Optional[str] = None,
    year: Optional[int] = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_uid = user_id or user.id
    target_year = year or _current_year_ist()
    if target_uid != user.id and not has_any_role(user.roles, HR_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Can only view your own balance")
    rows = db.execute(
        text(
            "SELECT * FROM leave_balances "
            "WHERE user_id = :u AND year = :y "
            "ORDER BY leave_type"
        ),
        {"u": target_uid, "y": target_year},
    ).mappings().all()
    return [
        {
            **row(r),
            "available": float(r["opening"]) + float(r["accrued"]) + float(r["adjustment"]) - float(r["used"]),
        }
        for r in rows
    ]


@router.patch("/balances/{balance_id}")
def adjust_balance(
    balance_id: str,
    body: BalanceAdjust,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_hr(user)
    found = db.execute(
        text("SELECT * FROM leave_balances WHERE id = :id"), {"id": balance_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Balance row not found")
    db.execute(
        text(
            "UPDATE leave_balances SET adjustment = :a, updated_at = now() "
            "WHERE id = :id"
        ),
        {"a": body.adjustment, "id": balance_id},
    )
    db.commit()
    r = db.execute(
        text("SELECT * FROM leave_balances WHERE id = :id"), {"id": balance_id},
    ).mappings().first()
    return {
        **row(r),
        "available": float(r["opening"]) + float(r["accrued"]) + float(r["adjustment"]) - float(r["used"]),
    }


@router.post("/balances/initialize", status_code=status.HTTP_200_OK)
def initialize_balances(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create missing leave_balances rows for every active employee for
    the current IST year, seeded from each employee's home-company
    policy. Idempotent — existing rows aren't touched.

    Intended for:
    - First-time bootstrap right after the migration lands.
    - Year-end rollover (Jan 1) when a scheduled job should call this.
    - HR clicking "Initialize balances" in Settings.

    Returns a summary so HR can see how many rows were created.
    """
    _require_hr(user)
    year = _current_year_ist()

    # All active users + their home_company_id.
    users = db.execute(
        text("SELECT id, home_company_id FROM profiles WHERE is_active = true"),
    ).mappings().all()
    policies = db.execute(
        text("SELECT * FROM leave_policies"),
    ).mappings().all()
    # Index policies by (company_id, leave_type).
    pol_by_co: dict[tuple[str, str], dict] = {}
    for p in policies:
        pol_by_co[(str(p["company_id"]), p["leave_type"])] = dict(p)

    created = 0
    for u in users:
        for lt in BALANCED_TYPES:
            pol = pol_by_co.get((str(u["home_company_id"]), lt))
            quota = float(pol["annual_quota"]) if pol else 0.0
            accrual_kind = pol["accrual_kind"] if pol else "upfront"
            opening = quota if accrual_kind == "upfront" else 0.0
            r = db.execute(
                text(
                    "INSERT INTO leave_balances "
                    "  (user_id, year, leave_type, opening, accrued, used, adjustment) "
                    "VALUES (:u, :y, :lt, :o, 0, 0, 0) "
                    "ON CONFLICT (user_id, year, leave_type) DO NOTHING "
                    "RETURNING id"
                ),
                {"u": str(u["id"]), "y": year, "lt": lt, "o": opening},
            ).first()
            if r is not None:
                created += 1
    db.commit()
    return {"year": year, "created": created}


# ---------- internal helper for the leave router ----------


def apply_balance_delta(db: Session, user_id: str, leave_type: str, days: float, year: int) -> None:
    """Add ``days`` to leave_balances.used for the (user, type, year)
    row. Negative values revert. Creates the row if missing (with
    opening=0) so a leave can still be approved even if Initialize
    hasn't been run yet — the balance will read as "over quota" but
    the request isn't blocked at the DB layer."""
    if leave_type not in BALANCED_TYPES:
        return
    db.execute(
        text(
            "INSERT INTO leave_balances "
            "  (user_id, year, leave_type, opening, used) "
            "VALUES (:u, :y, :lt, 0, :d) "
            "ON CONFLICT (user_id, year, leave_type) DO UPDATE SET "
            "  used       = leave_balances.used + :d, "
            "  updated_at = now()"
        ),
        {"u": user_id, "y": year, "lt": leave_type, "d": days},
    )
