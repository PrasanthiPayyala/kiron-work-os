from dataclasses import dataclass, field

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import get_db
from .security import decode_token
from .util import row


@dataclass
class CurrentUser:
    id: str
    profile: dict
    roles: set[str] = field(default_factory=set)


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    uid = decode_token(token, "access")
    if not uid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    profile = db.execute(
        text("SELECT * FROM profiles WHERE id = :id"), {"id": uid}
    ).mappings().first()
    if not profile:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    roles = {
        r[0]
        for r in db.execute(
            text("SELECT role FROM user_roles WHERE user_id = :id"), {"id": uid}
        ).all()
    }
    return CurrentUser(id=uid, profile=row(profile), roles=roles)
