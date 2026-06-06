import datetime as dt
import uuid

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from .config import settings

_ph = PasswordHasher()

ALGO = "HS256"


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, plain)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def _encode(sub: str, ttl: dt.timedelta, token_type: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": sub,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGO)


def make_access_token(user_id: str) -> str:
    return _encode(user_id, dt.timedelta(minutes=settings.jwt_access_ttl_min), "access")


def make_refresh_token(user_id: str) -> str:
    return _encode(user_id, dt.timedelta(days=settings.jwt_refresh_ttl_days), "refresh")


def decode_token(token: str, expected_type: str) -> str | None:
    """Return the subject (user id) if the token is valid and of the expected type.

    Does NOT check profiles.is_active / status / tokens_invalid_after — those
    live in Postgres and are enforced by the caller (auth.login and
    deps.get_current_user). Keeping this function DB-free lets the WS endpoint
    decode a token from a query string without holding a session.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload.get("sub")


def token_iat(token: str) -> dt.datetime | None:
    """Best-effort: pull the iat (issued-at) from a JWT, without raising.

    Used to invalidate tokens minted before the user was deactivated.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    raw = payload.get("iat")
    if raw is None:
        return None
    return dt.datetime.fromtimestamp(int(raw), tz=dt.timezone.utc)
