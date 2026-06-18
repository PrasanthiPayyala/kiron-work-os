"""One-shot backfill for the company ledger.

Run once after migration 0029 + the auto-link hooks land. Walks every
existing settled row in the source tables (vendor_payments,
expense_claims at status='reimbursed', payslips at status='paid',
compliance_occurrences with amount>0, assets with purchase_cost>0)
and calls the same ``upsert_ledger_for_source`` helper the runtime
hooks use. Idempotent — running twice is a no-op via the
(source_kind, source_id) UNIQUE PARTIAL INDEX.

Usage (on the VM):

    sudo -u kiron /opt/kiron/backend/.venv/bin/python \\
      /opt/kiron/scripts/backfill_ledger.py

Prints a summary at the end. Reads DB connection from the same
backend.env the FastAPI process uses (no separate config).
"""
from __future__ import annotations

import datetime as dt
import os
import sys

# Make the backend package importable when running from anywhere.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import engine  # noqa: E402
from app.ledger_link import upsert_ledger_for_source  # noqa: E402


def main() -> None:
    counts = {
        "vendor_payment": 0,
        "expense_claim": 0,
        "payslip": 0,
        "compliance": 0,
        "asset": 0,
    }
    with Session(bind=engine) as db:
        # ---- Vendor payments -------------------------------------
        rows = db.execute(
            text(
                "SELECT p.id, p.amount, p.currency, p.paid_at, p.mode, "
                "       p.reference, p.notes, p.vendor_id, v.company_id "
                "FROM vendor_payments p "
                "JOIN vendors v ON v.id = p.vendor_id"
            )
        ).mappings().all()
        for r in rows:
            if not r["company_id"]:
                continue
            upsert_ledger_for_source(
                db,
                source_kind="vendor_payment", source_id=str(r["id"]),
                company_id=str(r["company_id"]),
                txn_date=r["paid_at"],
                direction="out",
                amount=float(r["amount"]),
                currency=r["currency"] or "INR",
                description="Vendor payment",
                category="vendor",
                payment_mode=r.get("mode"),
                payee_vendor_id=str(r["vendor_id"]),
                reference=r.get("reference"),
                notes=r.get("notes"),
            )
            counts["vendor_payment"] += 1

        # ---- Expense reimbursements ------------------------------
        rows = db.execute(
            text(
                "SELECT id, user_id, company_id, category, description, "
                "       amount, currency, reimbursed_at, "
                "       reimbursement_mode, reimbursement_reference, notes "
                "FROM expense_claims WHERE status = 'reimbursed'"
            )
        ).mappings().all()
        for r in rows:
            if not r["company_id"]:
                continue
            upsert_ledger_for_source(
                db,
                source_kind="expense_claim", source_id=str(r["id"]),
                company_id=str(r["company_id"]),
                txn_date=(r["reimbursed_at"] and r["reimbursed_at"].date()) or dt.date.today(),
                direction="out",
                amount=float(r["amount"]),
                currency=r["currency"] or "INR",
                description=f"Reimbursement: {r['description']}",
                category=r.get("category") or "other",
                payment_mode=r.get("reimbursement_mode"),
                payee_user_id=str(r["user_id"]),
                reference=r.get("reimbursement_reference"),
                notes=r.get("notes"),
            )
            counts["expense_claim"] += 1

        # ---- Paid payslips ---------------------------------------
        rows = db.execute(
            text(
                "SELECT ps.id, ps.user_id, ps.net_pay, ps.period, "
                "       ps.payment_mode, ps.payment_reference, ps.paid_at, "
                "       pr.company_id "
                "FROM payslips ps "
                "JOIN payroll_runs pr ON pr.id = ps.payroll_run_id "
                "WHERE ps.status = 'paid'"
            )
        ).mappings().all()
        for r in rows:
            if not r["company_id"] or not r["net_pay"] or float(r["net_pay"]) <= 0:
                continue
            upsert_ledger_for_source(
                db,
                source_kind="payslip", source_id=str(r["id"]),
                company_id=str(r["company_id"]),
                txn_date=(r["paid_at"] and r["paid_at"].date()) or dt.date.today(),
                direction="out",
                amount=float(r["net_pay"]),
                currency="INR",
                description=f"Salary {r['period']}",
                category="salary",
                payment_mode=r.get("payment_mode"),
                payee_user_id=str(r["user_id"]),
                reference=r.get("payment_reference"),
            )
            counts["payslip"] += 1

        # ---- Compliance filings with amount ----------------------
        rows = db.execute(
            text(
                "SELECT co.id, co.amount, co.filed_at, co.reference, co.notes, "
                "       co.period_label, ob.company_id, ob.name "
                "FROM compliance_occurrences co "
                "JOIN compliance_obligations ob ON ob.id = co.obligation_id "
                "WHERE co.status = 'filed' AND co.amount IS NOT NULL AND co.amount > 0"
            )
        ).mappings().all()
        for r in rows:
            if not r["company_id"]:
                continue
            upsert_ledger_for_source(
                db,
                source_kind="compliance", source_id=str(r["id"]),
                company_id=str(r["company_id"]),
                txn_date=(r["filed_at"] and r["filed_at"].date()) or dt.date.today(),
                direction="out",
                amount=float(r["amount"]),
                currency="INR",
                description=f"{r['name']} — {r['period_label']}",
                category="compliance",
                reference=r.get("reference"),
                notes=r.get("notes"),
            )
            counts["compliance"] += 1

        # ---- Capex assets ----------------------------------------
        rows = db.execute(
            text(
                "SELECT id, company_id, purchase_date, purchase_cost, "
                "       brand, model, category, supplier "
                "FROM assets "
                "WHERE purchase_cost IS NOT NULL AND purchase_cost > 0 "
                "  AND company_id IS NOT NULL"
            )
        ).mappings().all()
        for r in rows:
            upsert_ledger_for_source(
                db,
                source_kind="asset", source_id=str(r["id"]),
                company_id=str(r["company_id"]),
                txn_date=r["purchase_date"] or dt.date.today(),
                direction="out",
                amount=float(r["purchase_cost"]),
                currency="INR",
                description=f"Asset: {r.get('brand') or ''} {r.get('model') or ''} ({r.get('category')})".strip(),
                category="capex",
                payee_text=r.get("supplier"),
            )
            counts["asset"] += 1

        db.commit()

    total = sum(counts.values())
    print(f"Backfilled {total} ledger entries:")
    for k, v in counts.items():
        print(f"  {k:<18} {v}")


if __name__ == "__main__":
    main()
