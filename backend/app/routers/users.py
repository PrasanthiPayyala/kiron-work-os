"""User account management — create, edit, deactivate, reactivate.

Gated to super_admin + hr_admin via can_manage_users. Covers the joiner-leaver
lifecycle:
    POST   /users                       — create account (HR / admin onboarding)
    PATCH  /users/{id}                  — edit profile fields (designation,
                                          employment_type, manager, etc.)
    POST   /users/{id}/deactivate       — block login (sets is_active=false,
                                          status='exited', bumps
                                          tokens_invalid_after to kill open
                                          sessions immediately)
    POST   /users/{id}/reactivate       — undo deactivate (useful for
                                          intern → full-time transitions where
                                          the same person comes back)
    PUT    /users/{id}/roles            — replace the role set (one row per role
                                          in user_roles)

A converting intern keeps every row referencing their profile.id — projects,
project_members, tasks, attendance, leave, conversations — because we never
delete + recreate the profile.
"""
import datetime as dt
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_manage_users
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..security import hash_password
from ..util import row

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_ROLES = {
    "super_admin", "founder", "founder_office_coordinator", "founder_office_support",
    "manager", "employee", "intern", "hr_admin",
}
ALLOWED_EMPLOYMENT_TYPES = {"intern", "contract", "full_time", "temporary", "part_time"}
ALLOWED_STATUSES = {"active", "intern", "on_notice", "on_leave", "exited", "inactive"}


def _require_manager(user: CurrentUser) -> None:
    if not can_manage_users(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to manage users")


def _profile_or_404(db: Session, user_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM profiles WHERE id = :id"), {"id": user_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return row(found)


def _initials(full_name: str) -> str:
    parts = [p for p in full_name.split() if p]
    return "".join(p[0] for p in parts[:2]).upper() or "U"


# ---------- Create ----------

class UserCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6)
    home_company_id: str
    department_id: Optional[str] = None
    designation: str = Field("", max_length=120)
    employment_type: str = "full_time"
    role: str = "employee"
    reporting_manager_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    doj: Optional[str] = None  # YYYY-MM-DD


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    if body.employment_type not in ALLOWED_EMPLOYMENT_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"employment_type must be one of {sorted(ALLOWED_EMPLOYMENT_TYPES)}")
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"role must be one of {sorted(ALLOWED_ROLES)}")

    # Reject duplicate emails up-front rather than letting the unique
    # constraint fire — surfaces a clean message.
    dup = db.execute(
        text("SELECT 1 FROM users WHERE lower(email) = lower(:email)"),
        {"email": body.email},
    ).first()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")

    uid = str(uuid.uuid4())
    db.execute(
        text("INSERT INTO users (id, email, password_hash) VALUES (:id, :em, :ph)"),
        {"id": uid, "em": body.email, "ph": hash_password(body.password)},
    )
    # Intern role default to status='intern' — matches the existing seed
    # convention. Everyone else lands on 'active'.
    profile_status = "intern" if body.role == "intern" else "active"
    # must_change_password=true so the joiner picks a real password on first
    # sign-in — the HR-typed temporary one shouldn't stick.
    db.execute(
        text(
            "INSERT INTO profiles ("
            " id, full_name, email, designation, home_company_id, department_id,"
            " reporting_manager_id, reviewer_id, initials, status, doj,"
            " employment_type, is_active, must_change_password"
            ") VALUES ("
            " :id, :name, :em, :des, :co, :dep, :mgr, :rev, :ini, :st, :doj,"
            " :emp, true, true"
            ")"
        ),
        {
            "id": uid, "name": body.full_name, "em": body.email,
            "des": body.designation, "co": body.home_company_id,
            "dep": body.department_id, "mgr": body.reporting_manager_id,
            "rev": body.reviewer_id, "ini": _initials(body.full_name),
            "st": profile_status, "doj": body.doj or None,
            "emp": body.employment_type,
        },
    )
    db.execute(
        text("INSERT INTO user_roles (user_id, role) VALUES (:u, :r)"),
        {"u": uid, "r": body.role},
    )
    db.commit()
    return _profile_or_404(db, uid)


# ---------- Update ----------

class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=120)
    # Email IS editable in edit mode — it's the login identity, so changing
    # it affects how the person signs in. Uniqueness is enforced before any
    # write; the UPDATE touches both `users.email` (auth) and
    # `profiles.email` (display) so they stay in sync.
    email: Optional[EmailStr] = None
    designation: Optional[str] = Field(None, max_length=120)
    home_company_id: Optional[str] = None
    department_id: Optional[str] = None
    reporting_manager_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    employment_type: Optional[str] = None
    status: Optional[str] = None
    doj: Optional[str] = None
    skills: Optional[list[str]] = None
    # Per-employee working-hours override. NULL clears the override and falls
    # back to the company default. ISO day numbers (1=Mon..7=Sun).
    work_days: Optional[list[int]] = None
    work_start: Optional[str] = None
    work_end: Optional[str] = None
    # Per-employee Saturday-of-month override. NULL = inherit company. Same
    # encoding as companies.saturday_weeks_working ([1,3,5] = 1st/3rd/5th
    # Saturday work; 2nd & 4th off).
    saturday_weeks_working: Optional[list[int]] = None
    # Per-user opt-in to the Team Attendance follow-up page. Granted by HR
    # for TA / recruitment staff who follow up with people who haven't
    # checked in. Role-based access (super_admin / founder / hr_admin /
    # founder_office_coordinator) always wins regardless of this flag.
    attendance_followup_access: Optional[bool] = None


