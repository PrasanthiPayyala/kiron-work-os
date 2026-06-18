"""Documents / Knowledge base router.

Endpoints:
- GET    /documents                     metadata list visible to caller
- GET    /documents/{id}                metadata + body
- POST   /documents                     create (anyone)
- PATCH  /documents/{id}                edit (owner / global / explicit edit grant) — also versions
- DELETE /documents/{id}                delete (owner / super_admin / founder)
- GET    /documents/{id}/versions       list prior versions (anyone with view access)
- GET    /documents/{id}/access         list ACL rows (owner + globals)
- POST   /documents/{id}/access         grant (owner + globals)
- DELETE /documents/{id}/access/{kind}/{principal}
                                        revoke

Visibility / authz model (computed per request):
- ``company``    — caller must share the document's company_id, OR
                   document.company_id is NULL (group-wide via
                   company column).
- ``group_wide`` — everyone signed in.
- ``private``    — only the owner + explicit access rows.

Roles in GLOBAL_DOCS see + edit everything regardless. owner can
always edit. Other users with an ``edit`` access row can edit too.
"""
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/documents", tags=["documents"])

GLOBAL_DOCS = {"super_admin", "founder", "founder_office_coordinator"}
ALLOWED_VISIBILITY = {"company", "group_wide", "private"}


class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = ""
    category: str = "other"
    company_id: Optional[str] = None
    visibility: Literal["company", "group_wide", "private"] = "company"
    tags: list[str] = Field(default_factory=list)


class DocumentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    body: Optional[str] = None
    category: Optional[str] = None
    company_id: Optional[str] = None
    visibility: Optional[Literal["company", "group_wide", "private"]] = None
    tags: Optional[list[str]] = None
    is_active: Optional[bool] = None
    change_note: Optional[str] = None


class AccessGrant(BaseModel):
    kind: Literal["user", "role"]
    principal_id: str
    access_level: Literal["view", "edit"] = "view"


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return out or "doc"


