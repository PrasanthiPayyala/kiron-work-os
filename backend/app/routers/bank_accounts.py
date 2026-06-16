"""Company bank accounts CRUD.

Bank account info is sensitive finance data — view and edit are both
gated by `can_edit_company_finance` (super_admin / founder /
founder_office_coordinator). HR cannot see or edit. Table created in
migration 0010.

Endpoints (all under the company they belong to):
    GET    /companies/{id}/bank-accounts
    POST   /companies/{id}/bank-accounts
    PATCH  /bank-accounts/{account_id}
    DELETE /bank-accounts/{account_id}
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_edit_company_finance
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(tags=["bank_accounts"])


def _require_finance(user: CurrentUser) -> None:
    if not can_edit_company_finance(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view or edit bank accounts")


def _company_or_404(db: Session, company_id: str) -> None:
    found = db.execute(
        text("SELECT 1 FROM companies WHERE id = :id"), {"id": company_id}
    ).first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")


def _account_or_404(db: Session, account_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM company_bank_accounts WHERE id = :id"), {"id": account_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank account not found")
    return row(found)


class BankAccountCreate(BaseModel):
    bank_name: str = Field(..., min_length=1, max_length=200)
    account_number: str = Field(..., min_length=1, max_length=64)
    ifsc: Optional[str] = Field(None, max_length=20)
    branch: Optional[str] = Field(None, max_length=200)
    account_type: Optional[str] = Field(None, max_length=40)
    is_primary: Optional[bool] = False
    notes: Optional[str] = None


class BankAccountUpdate(BaseModel):
    bank_name: Optional[str] = Field(None, min_length=1, max_length=200)
    account_number: Optional[str] = Field(None, min_length=1, max_length=64)
    ifsc: Optional[str] = Field(None, max_length=20)
    branch: Optional[str] = Field(None, max_length=200)
    account_type: Optional[str] = Field(None, max_length=40)
    is_primary: Optional[bool] = None
    notes: Optional[str] = None


@router.get("/companies/{company_id}/bank-accounts")
def list_accounts(
    company_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_finance(user)
    _company_or_404(db, company_id)
    rows = db.execute(
        text(
            "SELECT * FROM company_bank_accounts WHERE company_id = :cid "
            "ORDER BY is_primary DESC, lower(bank_name) ASC"
        ),
        {"cid": company_id},
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/companies/{company_id}/bank-accounts",
             status_code=status.HTTP_201_CREATED)
def create_account(
    company_id: str,
    body: BankAccountCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_finance(user)
    _company_or_404(db, company_id)
    new_id = str(uuid.uuid4())
    fields = body.model_dump(exclude_unset=True)
    cols = ["id", "company_id", "created_by"] + list(fields.keys())
    placeholders = [":id", ":company_id", ":created_by"] + [f":{k}" for k in fields.keys()]
    params = {"id": new_id, "company_id": company_id, "created_by": user.id, **fields}
    try:
        # Only one primary per company — if the new row is primary, clear
        # the flag on existing rows.
        if fields.get("is_primary"):
            db.execute(
                text("UPDATE company_bank_accounts SET is_primary = false "
                     "WHERE company_id = :cid"),
                {"cid": company_id},
            )
        db.execute(
            text(f"INSERT INTO company_bank_accounts ({', '.join(cols)}) "
                 f"VALUES ({', '.join(placeholders)})"),
            params,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _account_or_404(db, new_id)


@router.patch("/bank-accounts/{account_id}")
def update_account(
    account_id: str,
    body: BankAccountUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_finance(user)
    existing = _account_or_404(db, account_id)
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return existing
    if fields.get("is_primary"):
        # Clear the primary flag on every other account of the same company.
        db.execute(
            text("UPDATE company_bank_accounts SET is_primary = false "
                 "WHERE company_id = :cid AND id != :id"),
            {"cid": existing["company_id"], "id": account_id},
        )
    set_parts = [f"{k} = :{k}" for k in fields.keys()]
    params = {**fields, "id": account_id}
    db.execute(
        text(f"UPDATE company_bank_accounts SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    db.commit()
    return _account_or_404(db, account_id)


@router.delete("/bank-accounts/{account_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_finance(user)
    _account_or_404(db, account_id)
    db.execute(text("DELETE FROM company_bank_accounts WHERE id = :id"),
               {"id": account_id})
    db.commit()
    return None
