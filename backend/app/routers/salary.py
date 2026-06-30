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
from ..ledger_link import upsert_ledger_for_source
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
    # PF scheme drives the deduction the payroll-run generator computes:
    #   none           — employee opted out, pf_employee = 0
    #   standard_12pct — 12% of basic (no cap), both halves
    #   capped_15000   — 12% of min(basic, 15000) — statutory ceiling
    pf_scheme: str = "none"
    # ESI eligibility:
    #   auto             — deduct 0.75% + 3.25% iff gross <= 21,000
    #   force_eligible   — always deduct regardless of gross
    #   force_ineligible — never deduct (employee has own cover, etc.)
    esi_eligibility: str = "auto"
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
    pf_scheme: Optional[str] = None
    esi_eligibility: Optional[str] = None
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

ALLOWED_PF_SCHEMES = {"none", "standard_12pct", "capped_15000"}
ALLOWED_ESI_ELIGIBILITIES = {"auto", "force_eligible", "force_ineligible"}

# ESI is statutorily applicable only when monthly gross is at or below
# this threshold. ?21,000 is the current cap (?25,000 for disabled —
# not modelled; HR uses force_eligible if needed).
ESI_GROSS_CEILING = 21000.0
ESI_EMPLOYEE_RATE = 0.0075   # 0.75%
ESI_EMPLOYER_RATE = 0.0325   # 3.25%
PF_RATE = 0.12               # 12% — both halves
PF_STATUTORY_CAP_BASIC = 15000.0


def _compute_totals(row: dict) -> tuple[float, float, float]:
    gross = sum(float(row.get(c) or 0) for c in _EARNINGS_COLS)
    deds = sum(float(row.get(c) or 0) for c in _DEDUCTION_COLS)
    return gross, deds, gross - deds


def _compute_pf(basic: float, scheme: str | None) -> tuple[float, float]:
    """Returns (employee_pf, employer_pf). Both halves use the same rate.

    Schemes:
      none           -> (0, 0)
      standard_12pct -> 12% of basic
      capped_15000   -> 12% of min(basic, 15000)
    Unknown scheme falls back to 'none' so a bad row never breaks the run.
    """
    if scheme == "standard_12pct":
        amt = round(float(basic or 0) * PF_RATE, 2)
        return (amt, amt)
    if scheme == "capped_15000":
        capped = min(float(basic or 0), PF_STATUTORY_CAP_BASIC)
        amt = round(capped * PF_RATE, 2)
        return (amt, amt)
    return (0.0, 0.0)


def _compute_esi(gross: float, eligibility: str | None) -> tuple[float, float]:
    """Returns (employee_esi, employer_esi)."""
    if eligibility == "force_ineligible":
        return (0.0, 0.0)
    if eligibility == "force_eligible" or (
        eligibility == "auto" and float(gross or 0) <= ESI_GROSS_CEILING
    ):
        emp = round(float(gross or 0) * ESI_EMPLOYEE_RATE, 2)
        er = round(float(gross or 0) * ESI_EMPLOYER_RATE, 2)
        return (emp, er)
    return (0.0, 0.0)


def _lookup_pt(db: Session, state: str | None, gross: float) -> float:
    """Find the matching active PT slab for (state, gross). Returns 0
    when no state is configured on the company or no slab matches."""
    if not state:
        return 0.0
    found = db.execute(
        text(
            "SELECT amount FROM pt_slabs "
            "WHERE is_active = true AND state = :s "
            "  AND min_gross <= :g "
            "  AND (max_gross IS NULL OR max_gross > :g) "
            "ORDER BY min_gross DESC LIMIT 1"
        ),
        {"s": state, "g": float(gross or 0)},
    ).first()
    return float(found[0]) if found else 0.0


# ----- TDS (auto-computed) -----
# Indian financial year runs April 1 -> March 31. A YYYY-MM payroll
# period in April-December belongs to FY YYYY-(YYYY+1); January-March
# belongs to FY (YYYY-1)-YYYY. The fy_label format mirrors the seed
# in migration 0036: "FY 2025-26".


def _fy_label_for_period(period: str) -> str:
    """Return the financial-year label for a YYYY-MM payroll period."""
    year, mon = int(period[:4]), int(period[5:7])
    if mon >= 4:
        start_year = year
    else:
        start_year = year - 1
    end_yy = (start_year + 1) % 100
    return f"FY {start_year}-{end_yy:02d}"


def _fy_bounds(fy_label: str) -> tuple[dt.date, dt.date]:
    """Return (fy_start, fy_end) inclusive for a label like 'FY 2025-26'."""
    # "FY 2025-26" -> 2025
    start_year = int(fy_label.split()[1].split("-")[0])
    return dt.date(start_year, 4, 1), dt.date(start_year + 1, 3, 31)


def _months_between_inclusive(start: dt.date, end: dt.date) -> int:
    """Whole-month count between two dates, inclusive of both endpoints.
    Used for 'how many monthly TDS slices left in this FY?' math."""
    if end < start:
        return 0
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


