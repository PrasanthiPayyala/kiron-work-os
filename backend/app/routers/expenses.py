"""Expense claims + reimbursements router.

Endpoints:
- GET    /expenses                        list (scoped: self only, or
                                          all for finance / HR / global)
- POST   /expenses                        create (anyone)
- GET    /expenses/{id}                   detail (scoped same as list)
- PATCH  /expenses/{id}                   edit (claimant while
                                          submitted, OR finance always)
- DELETE /expenses/{id}                   delete (claimant while
                                          submitted, OR super_admin)
- POST   /expenses/{id}/approve           HR / finance approves
- POST   /expenses/{id}/reject            HR / finance rejects (with
                                          required reason)
- POST   /expenses/{id}/reimburse         mark reimbursed (records
                                          reference + mode)

Finance / HR roles: super_admin, founder, founder_office_coordinator,
founder_office_support, hr_admin. Same set the rest of ops uses.
"""
import datetime as dt
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/expenses", tags=["expenses"])

FINANCE_ROLES = {
    "super_admin", "founder",
    "founder_office_coordinator", "founder_office_support",
    "hr_admin",
}
ALLOWED_STATUSES = {"submitted", "approved", "rejected", "reimbursed"}


class ExpenseCreate(BaseModel):
    company_id: Optional[str] = None
    category: str = "other"
    description: str = Field(..., min_length=1, max_length=400)
    amount: float = Field(..., gt=0)
    currency: str = "INR"
    expense_date: str   # YYYY-MM-DD
    notes: Optional[str] = None


class ExpenseUpdate(BaseModel):
    company_id: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = Field(None, min_length=1, max_length=400)
    amount: Optional[float] = Field(None, gt=0)
    currency: Optional[str] = None
    expense_date: Optional[str] = None
    notes: Optional[str] = None


class RejectBody(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)


class ReimburseBody(BaseModel):
    reference: Optional[str] = None
    mode: Optional[str] = None
    notes: Optional[str] = None


def _is_finance(user: CurrentUser) -> bool:
    return bool(has_any_role(user.roles, FINANCE_ROLES))


