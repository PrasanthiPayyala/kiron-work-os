"""Salary / Payroll router.

Endpoints:

- GET   /salary/structures                        list all (manage)
- GET   /salary/structures/{user_id}/current      one user's active row
- POST  /salary/structures                        create/promote a new
                                                  version (stamps the
                                                  prior current row's
                                                  effective_to)
- PATCH /salary/structures/{id}                   correct an existing
                                                  row (no version bump)

- GET   /salary/payroll-runs                      list (manage)
- POST  /salary/payroll-runs                      create + auto-generate
                                                  payslips for every
                                                  active employee in
                                                  the company
- PATCH /salary/payroll-runs/{id}                 update notes / status
- POST  /salary/payroll-runs/{id}/finalize        lock the run + each
                                                  payslip
- POST  /salary/payroll-runs/{id}/mark-paid       set status=paid on
                                                  the run + every
                                                  un-paid payslip
- DELETE /salary/payroll-runs/{id}                only while 'draft'

- GET   /salary/payslips                          self by default; HR
                                                  can pass ?run_id= or
                                                  ?user_id= to filter
- GET   /salary/payslips/{id}                     detail
- PATCH /salary/payslips/{id}                     edit (manage only,
                                                  recomputes totals)
- POST  /salary/payslips/{id}/mark-paid           individual pay action

Manage roles: super_admin, founder, founder_office_coordinator,
hr_admin. NOT founder_office_support — payroll is sensitive.
"""
import datetime as dt
import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/salary", tags=["salary"])

SALARY_MANAGE_ROLES = {
    "super_admin", "founder", "founder_office_coordinator", "hr_admin",
}
ALLOWED_REGIMES = {"old", "new"}
ALLOWED_STATUSES = {"draft", "finalized", "paid"}


# ----- payloads -----


class StructureCreate(BaseModel):
    user_id: str
    effective_from: str  # YYYY-MM-DD
    basic: float = 0
    hra: float = 0
    conveyance: float = 0
    medical: float = 0
    lta: float = 0
    special_allowance: float = 0
    other_earnings: float = 0
    employer_pf: float = 0
    employer_esi: float = 0
    employer_other: float = 0
    tds_regime: str = "new"
    notes: Optional[str] = None


class StructureUpdate(BaseModel):
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    basic: Optional[float] = None
    hra: Optional[float] = None
    conveyance: Optional[float] = None
    medical: Optional[float] = None
    lta: Optional[float] = None
    special_allowance: Optional[float] = None
    other_earnings: Optional[float] = None
    employer_pf: Optional[float] = None
    employer_esi: Optional[float] = None
    employer_other: Optional[float] = None
    tds_regime: Optional[str] = None
    notes: Optional[str] = None


class RunCreate(BaseModel):
    company_id: str
    period: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    notes: Optional[str] = None


class RunUpdate(BaseModel):
    notes: Optional[str] = None


class PayslipUpdate(BaseModel):
    basic: Optional[float] = None
    hra: Optional[float] = None
    conveyance: Optional[float] = None
    medical: Optional[float] = None
    lta: Optional[float] = None
    special_allowance: Optional[float] = None
    other_earnings: Optional[float] = None
    pf_employee: Optional[float] = None
    esi_employee: Optional[float] = None
    pt_employee: Optional[float] = None
    tds: Optional[float] = None
    other_deductions: Optional[float] = None
    notes: Optional[str] = None


class MarkPaidBody(BaseModel):
    payment_reference: Optional[str] = None
    payment_mode: Optional[str] = None


# ----- helpers -----


