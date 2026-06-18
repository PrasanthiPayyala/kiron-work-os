"""Credentials vault router.

Endpoints:
- POST   /vault                          super_admin only — create
- GET    /vault                          metadata list (only credentials the caller can see)
- GET    /vault/{id}                     metadata + caller's access status
- PATCH  /vault/{id}                     super_admin only — edit
- DELETE /vault/{id}                     super_admin only — delete
- POST   /vault/{id}/reveal              decrypts + returns secret + audits
- POST   /vault/{id}/copy                audits a copy-to-clipboard
- GET    /vault/{id}/access              list grants (super_admin)
- POST   /vault/{id}/access              add a grant (super_admin)
- DELETE /vault/{id}/access/{kind}/{pid} revoke a grant (super_admin)
- GET    /vault/{id}/audit               recent audit log (super_admin)

Authz:
- super_admin always passes. No row needed in credential_access.
- Every other role / user needs an explicit ``credential_access`` row
  (kind='user' with their uuid, OR kind='role' with their role name).
- Founder + founder_office_* + hr_admin start with NO implicit access.
  Kiran (super_admin) grants per-credential.
"""
import datetime as dt
import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row
from ..vault_crypto import VaultNotConfigured, decrypt, encrypt

router = APIRouter(prefix="/vault", tags=["vault"])

SUPER = {"super_admin"}


# ---------- payload models ----------


class CredentialCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=200)
    category: str = Field("misc", max_length=40)
    identifier: str | None = None
    url: str | None = None
    notes: str | None = None
    secret: str = Field(..., min_length=1)
    rotate_every_days: int | None = Field(None, ge=1, le=3650)


class CredentialUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=200)
    category: str | None = Field(None, max_length=40)
    identifier: str | None = None
    url: str | None = None
    notes: str | None = None
    # Only re-encrypt when the caller explicitly supplies a new secret.
    # Empty string is treated as "no change" rather than "set to empty",
    # so users can edit metadata without retyping the secret.
    secret: str | None = None
    rotate_every_days: int | None = Field(None, ge=1, le=3650)
    is_active: bool | None = None


class AccessGrant(BaseModel):
    kind: Literal["user", "role"]
    principal_id: str   # uuid string for user, role name for role


# ---------- helpers ----------


def _require_super(user: CurrentUser) -> None:
    if not (user.roles & SUPER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super_admin can do this")


def _get(db: Session, credential_id: str) -> dict:
    r = db.execute(
        text("SELECT * FROM credentials WHERE id = :id"), {"id": credential_id}
    ).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credential not found")
    return row(r)


def _has_access(db: Session, credential_id: str, user: CurrentUser) -> bool:
    """super_admin always passes. Others need a credential_access row
    keyed either on their user id OR one of their roles."""
    if user.roles & SUPER:
        return True
    rows = db.execute(
        text(
            "SELECT principal_kind, principal_id FROM credential_access "
            "WHERE credential_id = :cid"
        ),
        {"cid": credential_id},
    ).mappings().all()
    for r in rows:
        if r["principal_kind"] == "user" and r["principal_id"] == user.id:
            return True
        if r["principal_kind"] == "role" and r["principal_id"] in user.roles:
            return True
    return False


def _audit(db: Session, credential_id: str, actor: str, action: str, meta: dict | None = None) -> None:
    db.execute(
        text(
            "INSERT INTO credential_audit (credential_id, actor_user_id, action, meta) "
            "VALUES (:cid, :u, :a, CAST(:m AS jsonb))"
        ),
        {
            "cid": credential_id,
            "u": actor,
            "a": action,
            "m": json.dumps(meta) if meta else None,
        },
    )


def _row_shape(c: dict) -> dict:
    """Strip the ciphertext bytes from a public-facing payload. We never
    send raw bytea over the wire."""
    out = dict(c)
    out.pop("ciphertext", None)
    out.pop("nonce", None)
    return out


# ---------- endpoints ----------


@router.post("", status_code=status.HTTP_201_CREATED)
def create_credential(
    body: CredentialCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_super(user)
    try:
        ct, nonce = encrypt(body.secret)
    except VaultNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO credentials "
            "  (id, label, category, identifier, url, notes, "
            "   ciphertext, nonce, rotate_every_days, "
            "   created_by, updated_by) "
            "VALUES (:id, :label, :cat, :ident, :url, :notes, "
            "        :ct, :nonce, :rot, :cb, :ub)"
        ),
        {
            "id": new_id, "label": body.label.strip(), "cat": body.category,
            "ident": body.identifier, "url": body.url, "notes": body.notes,
            "ct": ct, "nonce": nonce, "rot": body.rotate_every_days,
            "cb": user.id, "ub": user.id,
        },
    )
    _audit(db, new_id, user.id, "create")
    db.commit()
    return _row_shape(_get(db, new_id))