def _get(db: Session, expense_id: str) -> dict:
    r = db.execute(text("SELECT * FROM expense_claims WHERE id = :id"), {"id": expense_id}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense claim not found")
    return row(r)


def _can_view(db: Session, exp: dict, user: CurrentUser) -> bool:
    if _is_finance(user):
        return True
    if str(exp.get("user_id") or "") == user.id:
        return True
    # Managers see their direct reports' claims (read-only).
    rep = db.execute(
        text("SELECT reporting_manager_id FROM profiles WHERE id = :u"),
        {"u": exp["user_id"]},
    ).scalar()
    return str(rep or "") == user.id


def _can_edit(exp: dict, user: CurrentUser) -> bool:
    # Claimant can edit while still submitted. Finance can edit anytime
    # (e.g. to fix a typo on the reference). super_admin always.
    if _is_finance(user):
        return True
    if str(exp.get("user_id") or "") == user.id and exp.get("status") == "submitted":
        return True
    return False


# ---------- endpoints ----------


@router.post("", status_code=status.HTTP_201_CREATED)
def create_expense(
    body: ExpenseCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Default the company to the user's home company if not provided —
    # most claims are billed to the employee's own entity.
    company_id = body.company_id
    if not company_id:
        company_id = db.execute(
            text("SELECT home_company_id FROM profiles WHERE id = :u"),
            {"u": user.id},
        ).scalar()
        company_id = str(company_id) if company_id else None
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO expense_claims ("
            "  id, user_id, company_id, category, description, amount, currency, "
            "  expense_date, notes"
            ") VALUES ("
            "  :id, :u, :co, :cat, :desc, :amt, :cur, :ed, :n"
            ")"
        ),
        {
            "id": new_id, "u": user.id, "co": company_id,
            "cat": body.category, "desc": body.description.strip(),
            "amt": body.amount, "cur": body.currency,
            "ed": body.expense_date, "n": body.notes,
        },
    )
    db.commit()
    return _get(db, new_id)


@router.get("")
def list_expenses(
    status_filter: Optional[str] = Query(None, alias="status"),
    user_id: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Finance / HR / global see all (optionally scoped to one user
    via ?user_id=). Managers see self + their direct reports.
    Everyone else sees self."""
    where = ["1=1"]
    params: dict = {}
    if status_filter:
        if status_filter not in ALLOWED_STATUSES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_STATUSES)}")
        where.append("e.status = :st")
        params["st"] = status_filter

    if _is_finance(user):
        if user_id:
            where.append("e.user_id = :uid")
            params["uid"] = user_id
    else:
        # Non-finance: self + direct reports.
        reports = db.execute(
            text("SELECT id FROM profiles WHERE reporting_manager_id = :u"),
            {"u": user.id},
        ).all()
        ids = [str(r[0]) for r in reports] + [user.id]
        where.append("e.user_id = ANY(:ids)")
        params["ids"] = ids

    rows = db.execute(
        text(
            "SELECT e.* FROM expense_claims e "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 500"
        ),
        params,
    ).mappings().all()
    return [row(r) for r in rows]


@router.get("/{expense_id}")
def get_expense(
    expense_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exp = _get(db, expense_id)
    if not _can_view(db, exp, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this claim")
    return exp


@router.patch("/{expense_id}")
def update_expense(
    expense_id: str,
    patch: ExpenseUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exp = _get(db, expense_id)
    if not _can_edit(exp, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this claim")
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return exp
    set_parts: list[str] = ["updated_at = now()"]
    params: dict = {"id": expense_id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE expense_claims SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return _get(db, expense_id)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exp = _get(db, expense_id)
    is_claimant = str(exp.get("user_id") or "") == user.id
    is_super = "super_admin" in user.roles
    submitted = exp.get("status") == "submitted"
    if not (is_super or (is_claimant and submitted)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the claimant (while submitted) or super_admin can delete")
    db.execute(text("DELETE FROM expense_claims WHERE id = :id"), {"id": expense_id})
    db.commit()
    return None


# ---------- Approval lifecycle ----------


def _stamp_decision(db: Session, expense_id: str, user_id: str, new_status: str, reject_reason: Optional[str] = None) -> None:
    db.execute(
        text(
            "UPDATE expense_claims SET "
            "  status = :s, approver_id = :u, decided_at = now(), "
            "  reject_reason = :r, updated_at = now() "
            "WHERE id = :id"
        ),
        {"s": new_status, "u": user_id, "r": reject_reason, "id": expense_id},
    )


@router.post("/{expense_id}/approve")
def approve_expense(
    expense_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _is_finance(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only finance / HR can approve")
    exp = _get(db, expense_id)
    if exp.get("status") != "submitted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only submitted claims can be approved")
    _stamp_decision(db, expense_id, user.id, "approved", reject_reason=None)
    db.commit()
    return _get(db, expense_id)


@router.post("/{expense_id}/reject")
def reject_expense(
    expense_id: str,
    body: RejectBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _is_finance(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only finance / HR can reject")
    exp = _get(db, expense_id)
    if exp.get("status") not in {"submitted", "approved"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Can only reject submitted or approved claims")
    _stamp_decision(db, expense_id, user.id, "rejected", reject_reason=body.reason.strip())
    db.commit()
    return _get(db, expense_id)


@router.post("/{expense_id}/reimburse")
def reimburse_expense(
    expense_id: str,
    body: ReimburseBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _is_finance(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only finance / HR can reimburse")
    exp = _get(db, expense_id)
    if exp.get("status") != "approved":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only approved claims can be reimbursed")
    db.execute(
        text(
            "UPDATE expense_claims SET "
            "  status = 'reimbursed', reimbursed_at = now(), reimbursed_by = :u, "
            "  reimbursement_reference = :ref, reimbursement_mode = :mode, "
            "  notes = COALESCE(:n, notes), updated_at = now() "
            "WHERE id = :id"
        ),
        {
            "id": expense_id, "u": user.id,
            "ref": body.reference, "mode": body.mode, "n": body.notes,
        },
    )
    db.commit()
    return _get(db, expense_id)


@router.post("/{expense_id}/reopen")
def reopen_expense(
    expense_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Undo a reject/reimburse decision (super_admin only). Useful
    when finance flipped the wrong row."""
    if "super_admin" not in user.roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super_admin can reopen a closed claim")
    _get(db, expense_id)
    db.execute(
        text(
            "UPDATE expense_claims SET "
            "  status = 'submitted', approver_id = NULL, decided_at = NULL, "
            "  reject_reason = NULL, reimbursed_at = NULL, reimbursed_by = NULL, "
            "  reimbursement_reference = NULL, reimbursement_mode = NULL, "
            "  updated_at = now() "
            "WHERE id = :id"
        ),
        {"id": expense_id},
    )
    db.commit()
    return _get(db, expense_id)
