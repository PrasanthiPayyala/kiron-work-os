from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.patch("/{notif_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(notif_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    res = db.execute(
        text("UPDATE notifications SET is_read = true WHERE id = :id AND user_id = :uid"),
        {"id": notif_id, "uid": user.id},
    )
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    return None


@router.post("/mark-all-read")
def mark_all_read(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    res = db.execute(
        text("UPDATE notifications SET is_read = true WHERE user_id = :uid AND is_read = false"),
        {"uid": user.id},
    )
    db.commit()
    return {"updated": res.rowcount}
