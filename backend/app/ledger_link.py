"""Auto-link helper — keeps the ledger in sync with source modules.

The Company Ledger sits *next to* the existing finance modules
(vendor_payments / expense_claims / payslips / compliance_occurrences /
assets) rather than replacing them. When any of those records a
"money moved" event (vendor_payment created, expense reimbursed,
payroll marked paid, compliance filing recorded with an amount,
asset purchased with a cost), the router calls
``upsert_ledger_for_source`` here to write the matching ledger row.
When the source row is deleted or reverted, the router calls
``delete_ledger_for_source``.

Design notes:
- Single helper module keeps the 5 caller routers as one-liners.
- The (source_kind, source_id) UNIQUE PARTIAL INDEX on
  ledger_entries means upsert via ON CONFLICT is safe and idempotent.
- ``amount_inr`` is always computed here from amount * fx_rate (or
  amount when currency='INR' / fx_rate is NULL) so the database is
  the single source of truth — no two routers can disagree.
- No FK to the source row is enforced at the DB level (source_id is
  a bare uuid). Delete-cascade is the caller router's job. This keeps
  the ledger module's migration self-contained.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


ALLOWED_SOURCE_KINDS = {
    "manual", "vendor_payment", "expense_claim",
    "payslip", "compliance", "asset",
}


def _inr(amount: float | Decimal, currency: str, fx_rate: Optional[float | Decimal]) -> Decimal:
    """Compute amount_inr. Currency=INR (or unset) → amount as-is.
    Otherwise multiply by fx_rate (defaulting to 1 if missing — the
    caller should really set one for foreign currency, but we don't
    want to break the insert if they forgot)."""
    amt = Decimal(str(amount))
    if (currency or "INR").upper() == "INR":
        return amt
    rate = Decimal(str(fx_rate)) if fx_rate is not None else Decimal("1")
    return amt * rate


def upsert_ledger_for_source(
    db: Session,
    *,
    source_kind: str,
    source_id: str,
    company_id: str,
    txn_date,
    direction: str,
    amount: float | Decimal,
    description: str,
    currency: str = "INR",
    fx_rate: Optional[float | Decimal] = None,
    category: str = "other",
    sub_category: Optional[str] = None,
    payment_mode: Optional[str] = None,
    bank_account_id: Optional[str] = None,
    payer_user_id: Optional[str] = None,
    source_label: Optional[str] = None,
    payee_vendor_id: Optional[str] = None,
    payee_user_id: Optional[str] = None,
    payee_contact_id: Optional[str] = None,
    payee_text: Optional[str] = None,
    payee_identifier: Optional[str] = None,
    reference: Optional[str] = None,
    notes: Optional[str] = None,
    created_by: Optional[str] = None,
) -> str:
    """Insert or update the ledger row for the given source. Returns the
    ledger_entries.id. Idempotent — calling twice with the same
    (source_kind, source_id) updates rather than duplicates."""
    if source_kind not in ALLOWED_SOURCE_KINDS:
        raise ValueError(f"source_kind must be one of {sorted(ALLOWED_SOURCE_KINDS)}")
    if source_kind == "manual":
        raise ValueError("upsert_ledger_for_source is for module-sourced rows; use the regular insert for manual entries")
    if direction not in {"in", "out"}:
        raise ValueError("direction must be 'in' or 'out'")

    amount_inr = _inr(amount, currency, fx_rate)

    row = db.execute(
        text(
            "INSERT INTO ledger_entries ("
            "  source_kind, source_id, company_id, txn_date, direction, "
            "  amount, currency, fx_rate, amount_inr, "
            "  category, sub_category, payment_mode, "
            "  bank_account_id, payer_user_id, source_label, "
            "  payee_vendor_id, payee_user_id, payee_contact_id, "
            "  payee_text, payee_identifier, "
            "  description, reference, notes, created_by, updated_by"
            ") VALUES ("
            "  :sk, :sid, :co, :td, :dir, "
            "  :amt, :cur, :fx, :inr, "
            "  :cat, :sub, :mode, "
            "  :ba, :pu, :sl, "
            "  :pv, :py, :pc, "
            "  :pt, :pi, "
            "  :d, :ref, :n, :cb, :cb"
            ") "
            "ON CONFLICT (source_kind, source_id) WHERE source_kind <> 'manual' "
            "DO UPDATE SET "
            "  company_id   = EXCLUDED.company_id, "
            "  txn_date     = EXCLUDED.txn_date, "
            "  direction    = EXCLUDED.direction, "
            "  amount       = EXCLUDED.amount, "
            "  currency     = EXCLUDED.currency, "
            "  fx_rate      = EXCLUDED.fx_rate, "
            "  amount_inr   = EXCLUDED.amount_inr, "
            "  category     = EXCLUDED.category, "
            "  sub_category = EXCLUDED.sub_category, "
            "  payment_mode = EXCLUDED.payment_mode, "
            "  bank_account_id  = EXCLUDED.bank_account_id, "
            "  payer_user_id    = EXCLUDED.payer_user_id, "
            "  source_label     = EXCLUDED.source_label, "
            "  payee_vendor_id  = EXCLUDED.payee_vendor_id, "
            "  payee_user_id    = EXCLUDED.payee_user_id, "
            "  payee_contact_id = EXCLUDED.payee_contact_id, "
            "  payee_text       = EXCLUDED.payee_text, "
            "  payee_identifier = EXCLUDED.payee_identifier, "
            "  description = EXCLUDED.description, "
            "  reference   = EXCLUDED.reference, "
            "  notes       = EXCLUDED.notes, "
            "  updated_by  = EXCLUDED.updated_by, "
            "  updated_at  = now() "
            "RETURNING id"
        ),
        {
            "sk": source_kind, "sid": source_id, "co": company_id,
            "td": txn_date, "dir": direction,
            "amt": amount, "cur": currency, "fx": fx_rate, "inr": amount_inr,
            "cat": category, "sub": sub_category, "mode": payment_mode,
            "ba": bank_account_id, "pu": payer_user_id, "sl": source_label,
            "pv": payee_vendor_id, "py": payee_user_id, "pc": payee_contact_id,
            "pt": payee_text, "pi": payee_identifier,
            "d": description, "ref": reference, "n": notes,
            "cb": created_by,
        },
    ).first()
    return str(row[0]) if row else ""


def delete_ledger_for_source(
    db: Session, *, source_kind: str, source_id: str,
) -> int:
    """Remove the ledger row paired with a given source. Returns
    deleted rowcount (0 if nothing was linked)."""
    if source_kind == "manual":
        raise ValueError("delete_ledger_for_source is for module-sourced rows; manual rows have no link")
    res = db.execute(
        text(
            "DELETE FROM ledger_entries "
            "WHERE source_kind = :sk AND source_id = :sid"
        ),
        {"sk": source_kind, "sid": source_id},
    )
    return res.rowcount or 0