def _get(db: Session, doc_id: str) -> dict:
    r = db.execute(text("SELECT * FROM documents WHERE id = :id"), {"id": doc_id}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return row(r)


def _can_view(db: Session, doc: dict, user: CurrentUser) -> bool:
    if has_any_role(user.roles, GLOBAL_DOCS):
        return True
    if str(doc.get("owner_id") or "") == user.id:
        return True
    vis = doc.get("visibility") or "company"
    if vis == "group_wide":
        return True
    if vis == "company":
        # Authenticated user always has a home_company on profile —
        # fetch it once and compare with doc.company_id. None on the
        # doc means group-wide-by-omission, treated permissively.
        doc_co = doc.get("company_id")
        if doc_co is None:
            return True
        u_co = db.execute(
            text("SELECT home_company_id FROM profiles WHERE id = :u"),
            {"u": user.id},
        ).scalar()
        return str(u_co or "") == str(doc_co)
    # private — fall through to explicit ACL check
    return _has_explicit_access(db, doc["id"], user, levels={"view", "edit"})


def _has_explicit_access(db: Session, doc_id: str, user: CurrentUser, levels: set[str]) -> bool:
    rows = db.execute(
        text(
            "SELECT principal_kind, principal_id, access_level "
            "FROM document_access WHERE document_id = :d"
        ),
        {"d": doc_id},
    ).mappings().all()
    for r in rows:
        if r["access_level"] not in levels:
            continue
        if r["principal_kind"] == "user" and r["principal_id"] == user.id:
            return True
        if r["principal_kind"] == "role" and r["principal_id"] in user.roles:
            return True
    return False


def _can_edit(db: Session, doc: dict, user: CurrentUser) -> bool:
    if has_any_role(user.roles, GLOBAL_DOCS):
        return True
    if str(doc.get("owner_id") or "") == user.id:
        return True
    return _has_explicit_access(db, doc["id"], user, levels={"edit"})


def _shape(r: dict, include_body: bool = True) -> dict:
    out = dict(r)
    if not include_body:
        out.pop("body", None)
    return out


# ----- endpoints -----


@router.get("")
def list_documents(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return metadata (no body) for every active document the caller
    can view. Body is fetched separately via the detail endpoint to
    keep the list payload small."""
    docs = db.execute(
        text("SELECT * FROM documents WHERE is_active = true ORDER BY category, title")
    ).mappings().all()
    # Filter in Python — visibility is too dynamic for a SQL filter
    # and the doc count is modest.
    visible = [row(d) for d in docs if _can_view(db, row(d), user)]
    return [_shape(d, include_body=False) for d in visible]


@router.get("/{doc_id}")
def get_document(
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = _get(db, doc_id)
    if not _can_view(db, doc, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this document")
    # Hand the body too — detail page renders it.
    return {**doc, "can_edit": _can_edit(db, doc, user)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_document(
    body: DocumentCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.visibility not in ALLOWED_VISIBILITY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"visibility must be one of {sorted(ALLOWED_VISIBILITY)}")
    base = _slug(body.title)
    slug = base
    n = 2
    while db.execute(text("SELECT 1 FROM documents WHERE slug = :s"), {"s": slug}).first():
        slug = f"{base}-{n}"
        n += 1
        if n > 200:
            raise HTTPException(status.HTTP_409_CONFLICT, "Could not generate a unique slug — pick a different title")

    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO documents (id, title, slug, category, body, owner_id, "
            "                       company_id, visibility, tags, created_by, updated_by) "
            "VALUES (:id, :t, :slug, :cat, :body, :own, :co, :vis, :tags, :cb, :ub)"
        ),
        {
            "id": new_id, "t": body.title.strip(), "slug": slug,
            "cat": body.category or "other", "body": body.body,
            "own": user.id, "co": body.company_id,
            "vis": body.visibility, "tags": body.tags or None,
            "cb": user.id, "ub": user.id,
        },
    )
    # Seed v1 in the version log so history starts from the moment of
    # creation (lets the diff viewer compare any edit against the original).
    db.execute(
        text(
            "INSERT INTO document_versions (document_id, version, title, body, edited_by) "
            "VALUES (:d, 1, :t, :body, :u)"
        ),
        {"d": new_id, "t": body.title.strip(), "body": body.body, "u": user.id},
    )
    db.commit()
    return _get(db, new_id)


@router.patch("/{doc_id}")
def update_document(
    doc_id: str,
    patch: DocumentUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = _get(db, doc_id)
    if not _can_edit(db, doc, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this document")
    fields = patch.model_dump(exclude_unset=True)
    change_note = fields.pop("change_note", None)
    if "visibility" in fields and fields["visibility"] not in ALLOWED_VISIBILITY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"visibility must be one of {sorted(ALLOWED_VISIBILITY)}")
    if not fields:
        return doc

    # Bump version when title or body changes — those are the
    # "real" content edits worth snapshotting. Metadata-only edits
    # (category / tags / visibility / is_active) don't bump.
    bumps_version = "title" in fields or "body" in fields

    set_parts: list[str] = ["updated_by = :ub", "updated_at = now()"]
    params: dict = {"id": doc_id, "ub": user.id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    if bumps_version:
        set_parts.append("version = version + 1")

    db.execute(text(f"UPDATE documents SET {', '.join(set_parts)} WHERE id = :id"), params)

    if bumps_version:
        # Read back the new version + the resolved title/body, then snapshot.
        head = db.execute(text("SELECT version, title, body FROM documents WHERE id = :id"), {"id": doc_id}).mappings().first()
        db.execute(
            text(
                "INSERT INTO document_versions (document_id, version, title, body, change_note, edited_by) "
                "VALUES (:d, :v, :t, :body, :cn, :u)"
            ),
            {"d": doc_id, "v": head["version"], "t": head["title"], "body": head["body"],
             "cn": change_note, "u": user.id},
        )
    db.commit()
    return _get(db, doc_id)


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = _get(db, doc_id)
    is_owner = str(doc.get("owner_id") or "") == user.id
    if not (is_owner or has_any_role(user.roles, {"super_admin", "founder"})):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner / super_admin / founder can delete")
    db.execute(text("DELETE FROM documents WHERE id = :id"), {"id": doc_id})
    db.commit()
    return None


@router.get("/{doc_id}/versions")
def list_versions(
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = _get(db, doc_id)
    if not _can_view(db, doc, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this document")
    rows = db.execute(
        text(
            "SELECT id, version, title, change_note, edited_at, edited_by "
            "FROM document_versions WHERE document_id = :d "
            "ORDER BY version DESC"
        ),
        {"d": doc_id},
    ).mappings().all()
    return [row(r) for r in rows]


# ----- ACL -----


@router.get("/{doc_id}/access")
def list_access(
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = _get(db, doc_id)
    if not _can_edit(db, doc, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an editor can manage access")
    rows = db.execute(
        text(
            "SELECT principal_kind, principal_id, access_level, granted_at, granted_by "
            "FROM document_access WHERE document_id = :d ORDER BY granted_at DESC"
        ),
        {"d": doc_id},
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/{doc_id}/access", status_code=status.HTTP_201_CREATED)
def grant_access(
    doc_id: str,
    body: AccessGrant,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = _get(db, doc_id)
    if not _can_edit(db, doc, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an editor can manage access")
    db.execute(
        text(
            "INSERT INTO document_access "
            "  (document_id, principal_kind, principal_id, access_level, granted_by) "
            "VALUES (:d, :k, :pid, :lv, :gb) "
            "ON CONFLICT (document_id, principal_kind, principal_id) DO UPDATE SET "
            "  access_level = EXCLUDED.access_level"
        ),
        {"d": doc_id, "k": body.kind, "pid": body.principal_id,
         "lv": body.access_level, "gb": user.id},
    )
    db.commit()
    return {"document_id": doc_id, "kind": body.kind, "principal_id": body.principal_id, "access_level": body.access_level}


@router.delete("/{doc_id}/access/{kind}/{principal_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_access(
    doc_id: str,
    kind: str,
    principal_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = _get(db, doc_id)
    if not _can_edit(db, doc, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an editor can manage access")
    if kind not in {"user", "role"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind must be 'user' or 'role'")
    db.execute(
        text(
            "DELETE FROM document_access "
            "WHERE document_id = :d AND principal_kind = :k AND principal_id = :p"
        ),
        {"d": doc_id, "k": kind, "p": principal_id},
    )
    db.commit()
    return None
