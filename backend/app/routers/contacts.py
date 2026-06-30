"""Contacts + Organizations directory.

Two-table model so the same human (a CA, a banker, a college TPO) can be
linked to multiple group entities without duplication:

    organizations    — vendors, clients, CA firms, banks, colleges, govt offices
    contacts         — humans, optional FK to organization, category enum
    contact_companies— m:n: which of our group entities does this contact serve

Endpoints:

    GET    /organizations            — list (any contacts viewer)
    POST   /organizations            — create
    PATCH  /organizations/{id}       — update
    DELETE /organizations/{id}       — delete (super_admin only; cascades NULL)

    GET    /contacts                 — list. Server-side filtered to the
                                       caller's visible_categories. Optional
                                       ?category= and ?company_id= filters.
    POST   /contacts                 — create (requires can_edit_contact_category
                                       for the chosen category)
    PATCH  /contacts/{id}            — update
    DELETE /contacts/{id}            — delete
    POST   /contacts/{id}/companies  — link to a company
    DELETE /contacts/{id}/companies/{company_id} — unlink

    GET    /contacts/{id}/activity   — audit log for one contact

Per-row visibility is enforced server-side: a contact in a category the
caller can't see is invisible — 404 on direct access, filtered out of lists.
"""
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import (
    CONTACT_CATEGORIES,
    can_edit_contact_category,
    can_edit_contacts,
    can_view_contact_category,
    can_view_contacts,
    has_any_role,
    visible_categories,
)
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(tags=["contacts"])