def _require_manage(user: CurrentUser) -> None:
    if not has_any_role(user.roles, SALARY_MANAGE_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super_admin / founder / founder's office coordinator / HR")


def _get_structure(db: Session, sid: str) -> dict:
    r = db.execute(text("SELECT * FROM salary_structures WHERE id = :id"), {"id": sid}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Salary structure not found")
    return row(r)


def _get_run(db: Session, rid: str) -> dict:
    r = db.execute(text("SELECT * FROM payroll_runs WHERE id = :id"), {"id": rid}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payroll run not found")
    return row(r)


def _get_payslip(db: Session, pid: str) -> dict:
    r = db.execute(text("SELECT * FROM payslips WHERE id = :id"), {"id": pid}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payslip not found")
    return row(r)


_EARNINGS_COLS = ("basic", "hra", "conveyance", "medical", "lta", "special_allowance", "other_earnings")
_DEDUCTION_COLS = ("pf_employee", "esi_employee", "pt_employee", "tds", "other_deductions")


def _compute_totals(row: dict) -> tuple[float, float, float]:
    gross = sum(float(row.get(c) or 0) for c in _EARNINGS_COLS)
    deds = sum(float(row.get(c) or 0) for c in _DEDUCTION_COLS)
    return gross, deds, gross - deds


# ----- Salary structures -----


@router.get("/structures")
def list_structures(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    rows = db.execute(
        text(
            "SELECT * FROM salary_structures "
            "ORDER BY user_id, effective_from DESC"
        )
    ).mappings().all()
    return [row(r) for r in rows]


@router.get("/structures/{user_id}/current")
def get_current_structure(
    user_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Self or manager (per the rest of the app pattern). Employees can
    # see their own current structure — useful to confirm what HR set.
    if user_id != user.id and not has_any_role(user.roles, SALARY_MANAGE_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Can only view your own salary structure")
    r = db.execute(
        text(
            "SELECT * FROM salary_structures "
            "WHERE user_id = :u AND effective_to IS NULL "
            "LIMIT 1"
        ),
        {"u": user_id},
    ).mappings().first()
    if not r:
        return None
    return row(r)


@router.post("/structures", status_code=status.HTTP_201_CREATED)
def create_structure(
    body: StructureCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Promote a new version. The prior 'current' row (if any) gets
    its effective_to stamped to (effective_from - 1 day) so the unique
    index on (user_id WHERE effective_to IS NULL) doesn't trip."""
    _require_manage(user)
    if body.tds_regime not in ALLOWED_REGIMES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"tds_regime must be one of {sorted(ALLOWED_REGIMES)}")
    try:
        eff = dt.date.fromisoformat(body.effective_from)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "effective_from must be YYYY-MM-DD")

    db.execute(
        text(
            "UPDATE salary_structures SET effective_to = :end "
            "WHERE user_id = :u AND effective_to IS NULL"
        ),
        {"end": eff - dt.timedelta(days=1), "u": body.user_id},
    )
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO salary_structures ("
            "  id, user_id, effective_from, "
            "  basic, hra, conveyance, medical, lta, special_allowance, other_earnings, "
            "  employer_pf, employer_esi, employer_other, "
            "  tds_regime, notes, created_by, updated_by"
            ") VALUES ("
            "  :id, :u, :ef, "
            "  :basic, :hra, :con, :med, :lta, :sa, :oe, "
            "  :epf, :eesi, :eo, "
            "  :reg, :n, :cb, :cb"
            ")"
        ),
        {
            "id": new_id, "u": body.user_id, "ef": eff,
            "basic": body.basic, "hra": body.hra, "con": body.conveyance,
            "med": body.medical, "lta": body.lta, "sa": body.special_allowance,
            "oe": body.other_earnings, "epf": body.employer_pf,
            "eesi": body.employer_esi, "eo": body.employer_other,
            "reg": body.tds_regime, "n": body.notes, "cb": user.id,
        },
    )
    db.commit()
    return _get_structure(db, new_id)


@router.patch("/structures/{sid}")
def update_structure(
    sid: str,
    patch: StructureUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_structure(db, sid)
    fields = patch.model_dump(exclude_unset=True)
    if "tds_regime" in fields and fields["tds_regime"] not in ALLOWED_REGIMES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"tds_regime must be one of {sorted(ALLOWED_REGIMES)}")
    if not fields:
        return _get_structure(db, sid)
    set_parts: list[str] = ["updated_by = :u", "updated_at = now()"]
    params: dict = {"id": sid, "u": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE salary_structures SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get_structure(db, sid)


# ----- Payroll runs -----


@router.get("/payroll-runs")
def list_runs(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    rows = db.execute(
        text("SELECT * FROM payroll_runs ORDER BY period DESC, created_at DESC")
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/payroll-runs", status_code=status.HTTP_201_CREATED)
def create_run(
    body: RunCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create the run + generate one draft payslip per active
    employee in the company using their current salary structure."""
    _require_manage(user)
    # Reject duplicate runs early with a friendly error.
    dup = db.execute(
        text("SELECT id FROM payroll_runs WHERE company_id = :co AND period = :p"),
        {"co": body.company_id, "p": body.period},
    ).first()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, "A payroll run already exists for this company + month")

    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO payroll_runs (id, company_id, period, notes, created_by) "
            "VALUES (:id, :co, :p, :n, :cb)"
        ),
        {"id": new_id, "co": body.company_id, "p": body.period, "n": body.notes, "cb": user.id},
    )

    # Generate payslips. Pull (employee, structure) joined for the
    # company. Inactive employees + employees without a structure are
    # skipped (HR can add them later via individual create).
    rows = db.execute(
        text(
            "SELECT p.id AS user_id, s.* "
            "FROM profiles p "
            "JOIN salary_structures s "
            "  ON s.user_id = p.id AND s.effective_to IS NULL "
            "WHERE p.home_company_id = :co AND p.is_active = true"
        ),
        {"co": body.company_id},
    ).mappings().all()

    for r in rows:
        gross = sum(float(r.get(c) or 0) for c in _EARNINGS_COLS)
        db.execute(
            text(
                "INSERT INTO payslips ("
                "  id, payroll_run_id, user_id, period, "
                "  basic, hra, conveyance, medical, lta, special_allowance, other_earnings, "
                "  gross_earnings, "
                "  pf_employee, esi_employee, pt_employee, tds, other_deductions, "
                "  total_deductions, net_pay"
                ") VALUES ("
                "  :id, :run, :u, :p, "
                "  :basic, :hra, :con, :med, :lta, :sa, :oe, "
                "  :gross, 0, 0, 0, 0, 0, 0, :gross"
                ")"
            ),
            {
                "id": str(uuid.uuid4()), "run": new_id, "u": str(r["user_id"]),
                "p": body.period,
                "basic": r["basic"], "hra": r["hra"], "con": r["conveyance"],
                "med": r["medical"], "lta": r["lta"], "sa": r["special_allowance"],
                "oe": r["other_earnings"], "gross": gross,
            },
        )

    db.commit()
    return {**_get_run(db, new_id), "payslips_generated": len(rows)}


@router.patch("/payroll-runs/{rid}")
def update_run(
    rid: str,
    body: RunUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get_run(db, rid)
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return _get_run(db, rid)
    set_parts = [f"{k} = :{k}" for k in fields]
    params = {"id": rid, **fields}
    db.execute(text(f"UPDATE payroll_runs SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get_run(db, rid)


@router.delete("/payroll-runs/{rid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_run(
    rid: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    run = _get_run(db, rid)
    if run.get("status") != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only draft runs can be deleted")
    db.execute(text("DELETE FROM payroll_runs WHERE id = :id"), {"id": rid})
    db.commit()
    return None


@router.post("/payroll-runs/{rid}/finalize")
def finalize_run(
    rid: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    run = _get_run(db, rid)
    if run.get("status") != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only draft runs can be finalized")
    db.execute(
        text(
            "UPDATE payroll_runs SET "
            "  status = 'finalized', finalized_at = now(), finalized_by = :u "
            "WHERE id = :id"
        ),
        {"id": rid, "u": user.id},
    )
    db.execute(
        text(
            "UPDATE payslips SET status = 'finalized' "
            "WHERE payroll_run_id = :id AND status = 'draft'"
        ),
        {"id": rid},
    )
    db.commit()
    return _get_run(db, rid)


@router.post("/payroll-runs/{rid}/mark-paid")
def mark_run_paid(
    rid: str,
    body: MarkPaidBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    run = _get_run(db, rid)
    if run.get("status") not in {"finalized", "paid"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Finalize the run before marking it paid")
    db.execute(
        text(
            "UPDATE payroll_runs SET "
            "  status = 'paid', paid_at = now(), paid_by = :u "
            "WHERE id = :id"
        ),
        {"id": rid, "u": user.id},
    )
    # Apply to any payslips still un-paid in this run.
    db.execute(
        text(
            "UPDATE payslips SET "
            "  status = 'paid', paid_at = now(), paid_by = :u, "
            "  payment_reference = COALESCE(:ref, payment_reference), "
            "  payment_mode = COALESCE(:mode, payment_mode) "
            "WHERE payroll_run_id = :id AND status <> 'paid'"
        ),
        {"id": rid, "u": user.id, "ref": body.payment_reference, "mode": body.payment_mode},
    )
    db.commit()
    return _get_run(db, rid)


# ----- Payslips -----


@router.get("/payslips")
def list_payslips(
    run_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manage roles can pass either filter. Everyone else only sees
    their own payslips (latest 12 months)."""
    is_manage = has_any_role(user.roles, SALARY_MANAGE_ROLES)
    where = ["1=1"]
    params: dict = {}
    if not is_manage:
        # Self only — but also block if status is still 'draft' so an
        # employee doesn't see in-flight numbers HR is still adjusting.
        where.append("user_id = :uid")
        where.append("status <> 'draft'")
        params["uid"] = user.id
    else:
        if user_id:
            where.append("user_id = :uid")
            params["uid"] = user_id
        if run_id:
            where.append("payroll_run_id = :rid")
            params["rid"] = run_id

    rows = db.execute(
        text(
            "SELECT * FROM payslips "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY period DESC, created_at DESC LIMIT 500"
        ),
        params,
    ).mappings().all()
    return [row(r) for r in rows]


@router.get("/payslips/{pid}")
def get_payslip(
    pid: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ps = _get_payslip(db, pid)
    if not has_any_role(user.roles, SALARY_MANAGE_ROLES):
        if str(ps.get("user_id") or "") != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
        if ps.get("status") == "draft":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This payslip is still in draft")
    return ps


@router.patch("/payslips/{pid}")
def update_payslip(
    pid: str,
    patch: PayslipUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    ps = _get_payslip(db, pid)
    if ps.get("status") == "paid":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Can't edit a paid payslip — reopen the run first")

    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return ps

    # Apply changes, then recompute totals.
    new = {**ps, **fields}
    gross, deds, net = _compute_totals(new)
    fields["gross_earnings"] = gross
    fields["total_deductions"] = deds
    fields["net_pay"] = net

    set_parts = [f"{k} = :{k}" for k in fields]
    params = {"id": pid, **fields}
    db.execute(text(f"UPDATE payslips SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get_payslip(db, pid)


@router.post("/payslips/{pid}/mark-paid")
def mark_payslip_paid(
    pid: str,
    body: MarkPaidBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    ps = _get_payslip(db, pid)
    if ps.get("status") not in {"finalized", "paid"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Finalize the payslip before marking it paid")
    db.execute(
        text(
            "UPDATE payslips SET "
            "  status = 'paid', paid_at = now(), paid_by = :u, "
            "  payment_reference = COALESCE(:ref, payment_reference), "
            "  payment_mode = COALESCE(:mode, payment_mode) "
            "WHERE id = :id"
        ),
        {"id": pid, "u": user.id, "ref": body.payment_reference, "mode": body.payment_mode},
    )
    db.commit()
    return _get_payslip(db, pid)
