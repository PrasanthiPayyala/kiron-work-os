import datetime as dt
from dataclasses import dataclass, field

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import get_db
from .security import decode_token, token_iat
from .util import row

DISABLED_PROFILE_STATUSES = {"exited", "inactive"}


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

    # Disabled accounts: refuse the token even if it's not yet expired. This
    # closes the gap between a deactivation and the access-token TTL (default
    # 60 min) — an admin disabling someone today shouldn't have to wait an
    # hour for the existing session to die.
    if profile["is_active"] is False or profile["status"] in DISABLED_PROFILE_STATUSES:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "This account has been deactivated.",
        )
    cutoff: dt.datetime | None = profile["tokens_invalid_after"]
    if cutoff is not None:
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=dt.timezone.utc)
        iat = token_iat(token)
        if iat is not None and iat < cutoff:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Session was invalidated. Please sign in again.",
            )

    roles = {
        r[0]
        for r in db.execute(
            text("SELECT role FROM user_roles WHERE user_id = :id"), {"id": uid}
        ).all()
    }
    return CurrentUser(id=uid, profile=row(profile), roles=roles)