def _require_view(user: CurrentUser) -> None:
    if not can_view_contacts(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view contacts")


def _require_edit(user: CurrentUser) -> None:
    if not can_edit_contacts(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit contacts")


def _require_category_view(user: CurrentUser, category: str) -> None:
    if not can_view_contact_category(user.roles, category):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


def _require_category_edit(user: CurrentUser, category: str) -> None:
    if category not in CONTACT_CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown category: {category}")
    if not can_edit_contact_category(user.roles, category):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Not allowed to edit '{category}' contacts")


def _contact_or_404(db: Session, contact_id: str, user: CurrentUser) -> dict:
    """Fetch a contact + enforce category-level visibility.

    Returns 404 (not 403) for categories the caller can't see so we don't
    leak whether the row exists.
    """
    found = db.execute(
        text("SELECT * FROM contacts WHERE id = :id"), {"id": contact_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    cat = found.get("category")
    if not can_view_contact_category(user.roles, cat):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return row(found)


def _log_contact(db: Session, contact_id: str, actor_id: str, action: str,
                 field: Optional[str] = None,
                 old: Optional[dict] = None, new: Optional[dict] = None,
                 note: Optional[str] = None) -> None:
    db.execute(
        text(
            "INSERT INTO contact_activity (contact_id, actor_user_id, action, field_name, "
            "                              old_value, new_value, note) "
            "VALUES (:cid, :uid, :a, :f, CAST(:ov AS jsonb), CAST(:nv AS jsonb), :n)"
        ),
        {
            "cid": contact_id, "uid": actor_id, "a": action, "f": field,
            "ov": json.dumps(old) if old is not None else None,
            "nv": json.dumps(new) if new is not None else None,
            "n": note,
        },
    )


# ============================== ORGANIZATIONS ==============================

class OrganizationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    type: Optional[str] = None
    website: Optional[str] = None
    linkedin_url: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = True


class OrganizationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    type: Optional[str] = None
    website: Optional[str] = None
    linkedin_url: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/organizations")
def list_organizations(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_view(user)
    rows = db.execute(
        text("SELECT * FROM organizations ORDER BY lower(name) ASC")
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/organizations", status_code=status.HTTP_201_CREATED)
def create_organization(
    body: OrganizationCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_edit(user)
    new_id = str(uuid.uuid4())
    fields = body.model_dump(exclude_unset=True)
    cols = ["id", "created_by"] + list(fields.keys())
    placeholders = [":id", ":created_by"] + [f":{k}" for k in fields.keys()]
    params = {"id": new_id, "created_by": user.id, **fields}
    try:
        db.execute(
            text(f"INSERT INTO organizations ({', '.join(cols)}) "
                 f"VALUES ({', '.join(placeholders)})"),
            params,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return row(db.execute(text("SELECT * FROM organizations WHERE id = :id"),
                          {"id": new_id}).mappings().first())


@router.patch("/organizations/{org_id}")
def update_organization(
    org_id: str,
    body: OrganizationUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_edit(user)
    existing = db.execute(
        text("SELECT * FROM organizations WHERE id = :id"), {"id": org_id}
    ).mappings().first()
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return row(existing)
    set_parts = [f"{k} = :{k}" for k in fields.keys()]
    params = {**fields, "id": org_id}
    db.execute(
        text(f"UPDATE organizations SET {', '.join(set_parts)} WHERE id = :id"),
        params,
    )
    db.commit()
    return row(db.execute(text("SELECT * FROM organizations WHERE id = :id"),
                          {"id": org_id}).mappings().first())


@router.delete("/organizations/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(
    org_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only super_admin — orgs are reference data, deletes are rare.
    if "super_admin" not in user.roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super_admin can delete organizations")
    db.execute(text("DELETE FROM organizations WHERE id = :id"), {"id": org_id})
    db.commit()
    return None


# ================================ CONTACTS ================================

class ContactCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=200)
    category: str
    role: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    organization_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = True
    business_card_attachment_id: Optional[str] = None
    company_ids: Optional[list[str]] = None  # convenience: link on create


class ContactUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = None
    role: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    organization_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    business_card_attachment_id: Optional[str] = None


def _serialize_contact_with_links(db: Session, contact_id: str) -> dict:
    """Return contact row + array of linked company ids."""
    c = db.execute(text("SELECT * FROM contacts WHERE id = :id"),
                   {"id": contact_id}).mappings().first()
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    out = row(c)
    links = db.execute(
        text("SELECT company_id, relationship FROM contact_companies WHERE contact_id = :id"),
        {"id": contact_id},
    ).mappings().all()
    out["company_ids"] = [str(r["company_id"]) for r in links]
    out["company_links"] = [
        {"company_id": str(r["company_id"]), "relationship": r["relationship"]}
        for r in links
    ]
    return out


@router.get("/contacts")
def list_contacts(
    category: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_view(user)
    cats = visible_categories(user.roles)
    if category:
        if category not in cats:
            # Caller asked for a category they can't see — return empty
            # rather than 403 so the UI behaves uniformly.
            return []
        cats = {category}

    sql = "SELECT * FROM contacts WHERE category = ANY(:cats)"
    params: dict = {"cats": list(cats)}
    if company_id:
        sql += " AND id IN (SELECT contact_id FROM contact_companies WHERE company_id = :cid)"
        params["cid"] = company_id
    if search:
        sql += (" AND (lower(full_name) LIKE :q OR lower(coalesce(email,'')) LIKE :q "
                "      OR coalesce(phone,'') LIKE :q)")
        params["q"] = f"%{search.lower()}%"
    sql += " ORDER BY lower(full_name) ASC"

    rows = db.execute(text(sql), params).mappings().all()
    ids = [str(r["id"]) for r in rows]
    if not ids:
        return []
    links = db.execute(
        text("SELECT contact_id, company_id, relationship "
             "FROM contact_companies WHERE contact_id = ANY(:ids)"),
        {"ids": ids},
    ).mappings().all()
    by_contact: dict[str, list[dict]] = {}
    for l in links:
        by_contact.setdefault(str(l["contact_id"]), []).append({
            "company_id": str(l["company_id"]),
            "relationship": l["relationship"],
        })
    out = []
    for r in rows:
        d = row(r)
        ls = by_contact.get(d["id"], [])
        d["company_links"] = ls
        d["company_ids"] = [x["company_id"] for x in ls]
        out.append(d)
    return out


@router.get("/contacts/{contact_id}")
def get_contact(
    contact_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_view(user)
    _contact_or_404(db, contact_id, user)
    return _serialize_contact_with_links(db, contact_id)


@router.post("/contacts", status_code=status.HTTP_201_CREATED)
def create_contact(
    body: ContactCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_category_edit(user, body.category)
    new_id = str(uuid.uuid4())
    fields = body.model_dump(exclude_unset=True)
    company_ids = fields.pop("company_ids", None) or []

    cols = ["id", "created_by"] + list(fields.keys())
    placeholders = [":id", ":created_by"] + [f":{k}" for k in fields.keys()]
    # Pydantic v2 EmailStr inherits from str at runtime, UUIDs come in as
    # strings via the request body — so a plain spread works for the bind.
    params = {"id": new_id, "created_by": user.id, **fields}
    try:
        db.execute(
            text(f"INSERT INTO contacts ({', '.join(cols)}) "
                 f"VALUES ({', '.join(placeholders)})"),
            params,
        )
        for cid in company_ids:
            db.execute(
                text("INSERT INTO contact_companies (contact_id, company_id, created_by) "
                     "VALUES (:cn, :co, :uid) ON CONFLICT DO NOTHING"),
                {"cn": new_id, "co": cid, "uid": user.id},
            )
        _log_contact(db, new_id, user.id, "create", new={"category": body.category, "full_name": body.full_name})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _serialize_contact_with_links(db, new_id)


@router.patch("/contacts/{contact_id}")
def update_contact(
    contact_id: str,
    body: ContactUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = _contact_or_404(db, contact_id, user)
    # Edit gate uses the *existing* category, plus the new category if it's
    # changing (to prevent escalating into a category the caller can't edit).
    _require_category_edit(user, existing["category"])
    fields = body.model_dump(exclude_unset=True)
    if "category" in fields and fields["category"] != existing["category"]:
        _require_category_edit(user, fields["category"])

    if not fields:
        return _serialize_contact_with_links(db, contact_id)

    set_parts = [f"{k} = :{k}" for k in fields.keys()]
    params = {**fields, "id": contact_id}
    try:
        db.execute(
            text(f"UPDATE contacts SET {', '.join(set_parts)} WHERE id = :id"),
            params,
        )
        old_snapshot = {k: existing.get(k) for k in fields.keys()}
        _log_contact(db, contact_id, user.id, "update", old=old_snapshot, new=fields)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _serialize_contact_with_links(db, contact_id)


@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = _contact_or_404(db, contact_id, user)
    _require_category_edit(user, existing["category"])
    db.execute(text("DELETE FROM contacts WHERE id = :id"), {"id": contact_id})
    db.commit()
    return None


# ---------- Contact ↔ Company links ----------

class LinkBody(BaseModel):
    company_id: str
    relationship: Optional[str] = None


@router.post("/contacts/{contact_id}/companies", status_code=status.HTTP_201_CREATED)
def link_company(
    contact_id: str,
    body: LinkBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = _contact_or_404(db, contact_id, user)
    _require_category_edit(user, existing["category"])
    db.execute(
        text("INSERT INTO contact_companies (contact_id, company_id, relationship, created_by) "
             "VALUES (:cn, :co, :r, :uid) ON CONFLICT (contact_id, company_id) "
             "DO UPDATE SET relationship = EXCLUDED.relationship"),
        {"cn": contact_id, "co": body.company_id, "r": body.relationship, "uid": user.id},
    )
    _log_contact(db, contact_id, user.id, "link_company",
                 new={"company_id": body.company_id, "relationship": body.relationship})
    db.commit()
    return {"company_id": body.company_id, "relationship": body.relationship}


@router.delete("/contacts/{contact_id}/companies/{company_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def unlink_company(
    contact_id: str,
    company_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = _contact_or_404(db, contact_id, user)
    _require_category_edit(user, existing["category"])
    db.execute(
        text("DELETE FROM contact_companies WHERE contact_id = :cn AND company_id = :co"),
        {"cn": contact_id, "co": company_id},
    )
    _log_contact(db, contact_id, user.id, "unlink_company",
                 old={"company_id": company_id})
    db.commit()
    return None


# ============================== BULK IMPORT ==============================

class ImportRow(BaseModel):
    """One row from the uploaded sheet.

    Mirrors ContactCreate but with looser typing so we can soft-error
    instead of 422'ing the whole batch on one malformed row. Email is
    plain str (not EmailStr) because Karunya's existing sheet has rows
    where the "Email" cell is actually a note like "no email"; we let
    the row through and skip dedup on it. Validation happens row-by-row
    in the handler.
    """
    full_name: str = Field(..., min_length=1, max_length=200)
    category: str
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    organization_name: Optional[str] = None
    notes: Optional[str] = None
    company_short_names: Optional[list[str]] = None


class ImportBody(BaseModel):
    rows: list[ImportRow] = Field(default_factory=list)
    # dry_run runs the whole batch in a single transaction and rolls back
    # at the end. Used by the frontend preview step so the user sees a
    # real count of new vs merged before they commit.
    dry_run: bool = False


def _norm_email(s: Optional[str]) -> Optional[str]:
    """Lowercase + strip. Returns None for empties or strings that don't
    look remotely like an email so dedup doesn't match 'no email' rows."""
    if not s:
        return None
    s = s.strip().lower()
    if "@" not in s or " " in s:
        return None
    return s


def _norm_phone_value(s: Optional[str]) -> Optional[str]:
    """Strip whitespace; keep digits/+/- as-is. Returns None for empties."""
    if not s:
        return None
    s = s.strip()
    return s or None


def _merged_phone(existing: Optional[str], incoming: Optional[str]) -> Optional[str]:
    """If incoming differs from existing AND isn't already a substring of
    existing, append it on a new line. Preserves all original numbers —
    no overwrites. Empty incoming = no-op."""
    if not incoming:
        return existing
    if not existing:
        return incoming
    # Already present? Either exact match or a separator-delimited entry.
    parts = [p.strip() for p in existing.replace(",", "\n").split("\n")]
    if any(incoming.strip() == p for p in parts):
        return existing
    return f"{existing}\n{incoming}"


def _find_or_create_org(db: Session, name: str, user_id: str) -> str:
    """Case-insensitive lookup; insert if absent. Returns the org id."""
    found = db.execute(
        text("SELECT id FROM organizations WHERE lower(name) = lower(:n) LIMIT 1"),
        {"n": name.strip()},
    ).first()
    if found:
        return str(found[0])
    new_id = str(uuid.uuid4())
    db.execute(
        text("INSERT INTO organizations (id, name, created_by) "
             "VALUES (:id, :n, :uid)"),
        {"id": new_id, "n": name.strip(), "uid": user_id},
    )
    return new_id


def _resolve_company(db: Session, name: str) -> Optional[str]:
    """Match by short_name OR full name, case-insensitive. None if unknown."""
    found = db.execute(
        text("SELECT id FROM companies "
             "WHERE lower(short_name) = lower(:n) OR lower(name) = lower(:n) "
             "LIMIT 1"),
        {"n": name.strip()},
    ).first()
    return str(found[0]) if found else None


@router.post("/contacts/import")
def import_contacts(
    body: ImportBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bulk import. Merges by email when present; auto-creates organizations
    by name; links to companies by short_name or full name.

    Per-row errors are reported in the response — they don't fail the
    batch. A row whose email matches an existing contact is *merged*:
    non-null incoming fields fill nulls on the existing row, the phone
    is appended if different, and a new contact_companies link is added
    for any company_short_names not already present. Category is never
    changed on merge (would be too easy to escalate privilege).

    When body.dry_run is true the whole sequence runs inside a single
    transaction that gets rolled back at the end — used by the preview
    step so the user sees real counts before committing.
    """
    _require_edit(user)

    created = 0
    merged = 0
    created_orgs = 0
    created_company_links = 0
    errors: list[dict] = []

    # Cache org lookups within the batch so a sheet with 50 rows pointing
    # at the same firm doesn't create 50 (or hit the unique lookup 50 times).
    org_cache: dict[str, str] = {}
    company_cache: dict[str, Optional[str]] = {}

    for idx, r in enumerate(body.rows):
        try:
            # ---- category gate
            if r.category not in CONTACT_CATEGORIES:
                errors.append({"row": idx, "name": r.full_name,
                               "error": f"Unknown category: {r.category}"})
                continue
            if not can_edit_contact_category(user.roles, r.category):
                errors.append({"row": idx, "name": r.full_name,
                               "error": f"Not allowed to import '{r.category}' contacts"})
                continue

            # ---- organization (auto-create on demand)
            org_id: Optional[str] = None
            if r.organization_name and r.organization_name.strip():
                key = r.organization_name.strip().lower()
                if key in org_cache:
                    org_id = org_cache[key]
                else:
                    # Was it absent before? Track for the response counter.
                    pre_exists = db.execute(
                        text("SELECT 1 FROM organizations WHERE lower(name) = :k"),
                        {"k": key},
                    ).first() is not None
                    org_id = _find_or_create_org(db, r.organization_name, user.id)
                    if not pre_exists:
                        created_orgs += 1
                    org_cache[key] = org_id

            # ---- merge-or-create
            email_norm = _norm_email(r.email)
            phone_norm = _norm_phone_value(r.phone)
            existing = None
            if email_norm:
                existing = db.execute(
                    text("SELECT * FROM contacts WHERE lower(email) = :e LIMIT 1"),
                    {"e": email_norm},
                ).mappings().first()

            if existing:
                # MERGE PATH — refuse if the existing contact is in a category
                # we can't edit. Phone is appended (not overwritten); other
                # fields fill nulls only.
                if not can_edit_contact_category(user.roles, existing["category"]):
                    errors.append({"row": idx, "name": r.full_name,
                                   "error": f"Existing record is in '{existing['category']}', not allowed to merge"})
                    continue
                patch: dict = {}
                new_phone = _merged_phone(existing.get("phone"), phone_norm)
                if new_phone != existing.get("phone"):
                    patch["phone"] = new_phone
                # Fill-only-if-null for the soft fields. Never overwrite.
                for field, incoming in (
                    ("role", r.role),
                    ("organization_id", org_id),
                    ("notes", r.notes),
                ):
                    if incoming and not existing.get(field):
                        patch[field] = incoming
                if patch:
                    set_parts = [f"{k} = :{k}" for k in patch.keys()]
                    db.execute(
                        text(f"UPDATE contacts SET {', '.join(set_parts)} WHERE id = :id"),
                        {**patch, "id": str(existing["id"])},
                    )
                    _log_contact(db, str(existing["id"]), user.id,
                                 "merge_import", new=patch)
                contact_id = str(existing["id"])
                merged += 1
            else:
                # CREATE PATH
                contact_id = str(uuid.uuid4())
                db.execute(
                    text("INSERT INTO contacts (id, full_name, category, role, "
                         "                       email, phone, organization_id, "
                         "                       notes, created_by) "
                         "VALUES (:id, :name, :cat, :role, :email, :phone, "
                         "        :org, :notes, :uid)"),
                    {
                        "id": contact_id,
                        "name": r.full_name.strip(),
                        "cat": r.category,
                        "role": r.role.strip() if r.role else None,
                        "email": email_norm,
                        "phone": phone_norm,
                        "org": org_id,
                        "notes": r.notes,
                        "uid": user.id,
                    },
                )
                _log_contact(db, contact_id, user.id, "create_import",
                             new={"category": r.category, "full_name": r.full_name})
                created += 1

            # ---- company links (idempotent via ON CONFLICT)
            for cname in (r.company_short_names or []):
                cname_stripped = cname.strip()
                if not cname_stripped:
                    continue
                if cname_stripped.lower() in company_cache:
                    company_id = company_cache[cname_stripped.lower()]
                else:
                    company_id = _resolve_company(db, cname_stripped)
                    company_cache[cname_stripped.lower()] = company_id
                if not company_id:
                    # Unknown entity — silent skip; importer shouldn't create
                    # group companies, that's a separate UI flow.
                    continue
                inserted = db.execute(
                    text("INSERT INTO contact_companies (contact_id, company_id, created_by) "
                         "VALUES (:cn, :co, :uid) ON CONFLICT DO NOTHING"),
                    {"cn": contact_id, "co": company_id, "uid": user.id},
                )
                if inserted.rowcount:
                    created_company_links += 1

        except Exception as exc:  # noqa: BLE001
            errors.append({"row": idx, "name": r.full_name,
                           "error": f"{type(exc).__name__}: {exc}"})

    if body.dry_run:
        db.rollback()
    else:
        db.commit()

    return {
        "created": created,
        "merged": merged,
        "created_organizations": created_orgs,
        "created_company_links": created_company_links,
        "errors": errors,
        "dry_run": body.dry_run,
    }


@router.get("/contacts/{contact_id}/activity")
def get_contact_activity(
    contact_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _contact_or_404(db, contact_id, user)
    rows = db.execute(
        text("SELECT * FROM contact_activity WHERE contact_id = :id "
             "ORDER BY created_at DESC LIMIT 200"),
        {"id": contact_id},
    ).mappings().all()
    return [row(r) for r in rows]
