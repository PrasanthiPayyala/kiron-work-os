import datetime as dt
import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..email import send_password_reset
from ..security import (
    make_access_token,
    make_refresh_token,
    decode_token,
    token_iat,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    user_id: str


class RefreshIn(BaseModel):
    refresh_token: str


class AccessOut(BaseModel):
    access_token: str


# profiles.status values that should prevent sign-in even with a valid password.
DISABLED_PROFILE_STATUSES = {"exited", "inactive"}


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    row = db.execute(
        text(
            "SELECT u.id, u.password_hash, p.is_active, p.status "
            "FROM users u "
            "LEFT JOIN profiles p ON p.id = u.id "
            "WHERE lower(u.email) = lower(:email)"
        ),
        {"email": body.email},
    ).mappings().first()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    # Disabled accounts get a distinct message so HR/admins can debug, but the
    # 401 status is preserved so we don't reveal "this email exists".
    if row["is_active"] is False or (row["status"] in DISABLED_PROFILE_STATUSES):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "This account has been deactivated. Contact your administrator.",
        )
    uid = str(row["id"])
    return TokenOut(
        access_token=make_access_token(uid),
        refresh_token=make_refresh_token(uid),
        user_id=uid,
    )


@router.post("/refresh", response_model=AccessOut)
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    uid = decode_token(body.refresh_token, "refresh")
    if not uid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    # Same gating as login — a deactivated user must not be able to mint new
    # access tokens via a stale refresh token. Also honours tokens_invalid_after
    # so admins can force a re-login even before deactivating.
    prof = db.execute(
        text("SELECT is_active, status, tokens_invalid_after FROM profiles WHERE id = :id"),
        {"id": uid},
    ).mappings().first()
    if not prof:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    if prof["is_active"] is False or prof["status"] in DISABLED_PROFILE_STATUSES:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account has been deactivated.")
    cutoff = prof["tokens_invalid_after"]
    if cutoff is not None:
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=dt.timezone.utc)
        iat = token_iat(body.refresh_token)
        if iat is not None and iat < cutoff:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session was invalidated.")
    return AccessOut(access_token=make_access_token(uid))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout():
    # Stateless JWT: the client drops its tokens. (Add a denylist later if needed.)
    return None


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return {"profile": user.profile, "roles": sorted(user.roles)}


# ---------- Password reset ----------

class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(..., min_length=20)
    new_password: str = Field(..., min_length=6)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_password_reset(db: Session, user_id: str, email: str, full_name: str) -> None:
    """Generate a reset token, store it, and email the link. Shared by the
    self-service /forgot-password flow and the HR-triggered admin endpoint
    (POST /users/{id}/send-reset-link) — same token lifecycle, same email,
    the only difference is who initiates it and how the target is found."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
        minutes=settings.password_reset_ttl_min,
    )

    # Invalidate any older outstanding tokens for this user, so only the
    # most recent link works (defends against stale links + replay).
    db.execute(
        text("UPDATE password_reset_tokens SET used_at = now() "
             "WHERE user_id = :u AND used_at IS NULL"),
        {"u": user_id},
    )
    db.execute(
        text("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) "
             "VALUES (:u, :h, :e)"),
        {"u": user_id, "h": token_hash, "e": expires_at},
    )
    db.commit()

    reset_url = f"{settings.app_base_url.rstrip('/')}/update-password?token={raw_token}"
    try:
        send_password_reset(
            email=email,
            full_name=full_name,
            reset_url=reset_url,
        )
    except Exception as e:  # noqa: BLE001
        # Don't leak SMTP failures to the caller; log + let the caller
        # decide how to surface it (forgot_password swallows silently per
        # its anti-enumeration contract; the admin endpoint re-raises).
        import logging
        logging.getLogger("kiron.auth").exception("Password reset email failed: %s", e)
        raise


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)):
    """Generate a reset token + email the link. Always returns 202 so callers
    can't enumerate which emails are registered."""
    user_row = db.execute(
        text("SELECT u.id, p.full_name FROM users u "
             "LEFT JOIN profiles p ON p.id = u.id "
             "WHERE lower(u.email) = lower(:email)"),
        {"email": body.email},
    ).mappings().first()

    if user_row:
        try:
            issue_password_reset(
                db, str(user_row["id"]), body.email, user_row.get("full_name") or "",
            )
        except Exception:  # noqa: BLE001
            pass  # already logged inside issue_password_reset; stay silent here

    return {"status": "ok"}


class ChangePasswordIn(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Authenticated password change. Used both for the regular 'change my
    password' flow and for the forced first-login change (the frontend
    redirects there whenever profiles.must_change_password is true).

    We require the current password even for forced changes — that way the
    person at the keyboard has demonstrated they know the HR-issued temporary
    password (defends against a left-open session being hijacked into a
    permanent new password by a walk-by attacker).
    """
    row = db.execute(
        text("SELECT password_hash FROM users WHERE id = :id"), {"id": user.id},
    ).mappings().first()
    if not row or not verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Pick a new password — it can't be the same as the current one")
    db.execute(
        text("UPDATE users SET password_hash = :h WHERE id = :id"),
        {"h": hash_password(body.new_password), "id": user.id},
    )
    db.execute(
        text("UPDATE profiles SET must_change_password = false WHERE id = :id"),
        {"id": user.id},
    )
    db.commit()
    return None


@router.post("/reset-password", response_model=TokenOut)
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    """Consume a reset token, update the password, and issue fresh tokens so
    the user is logged straight in (saves a follow-up sign-in step)."""
    token_hash = _hash_token(body.token)
    row = db.execute(
        text("SELECT id, user_id, expires_at, used_at "
             "FROM password_reset_tokens WHERE token_hash = :h"),
        {"h": token_hash},
    ).mappings().first()

    if not row or row["used_at"] is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reset link is invalid or already used")
    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
    if expires_at < dt.datetime.now(dt.timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reset link has expired — request a new one")

    new_hash = hash_password(body.new_password)
    db.execute(
        text("UPDATE users SET password_hash = :h WHERE id = :u"),
        {"h": new_hash, "u": str(row["user_id"])},
    )
    # Clear the force-change flag — they've just chosen a real password via the
    # email link, so there's nothing left to force.
    db.execute(
        text("UPDATE profiles SET must_change_password = false WHERE id = :u"),
        {"u": str(row["user_id"])},
    )
    db.execute(
        text("UPDATE password_reset_tokens SET used_at = now() WHERE id = :id"),
        {"id": str(row["id"])},
    )
    db.commit()

    uid = str(row["user_id"])
    return TokenOut(
        access_token=make_access_token(uid),
        refresh_token=make_refresh_token(uid),
        user_id=uid,
    )
