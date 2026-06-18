"""Company finance ledger router.

Unified per-entity cash book. Most rows come in automatically via
app/ledger_link.py from the other finance modules (vendor_payments,
expense_claims reimbursement, payslip payment, compliance filings,
asset purchases). Manual rows cover ad-hoc payees — carpenters,
cleaning ladies, Uber rides, GST late fees, founder-fronted vendor
payments.

Endpoints:
- GET    /ledger                    list (filter by company / dates /
                                    direction / category / source_kind)
- POST   /ledger                    manual entry
- GET    /ledger/{id}               detail
- PATCH  /ledger/{id}               edit (manual rows only — module-
                                    sourced rows edit at their source)
- DELETE /ledger/{id}               delete (manual only)
- POST   /ledger/{id}/reimburse     mark a founder-fronted row
                                    reimbursed; auto-creates paired
                                    OUT entry from a company bank
- POST   /ledger/{id}/reconcile     stamp reconciled_at
- GET    /ledger/summary            per-company per-month rollup
- GET    /ledger/founder-dues       what the company owes each
                                    payer who fronted money

Manage roles: super_admin, founder, founder_office_coordinator,
founder_office_support, hr_admin. Same set as Vendors / Assets /
Compliance.
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
from ..ledger_link import _inr
from ..util import row

router = APIRouter(prefix="/ledger", tags=["ledger"])

LEDGER_MANAGE_ROLES = {
    "super_admin", "founder",
    "founder_office_coordinator", "founder_office_support",
    "hr_admin",
}
ALLOWED_DIRECTIONS = {"in", "out"}
ALLOWED_SOURCE_KINDS = {
    "manual", "vendor_payment", "expense_claim",
    "payslip", "compliance", "asset",
}


# ---------- payload models ----------


class LedgerCreate(BaseModel):
    company_id: str
    txn_date: str  # YYYY-MM-DD
    direction: str = "out"
    amount: float = Field(..., gt=0)
    currency: str = "INR"
    fx_rate: Optional[float] = None
    description: str = Field(..., min_length=1, max_length=400)

    category: str = "other"
    sub_category: Optional[str] = None
    payment_mode: Optional[str] = None

    bank_account_id: Optional[str] = None
    payer_user_id: Optional[str] = None
    source_label: Optional[str] = None

    payee_vendor_id: Optional[str] = None
    payee_user_id: Optional[str] = None
    payee_contact_id: Optional[str] = None
    payee_text: Optional[str] = None
    payee_identifier: Optional[str] = None

    reference: Optional[str] = None
    gst_amount: Optional[float] = None
    hsn_code: Optional[str] = None
    tds_amount: Optional[float] = None
    tds_section: Optional[str] = None

    reimbursable: bool = False
    project_id: Optional[str] = None
    settles_entry_id: Optional[str] = None
    notes: Optional[str] = None


class LedgerUpdate(BaseModel):
    txn_date: Optional[str] = None
    direction: Optional[str] = None
    amount: Optional[float] = Field(None, gt=0)
    currency: Optional[str] = None
    fx_rate: Optional[float] = None
    description: Optional[str] = Field(None, min_length=1, max_length=400)

    category: Optional[str] = None
    sub_category: Optional[str] = None
    payment_mode: Optional[str] = None

    bank_account_id: Optional[str] = None
    payer_user_id: Optional[str] = None
    source_label: Optional[str] = None

    payee_vendor_id: Optional[str] = None
    payee_user_id: Optional[str] = None
    payee_contact_id: Optional[str] = None
    payee_text: Optional[str] = None
    payee_identifier: Optional[str] = None

    reference: Optional[str] = None
    gst_amount: Optional[float] = None
    hsn_code: Optional[str] = None
    tds_amount: Optional[float] = None
    tds_section: Optional[str] = None

    reimbursable: Optional[bool] = None
    project_id: Optional[str] = None
    settles_entry_id: Optional[str] = None
    notes: Optional[str] = None


class ReimburseBody(BaseModel):
    bank_account_id: Optional[str] = None
    source_label: Optional[str] = None
    payment_mode: Optional[str] = "bank_transfer"
    reference: Optional[str] = None
    notes: Optional[str] = None


# ---------- helpers ----------


def _require_manage(user: CurrentUser) -> None:
    if not has_any_role(user.roles, LEDGER_MANAGE_ROLES):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only super_admin / founder / founder's office / HR can use the ledger",
        )


def _get(db: Session, entry_id: str) -> dict:
    r = db.execute(text("SELECT * FROM ledger_entries WHERE id = :id"), {"id": entry_id}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ledger entry not found")
    return row(r)


def _validate_direction(d: str) -> None:
    if d not in ALLOWED_DIRECTIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"direction must be one of {sorted(ALLOWED_DIRECTIONS)}")


# ---------- endpoints ----------


@router.get("")
def list_entries(
    company_id: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    source_kind: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    payer_user_id: Optional[str] = Query(None),
    unreimbursed_only: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    where = ["1=1"]
    params: dict = {"lim": limit}
    if company_id:
        where.append("company_id = :co")
        params["co"] = company_id
    if direction:
        _validate_direction(direction)
        where.append("direction = :dir")
        params["dir"] = direction
    if category:
        where.append("category = :cat")
        params["cat"] = category
    if source_kind:
        if source_kind not in ALLOWED_SOURCE_KINDS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"source_kind must be one of {sorted(ALLOWED_SOURCE_KINDS)}")
        where.append("source_kind = :sk")
        params["sk"] = source_kind
    if date_from:
        where.append("txn_date >= :df")
        params["df"] = date_from
    if date_to:
        where.append("txn_date <= :dt")
        params["dt"] = date_to
    if payer_user_id:
        where.append("payer_user_id = :pu")
        params["pu"] = payer_user_id
    if unreimbursed_only:
        where.append("reimbursable = true AND reimbursed_at IS NULL")

    rows = db.execute(
        text(
            "SELECT * FROM ledger_entries "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY txn_date DESC, created_at DESC LIMIT :lim"
        ),
        params,
    ).mappings().all()
    return [row(r) for r in rows]


@router.get("/summary")
def summary(
    company_id: str = Query(...),
    month: Optional[str] = Query(None, description="YYYY-MM; defaults to current"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-company-per-month rollup. Returns gross IN, gross OUT, net,
    and a by-category breakdown for the OUT side."""
    _require_manage(user)
    if month is None:
        today = dt.date.today()
        month = f"{today.year:04d}-{today.month:02d}"
    try:
        period_start = dt.date.fromisoformat(month + "-01")
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "month must be YYYY-MM")
    # End-of-month: bump month + 1, day = 1, subtract a day.
    if period_start.month == 12:
        next_month = dt.date(period_start.year + 1, 1, 1)
    else:
        next_month = dt.date(period_start.year, period_start.month + 1, 1)
    period_end = next_month - dt.timedelta(days=1)

    totals = db.execute(
        text(
            "SELECT "
            "  COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount_inr END), 0) AS gross_in, "
            "  COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_inr END), 0) AS gross_out "
            "FROM ledger_entries "
            "WHERE company_id = :co AND txn_date BETWEEN :ps AND :pe"
        ),
        {"co": company_id, "ps": period_start, "pe": period_end},
    ).mappings().first()
    by_cat = db.execute(
        text(
            "SELECT category, "
            "       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_inr END), 0) AS out_inr, "
            "       COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount_inr END), 0) AS in_inr, "
            "       COUNT(*) AS rows "
            "FROM ledger_entries "
            "WHERE company_id = :co AND txn_date BETWEEN :ps AND :pe "
            "GROUP BY category ORDER BY out_inr DESC, in_inr DESC"
        ),
        {"co": company_id, "ps": period_start, "pe": period_end},
    ).mappings().all()
    gross_in = float(totals["gross_in"] or 0)
    gross_out = float(totals["gross_out"] or 0)
    return {
        "company_id": company_id,
        "month": month,
        "period_start": str(period_start),
        "period_end": str(period_end),
        "gross_in": gross_in,
        "gross_out": gross_out,
        "net": gross_in - gross_out,
        "by_category": [
            {
                "category": r["category"],
                "out_inr": float(r["out_inr"] or 0),
                "in_inr": float(r["in_inr"] or 0),
                "rows": int(r["rows"]),
            }
            for r in by_cat
        ],
    }