@router.get("")
def list_credentials(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Metadata for every credential the caller can see. super_admin
    gets all; everyone else only credentials they've been granted on."""
    if user.roles & SUPER:
        rows = db.execute(
            text("SELECT * FROM credentials WHERE is_active = true ORDER BY category, label")
        ).mappings().all()
    else:
        # Pull credentials granted to this specific user OR any of the
        # roles the caller currently holds.
        rows = db.execute(
            text(
                "SELECT DISTINCT c.* FROM credentials c "
                "JOIN credential_access a ON a.credential_id = c.id "
                "WHERE c.is_active = true "
                "  AND ( "
                "    (a.principal_kind = 'user' AND a.principal_id = :uid) "
                "    OR (a.principal_kind = 'role' AND a.principal_id = ANY(:roles)) "
                "  ) "
                "ORDER BY c.category, c.label"
            ),
            {"uid": user.id, "roles": list(user.roles)},
        ).mappings().all()
    return [_row_shape(row(r)) for r in rows]


@router.get("/{credential_id}")
def get_credential(
    credential_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _get(db, credential_id)
    if not _has_access(db, credential_id, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this credential")
    return _row_shape(c)


@router.patch("/{credential_id}")
def update_credential(
    credential_id: str,
    patch: CredentialUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_super(user)
    c = _get(db, credential_id)

    fields = patch.model_dump(exclude_unset=True)
    new_secret = fields.pop("secret", None)
    if new_secret is not None and new_secret != "":
        try:
            ct, nonce = encrypt(new_secret)
        except VaultNotConfigured as e:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
        fields["ciphertext"] = ct
        fields["nonce"] = nonce
        fields["last_rotated_at"] = dt.datetime.now(dt.timezone.utc)

    if not fields:
        return _row_shape(c)

    set_parts: list[str] = ["updated_by = :ub", "updated_at = now()"]
    params: dict = {"id": credential_id, "ub": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v

    db.execute(text(f"UPDATE credentials SET {', '.join(set_parts)} WHERE id = :id"), params)
    _audit(db, credential_id, user.id, "edit", {"fields": list(fields.keys())})
    db.commit()
    return _row_shape(_get(db, credential_id))


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_credential(
    credential_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_super(user)
    _get(db, credential_id)
    _audit(db, credential_id, user.id, "delete")
    db.execute(text("DELETE FROM credentials WHERE id = :id"), {"id": credential_id})
    db.commit()
    return None


@router.post("/{credential_id}/reveal")
def reveal_credential(
    credential_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Decrypt + return the secret. Audited as 'view'."""
    if not _has_access(db, credential_id, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this credential")
    r = db.execute(
        text("SELECT ciphertext, nonce FROM credentials WHERE id = :id"),
        {"id": credential_id},
    ).first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credential not found")
    try:
        secret = decrypt(r[0], r[1])
    except VaultNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Vault decryption failed")
    _audit(db, credential_id, user.id, "view")
    db.commit()
    return {"secret": secret}


@router.post("/{credential_id}/copy", status_code=status.HTTP_204_NO_CONTENT)
def log_copy(
    credential_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Frontend calls this when the user clicks copy-to-clipboard so
    the audit log captures it. Distinguishing copy from view tells you
    'someone exposed it on a screen' vs 'someone stashed it'."""
    if not _has_access(db, credential_id, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this credential")
    _audit(db, credential_id, user.id, "copy")
    db.commit()
    return None


# ---------- access management (super_admin only) ----------


@router.get("/{credential_id}/access")
def list_access(
    credential_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_super(user)
    _get(db, credential_id)
    rows = db.execute(
        text(
            "SELECT principal_kind, principal_id, granted_at, granted_by "
            "FROM credential_access WHERE credential_id = :cid "
            "ORDER BY granted_at DESC"
        ),
        {"cid": credential_id},
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/{credential_id}/access", status_code=status.HTTP_201_CREATED)
def grant_access(
    credential_id: str,
    body: AccessGrant,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_super(user)
    _get(db, credential_id)
    db.execute(
        text(
            "INSERT INTO credential_access "
            "  (credential_id, principal_kind, principal_id, granted_by) "
            "VALUES (:cid, :k, :pid, :gb) "
            "ON CONFLICT (credential_id, principal_kind, principal_id) DO NOTHING"
        ),
        {"cid": credential_id, "k": body.kind, "pid": body.principal_id, "gb": user.id},
    )
    _audit(db, credential_id, user.id, "grant",
           {"kind": body.kind, "principal_id": body.principal_id})
    db.commit()
    return {"credential_id": credential_id, "kind": body.kind, "principal_id": body.principal_id}


@router.delete("/{credential_id}/access/{kind}/{principal_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def revoke_access(
    credential_id: str,
    kind: str,
    principal_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_super(user)
    _get(db, credential_id)
    if kind not in {"user", "role"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind must be 'user' or 'role'")
    db.execute(
        text(
            "DELETE FROM credential_access "
            "WHERE credential_id = :cid AND principal_kind = :k AND principal_id = :pid"
        ),
        {"cid": credential_id, "k": kind, "pid": principal_id},
    )
    _audit(db, credential_id, user.id, "revoke",
           {"kind": kind, "principal_id": principal_id})
    db.commit()
    return None


@router.get("/{credential_id}/audit")
def get_audit(
    credential_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_super(user)
    _get(db, credential_id)
    rows = db.execute(
        text(
            "SELECT id, actor_user_id, action, meta, at "
            "FROM credential_audit WHERE credential_id = :cid "
            "ORDER BY at DESC LIMIT 200"
        ),
        {"cid": credential_id},
    ).mappings().all()
    return [row(r) for r in rows]
