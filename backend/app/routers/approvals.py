import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_decide_approval
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row
from . import ws as ws_router

router = APIRouter(prefix="/approvals", tags=["approvals"])


class Decision(BaseModel):
    status: str
    comments: str | None = None


def _get(db: Session, approval_id: str) -> dict:
    found = db.execute(text("SELECT * FROM approvals WHERE id = :id"), {"id": approval_id}).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Approval not found")
    return row(found)


@router.patch("/{approval_id}")
def decide(
    approval_id: str,
    body: Decision,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    approval = _get(db, approval_id)
    if not can_decide_approval(approval, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to decide this approval")
    db.execute(
        text(
            "UPDATE approvals SET status = :status, comments = :comments, "
            "approver_id = :approver, decided_at = :decided WHERE id = :id"
        ),
        {"status": body.status, "comments": body.comments, "approver": user.id,
         "decided": dt.datetime.now(dt.timezone.utc).isoformat(), "id": approval_id},
    )
    db.commit()
    updated = _get(db, approval_id)
    # Schedule on the main loop via FastAPI BackgroundTasks (asyncio.create_task
    # from a sync endpoint silently fails — see ws_router for the history).
    background.add_task(ws_router.approval_changed, updated)
    return updated