def _slab_tax(annual_taxable: float, slabs: list[dict]) -> float:
    """Walk an ordered list of {min_income, max_income, rate_pct} dicts
    and sum the per-slab tax. Caller supplies slabs already sorted by
    min_income ascending. Open-ended top slab has max_income = None."""
    if annual_taxable <= 0 or not slabs:
        return 0.0
    tax = 0.0
    for s in slabs:
        lo = float(s["min_income"])
        hi = float(s["max_income"]) if s.get("max_income") is not None else float("inf")
        if annual_taxable <= lo:
            break
        slice_top = min(annual_taxable, hi)
        tax += (slice_top - lo) * (float(s["rate_pct"]) / 100.0)
    return tax


def _compute_tds(
    db: Session,
    monthly_gross: float,
    regime: str | None,
    doj: dt.date | None,
    period: str,
) -> float:
    """Returns the monthly TDS to deduct on this period's payslip.

    Steps:
      1. Derive FY label from the period.
      2. Annualise: monthly_gross * working_months_in_fy. For mid-year
         joiners (doj after FY start) working_months = months between
         join and FY end, inclusive.
      3. Subtract standard deduction => annual_taxable.
      4. Apply slabs => annual_tax_before_rebate.
      5. If annual_taxable <= rebate_threshold, zero the tax (87A).
      6. Multiply by (1 + cess/100).
      7. Divide by months remaining in FY from this period (inclusive).

    Returns 0 when no slab/config is configured for the (regime, FY) —
    HR can then either configure it or fill TDS manually per payslip.
    """
    if not regime:
        return 0.0
    regime = regime.strip()
    fy_label = _fy_label_for_period(period)
    fy_start, fy_end = _fy_bounds(fy_label)

    cfg = db.execute(
        text(
            "SELECT standard_deduction, rebate_threshold, cess_pct "
            "FROM tax_regime_config "
            "WHERE regime = :r AND fy_label = :f AND is_active = true"
        ),
        {"r": regime, "f": fy_label},
    ).mappings().first()
    if not cfg:
        return 0.0

    slabs = db.execute(
        text(
            "SELECT min_income, max_income, rate_pct "
            "FROM tax_slabs "
            "WHERE regime = :r AND fy_label = :f AND is_active = true "
            "ORDER BY min_income ASC"
        ),
        {"r": regime, "f": fy_label},
    ).mappings().all()
    if not slabs:
        return 0.0

    # Working months in this FY for the employee. Joined before FY start
    # (or no DOJ on file) -> 12. Joined during FY -> from join month to
    # FY end.
    eff_join = max(doj, fy_start) if doj else fy_start
    working_months = _months_between_inclusive(
        dt.date(eff_join.year, eff_join.month, 1), fy_end,
    )
    if working_months <= 0:
        return 0.0

    annual_gross = float(monthly_gross or 0) * working_months
    std_ded = float(cfg["standard_deduction"] or 0)
    annual_taxable = max(0.0, annual_gross - std_ded)

    tax = _slab_tax(annual_taxable, [dict(s) for s in slabs])

    rebate = cfg.get("rebate_threshold")
    if rebate is not None and annual_taxable <= float(rebate):
        tax = 0.0

    cess_pct = float(cfg.get("cess_pct") or 0)
    annual_tax_with_cess = tax * (1 + cess_pct / 100.0)

    # Spread across months remaining in the FY (inclusive of `period`).
    # First-of-FY -> ~ /12. Mid-year setup -> /smaller, so any unpaid
    # tax catches up across what's left.
    period_first = dt.date(int(period[:4]), int(period[5:7]), 1)
    months_left = _months_between_inclusive(period_first, fy_end)
    if months_left <= 0:
        return 0.0
    return round(annual_tax_with_cess / months_left, 2)


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
    if body.pf_scheme not in ALLOWED_PF_SCHEMES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"pf_scheme must be one of {sorted(ALLOWED_PF_SCHEMES)}")
    if body.esi_eligibility not in ALLOWED_ESI_ELIGIBILITIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"esi_eligibility must be one of {sorted(ALLOWED_ESI_ELIGIBILITIES)}")
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
            "  tds_regime, pf_scheme, esi_eligibility, notes, created_by, updated_by"
            ") VALUES ("
            "  :id, :u, :ef, "
            "  :basic, :hra, :con, :med, :lta, :sa, :oe, "
            "  :epf, :eesi, :eo, "
            "  :reg, :pfs, :esie, :n, :cb, :cb"
            ")"
        ),
        {
            "id": new_id, "u": body.user_id, "ef": eff,
            "basic": body.basic, "hra": body.hra, "con": body.conveyance,
            "med": body.medical, "lta": body.lta, "sa": body.special_allowance,
            "oe": body.other_earnings, "epf": body.employer_pf,
            "eesi": body.employer_esi, "eo": body.employer_other,
            "reg": body.tds_regime, "pfs": body.pf_scheme,
            "esie": body.esi_eligibility, "n": body.notes, "cb": user.id,
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
    if "pf_scheme" in fields and fields["pf_scheme"] not in ALLOWED_PF_SCHEMES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"pf_scheme must be one of {sorted(ALLOWED_PF_SCHEMES)}")
    if "esi_eligibility" in fields and fields["esi_eligibility"] not in ALLOWED_ESI_ELIGIBILITIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"esi_eligibility must be one of {sorted(ALLOWED_ESI_ELIGIBILITIES)}")
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
    # skipped (HR can add them later via individual create). DOJ comes
    # along for TDS mid-year-joiner proration.
    rows = db.execute(
        text(
            "SELECT p.id AS user_id, p.doj AS doj, s.* "
            "FROM profiles p "
            "JOIN salary_structures s "
            "  ON s.user_id = p.id AND s.effective_to IS NULL "
            "WHERE p.home_company_id = :co AND p.is_active = true"
        ),
        {"co": body.company_id},
    ).mappings().all()

    # Company-level PT state drives the Professional Tax slab lookup.
    co_row = db.execute(
        text("SELECT pt_state FROM companies WHERE id = :id"),
        {"id": body.company_id},
    ).mappings().first()
    pt_state = (co_row or {}).get("pt_state")

    for r in rows:
        gross = sum(float(r.get(c) or 0) for c in _EARNINGS_COLS)
        # Pre-compute PF / ESI / PT / TDS from structure + reference
        # tables. HR can still manually override any cell on the draft
        # payslip before finalizing; this just primes it with the right
        # numbers so they don't retype them every month.
        pf_emp, pf_er = _compute_pf(float(r["basic"] or 0), r.get("pf_scheme"))
        esi_emp, esi_er = _compute_esi(gross, r.get("esi_eligibility"))
        pt = _lookup_pt(db, pt_state, gross)
        tds = _compute_tds(db, gross, r.get("tds_regime"), r.get("doj"), body.period)
        total_ded = pf_emp + esi_emp + pt + tds   # other_deductions stays 0; HR fills if needed
        net = max(0.0, gross - total_ded)

        db.execute(
            text(
                "INSERT INTO payslips ("
                "  id, payroll_run_id, user_id, period, "
                "  basic, hra, conveyance, medical, lta, special_allowance, other_earnings, "
                "  gross_earnings, "
                "  pf_employee, esi_employee, pt_employee, tds, other_deductions, "
                "  employer_pf, employer_esi, "
                "  total_deductions, net_pay"
                ") VALUES ("
                "  :id, :run, :u, :p, "
                "  :basic, :hra, :con, :med, :lta, :sa, :oe, "
                "  :gross, "
                "  :pf_emp, :esi_emp, :pt, :tds, 0, "
                "  :pf_er, :esi_er, "
                "  :td, :net"
                ")"
            ),
            {
                "id": str(uuid.uuid4()), "run": new_id, "u": str(r["user_id"]),
                "p": body.period,
                "basic": r["basic"], "hra": r["hra"], "con": r["conveyance"],
                "med": r["medical"], "lta": r["lta"], "sa": r["special_allowance"],
                "oe": r["other_earnings"], "gross": gross,
                "pf_emp": pf_emp, "esi_emp": esi_emp, "pt": pt, "tds": tds,
                "pf_er": pf_er, "esi_er": esi_er,
                "td": total_ded, "net": net,
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

    # Mirror each newly-paid payslip into the company ledger as an
    # individual OUT entry. We pull every paid payslip in this run
    # (not just newly-flipped ones) so re-running mark-paid keeps the
    # ledger consistent — the helper's ON CONFLICT branch is idempotent.
    paid_rows = db.execute(
        text(
            "SELECT id, user_id, net_pay, payment_mode, payment_reference, period "
            "FROM payslips WHERE payroll_run_id = :id AND status = 'paid'"
        ),
        {"id": rid},
    ).mappings().all()
    for p in paid_rows:
        if not p["net_pay"] or float(p["net_pay"]) <= 0:
            continue
        upsert_ledger_for_source(
            db,
            source_kind="payslip", source_id=str(p["id"]),
            company_id=str(run["company_id"]),
            txn_date=str(dt.datetime.now(dt.timezone.utc).date()),
            direction="out",
            amount=float(p["net_pay"]),
            currency="INR",
            description=f"Salary {p['period']}",
            category="salary",
            payment_mode=p.get("payment_mode"),
            payee_user_id=str(p["user_id"]),
            reference=p.get("payment_reference"),
            created_by=user.id,
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

    # Mirror into the ledger. The payroll run carries the company_id.
    run = _get_run(db, str(ps["payroll_run_id"]))
    fresh = _get_payslip(db, pid)
    if fresh["net_pay"] and float(fresh["net_pay"]) > 0:
        upsert_ledger_for_source(
            db,
            source_kind="payslip", source_id=pid,
            company_id=str(run["company_id"]),
            txn_date=str(dt.datetime.now(dt.timezone.utc).date()),
            direction="out",
            amount=float(fresh["net_pay"]),
            currency="INR",
            description=f"Salary {fresh['period']}",
            category="salary",
            payment_mode=fresh.get("payment_mode"),
            payee_user_id=str(fresh["user_id"]),
            reference=fresh.get("payment_reference"),
            created_by=user.id,
        )

    db.commit()
    return _get_payslip(db, pid)