@router.get("/founder-dues")
def founder_dues(
    company_id: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Outstanding amounts owed to each person who fronted money.
    Useful for "how much does Kiron Group owe Prashanti right now"."""
    _require_manage(user)
    where = ["reimbursable = true AND reimbursed_at IS NULL", "payer_user_id IS NOT NULL"]
    params: dict = {}
    if company_id:
        where.append("company_id = :co")
        params["co"] = company_id
    rows = db.execute(
        text(
            "SELECT payer_user_id, "
            "       COALESCE(SUM(amount_inr), 0) AS owed_inr, "
            "       COUNT(*) AS rows "
            "FROM ledger_entries "
            f"WHERE {' AND '.join(where)} "
            "GROUP BY payer_user_id "
            "ORDER BY owed_inr DESC"
        ),
        params,
    ).mappings().all()
    return [
        {
            "payer_user_id": str(r["payer_user_id"]),
            "owed_inr": float(r["owed_inr"] or 0),
            "rows": int(r["rows"]),
        }
        for r in rows
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_entry(
    body: LedgerCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _validate_direction(body.direction)
    amount_inr = _inr(body.amount, body.currency, body.fx_rate)
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO ledger_entries ("
            "  id, company_id, txn_date, direction, "
            "  amount, currency, fx_rate, amount_inr, "
            "  category, sub_category, payment_mode, "
            "  bank_account_id, payer_user_id, source_label, "
            "  payee_vendor_id, payee_user_id, payee_contact_id, "
            "  payee_text, payee_identifier, "
            "  description, reference, "
            "  gst_amount, hsn_code, tds_amount, tds_section, "
            "  reimbursable, project_id, settles_entry_id, notes, "
            "  source_kind, created_by, updated_by"
            ") VALUES ("
            "  :id, :co, :td, :dir, "
            "  :amt, :cur, :fx, :inr, "
            "  :cat, :sub, :mode, "
            "  :ba, :pu, :sl, "
            "  :pv, :py, :pc, "
            "  :pt, :pi, "
            "  :d, :ref, "
            "  :gst, :hsn, :tds, :tdss, "
            "  :reim, :proj, :set, :n, "
            "  'manual', :u, :u"
            ")"
        ),
        {
            "id": new_id, "co": body.company_id, "td": body.txn_date,
            "dir": body.direction,
            "amt": body.amount, "cur": body.currency, "fx": body.fx_rate, "inr": amount_inr,
            "cat": body.category, "sub": body.sub_category, "mode": body.payment_mode,
            "ba": body.bank_account_id, "pu": body.payer_user_id, "sl": body.source_label,
            "pv": body.payee_vendor_id, "py": body.payee_user_id, "pc": body.payee_contact_id,
            "pt": body.payee_text, "pi": body.payee_identifier,
            "d": body.description.strip(), "ref": body.reference,
            "gst": body.gst_amount, "hsn": body.hsn_code,
            "tds": body.tds_amount, "tdss": body.tds_section,
            "reim": body.reimbursable, "proj": body.project_id,
            "set": body.settles_entry_id, "n": body.notes,
            "u": user.id,
        },
    )
    db.commit()
    return _get(db, new_id)


@router.get("/{entry_id}")
def get_entry(
    entry_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    return _get(db, entry_id)


@router.patch("/{entry_id}")
def update_entry(
    entry_id: str,
    patch: LedgerUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    existing = _get(db, entry_id)
    if existing.get("source_kind") != "manual":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Module-sourced entries edit at their source. Open the linked vendor payment / expense claim / payslip instead.",
        )
    fields = patch.model_dump(exclude_unset=True)
    if "direction" in fields:
        _validate_direction(fields["direction"])

    # Recompute amount_inr if any of (amount, currency, fx_rate) changed.
    money_changed = any(k in fields for k in ("amount", "currency", "fx_rate"))
    if money_changed:
        amount = fields.get("amount", existing["amount"])
        currency = fields.get("currency", existing["currency"])
        fx_rate = fields.get("fx_rate", existing["fx_rate"])
        fields["amount_inr"] = _inr(amount, currency, fx_rate)

    if not fields:
        return existing

    set_parts: list[str] = ["updated_by = :u", "updated_at = now()"]
    params: dict = {"id": entry_id, "u": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE ledger_entries SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get(db, entry_id)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    existing = _get(db, entry_id)
    if existing.get("source_kind") != "manual":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Module-sourced entries delete at their source — delete the vendor payment / expense / payslip instead.",
        )
    db.execute(text("DELETE FROM ledger_entries WHERE id = :id"), {"id": entry_id})
    db.commit()
    return None


@router.post("/{entry_id}/reimburse")
def reimburse_entry(
    entry_id: str,
    body: ReimburseBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stamp reimbursed on a founder-fronted row AND create a paired
    OUT entry from the company bank that source-links back to this
    row via settles_entry_id. So Founder dues drop and the bank
    cash-out shows in the same view."""
    _require_manage(user)
    existing = _get(db, entry_id)
    if not existing.get("reimbursable"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a reimbursable entry")
    if existing.get("reimbursed_at") is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Already reimbursed")
    if existing.get("payer_user_id") is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing payer — set who fronted the money before reimbursing")

    # Stamp the original.
    db.execute(
        text(
            "UPDATE ledger_entries SET "
            "  reimbursed_at = now(), reimbursed_by = :u, updated_at = now() "
            "WHERE id = :id"
        ),
        {"u": user.id, "id": entry_id},
    )

    # Paired bank-out entry, sub_category=reimbursement to make the
    # by-category summary clean. amount_inr mirrors the original.
    paired_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO ledger_entries ("
            "  id, company_id, txn_date, direction, "
            "  amount, currency, fx_rate, amount_inr, "
            "  category, sub_category, payment_mode, "
            "  bank_account_id, source_label, "
            "  payee_user_id, "
            "  description, reference, notes, "
            "  source_kind, settles_entry_id, "
            "  created_by, updated_by"
            ") VALUES ("
            "  :id, :co, CURRENT_DATE, 'out', "
            "  :amt, :cur, :fx, :inr, "
            "  'reimbursement', :sub, :mode, "
            "  :ba, :sl, "
            "  :payee, "
            "  :d, :ref, :n, "
            "  'manual', :settles, "
            "  :u, :u"
            ")"
        ),
        {
            "id": paired_id, "co": existing["company_id"],
            "amt": existing["amount"], "cur": existing["currency"],
            "fx": existing["fx_rate"], "inr": existing["amount_inr"],
            "sub": "reimbursement",
            "mode": body.payment_mode,
            "ba": body.bank_account_id, "sl": body.source_label,
            "payee": existing["payer_user_id"],
            "d": f"Reimbursement to payer for: {existing['description']}",
            "ref": body.reference, "n": body.notes,
            "settles": entry_id, "u": user.id,
        },
    )
    db.commit()
    return _get(db, entry_id)


@router.post("/{entry_id}/reconcile")
def reconcile_entry(
    entry_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manage(user)
    _get(db, entry_id)
    db.execute(
        text(
            "UPDATE ledger_entries SET "
            "  reconciled_at = CASE WHEN reconciled_at IS NULL THEN now() ELSE NULL END, "
            "  updated_by = :u, updated_at = now() "
            "WHERE id = :id"
        ),
        {"u": user.id, "id": entry_id},
    )
    db.commit()
    return _get(db, entry_id)