@router.patch("/{user_id}")
def update_user(
    user_id: str,
    body: UserUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    _profile_or_404(db, user_id)
    if body.employment_type is not None and body.employment_type not in ALLOWED_EMPLOYMENT_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"employment_type must be one of {sorted(ALLOWED_EMPLOYMENT_TYPES)}")
    if body.status is not None and body.status not in ALLOWED_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"status must be one of {sorted(ALLOWED_STATUSES)}")
    if body.work_days is not None and body.work_days:
        if any(d < 1 or d > 7 for d in body.work_days):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "work_days uses ISO day numbers (1=Mon..7=Sun)")
    if body.work_start and body.work_end and body.work_start >= body.work_end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "work_start must be earlier than work_end")
    if body.saturday_weeks_working is not None:
        if any(w < 1 or w > 5 for w in body.saturday_weeks_working):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "saturday_weeks_working values must be 1..5")

    fields = body.model_dump(exclude_unset=True)
    # Same convention as companies.py: empty array means "clear" — NULL the
    # column so the profile inherits the company default again.
    if fields.get("saturday_weeks_working") == []:
        fields["saturday_weeks_working"] = None

    # Email change is special: lives in BOTH users (auth) and profiles (display).
    # Take it out of `fields` so it doesn't go into the profiles UPDATE blindly,
    # validate uniqueness against other users, then write both rows.
    new_email = fields.pop("email", None)
    if new_email is not None:
        new_email = str(new_email).strip()
        dup = db.execute(
            text("SELECT 1 FROM users WHERE lower(email) = lower(:em) AND id != :id"),
            {"em": new_email, "id": user_id},
        ).first()
        if dup:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Another account already uses that email")
        db.execute(
            text("UPDATE users SET email = :em WHERE id = :id"),
            {"em": new_email, "id": user_id},
        )
        # Put it back into the profiles UPDATE so profiles.email stays in sync.
        fields["email"] = new_email

    if not fields:
        db.commit()  # still commit the users.email update if it happened
        return _profile_or_404(db, user_id)

    set_parts = []
    params: dict = {"id": user_id}
    for col, val in fields.items():
        # initials follow the full_name if the name changes
        if col == "full_name":
            set_parts.append("initials = :__ini")
            params["__ini"] = _initials(val)
        set_parts.append(f"{col} = :{col}")
        params[col] = val
    sql = f"UPDATE profiles SET {', '.join(set_parts)} WHERE id = :id"
    db.execute(text(sql), params)
    db.commit()
    return _profile_or_404(db, user_id)


# ---------- Roles ----------

class RolesUpdate(BaseModel):
    roles: list[str] = Field(..., min_length=1)


@router.put("/{user_id}/roles")
def set_roles(
    user_id: str,
    body: RolesUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    _profile_or_404(db, user_id)
    bad = [r for r in body.roles if r not in ALLOWED_ROLES]
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown roles: {bad}")

    # Swap the set atomically. `user_roles` has a unique(user_id, role).
    db.execute(text("DELETE FROM user_roles WHERE user_id = :u"), {"u": user_id})
    for r in set(body.roles):
        db.execute(
            text("INSERT INTO user_roles (user_id, role) VALUES (:u, :r)"),
            {"u": user_id, "r": r},
        )
    db.commit()
    return {"user_id": user_id, "roles": sorted(set(body.roles))}


# ---------- Deactivate / Reactivate ----------

@router.post("/{user_id}/deactivate")
def deactivate_user(
    user_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    if user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "You can't deactivate your own account")
    _profile_or_404(db, user_id)

    # is_active=false blocks future logins.
    # tokens_invalid_after kills the existing access + refresh tokens at the
    # next request (deps.get_current_user / auth.refresh check it).
    # status='exited' makes the change visible in /people and reports.
    now = dt.datetime.now(dt.timezone.utc)
    db.execute(
        text(
            "UPDATE profiles SET is_active = false, status = 'exited', "
            "tokens_invalid_after = :now WHERE id = :id"
        ),
        {"now": now, "id": user_id},
    )
    # Invalidate any in-flight password-reset links too — a deactivated
    # account shouldn't be revivable via a forgotten reset email.
    db.execute(
        text("UPDATE password_reset_tokens SET used_at = now() "
             "WHERE user_id = :u AND used_at IS NULL"),
        {"u": user_id},
    )
    db.commit()
    return _profile_or_404(db, user_id)


@router.post("/{user_id}/reactivate")
def reactivate_user(
    user_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(user)
    _profile_or_404(db, user_id)
    db.execute(
        text(
            "UPDATE profiles SET is_active = true, status = 'active' "
            "WHERE id = :id"
        ),
        {"id": user_id},
    )
    db.commit()
    return _profile_or_404(db, user_id)
