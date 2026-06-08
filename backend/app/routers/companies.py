"""Company config — currently the working-hours schedule, more later.

Only super_admin / hr_admin can edit; everyone reads (the schedule is needed
by every client to render attendance shading correctly).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_manage_users
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/companies", tags=["companies"])


def _get(db: Session, company_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM companies WHERE id = :id"), {"id": company_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    return row(found)


def _validate_schedule(work_days: Optional[list[int]],
                       work_start: Optional[str],
                       work_end: Optional[str],
                       saturday_weeks_working: Optional[list[int]] = None) -> None:
    if work_days is not None:
        if not work_days:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "work_days can't be empty")
        if any(d < 1 or d > 7 for d in work_days):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "work_days uses ISO day numbers (1=Mon..7=Sun)")
    # Time strings are validated by Postgres on cast; we only enforce that if
    # both are provided, start < end (otherwise the working window is empty).
    if work_start and work_end and work_start >= work_end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "work_start must be earlier than work_end")
    if saturday_weeks_working is not None:
        if any(w < 1 or w > 5 for w in saturday_weeks_working):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "saturday_weeks_working values must be 1..5")


class CompanyConfigUpdate(BaseModel):
    work_days: Optional[list[int]] = Field(None, description="ISO day numbers; 1=Mon, 7=Sun")
    work_start: Optional[str] = Field(None, description="HH:MM 24-hour")
    work_end: Optional[str] = Field(None, description="HH:MM 24-hour")
    # Which Saturday-of-month positions (1..5) are working. NULL/omitted = all
    # Saturdays in work_days are working. '[1,3,5]' = 1st/3rd/5th work; 2nd &
    # 4th are off (typical Indian-corporate pattern).
    saturday_weeks_working: Optional[list[int]] = Field(
        None, description="Saturday-of-month positions that are working (1..5)"
    )


@router.patch("/{company_id}")
def update_company(
    company_id: str,
    body: CompanyConfigUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not can_manage_users(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit company config")
    _get(db, company_id)
    _validate_schedule(body.work_days, body.work_start, body.work_end,
                       body.saturday_weeks_working)

    fields = body.model_dump(exclude_unset=True)
    # Empty array -> NULL: an empty saturday_weeks_working list has no useful
    # semantics (it would mean "Saturday is in work_days but no Saturday-of-
    # month works", which is just `remove 6 from work_days`). Treat [] as
    # "clear the column" so existing-rows logic (NULL = all Saturdays work) is
    # preserved and the UI's "all five checked" state round-trips cleanly.
    if fields.get("saturday_weeks_working") == []:
        fields["saturday_weeks_working"] = None
    if not fields:
        return _get(db, company_id)

    set_parts = []
    params: dict = {"id": company_id}
    for col, val in fields.items():
        set_parts.append(f"{col} = :{col}")
        params[col] = val
    sql = f"UPDATE companies SET {', '.join(set_parts)} WHERE id = :id"
    db.execute(text(sql), params)
    db.commit()
    return _get(db, company_id)
