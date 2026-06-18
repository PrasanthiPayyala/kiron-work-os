"""Teams — flexible groupings.

A team is a named set of people. Each team has:

- a ``kind`` (project / hackathon / hr / founders_office /
  client_internal / client_external / functional / ad_hoc) — drives
  the icon + grouping in the UI;
- an optional ``company_id`` (if scoped to one group entity);
- an optional ``client_org_id`` (links to organizations.id for client
  teams) — also nullable, since most teams aren't client-facing;
- a ``conversation_id`` — auto-created on team create so members can
  chat without a separate step.

Authz:
- Anyone can create. Creator becomes owner.
- Members can read.
- Owner / admin / super_admin / founder can edit + manage members.
- super_admin / founder / founder_office_coordinator see all teams
  regardless of membership.
"""
import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import has_any_role
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/teams", tags=["teams"])

TEAM_KINDS = {
    "project", "hackathon", "hr", "founders_office",
    "client_internal", "client_external", "functional", "ad_hoc",
}
TEAM_ADMIN_ROLES = {"owner", "admin"}
GLOBAL_TEAM_ROLES = {"super_admin", "founder", "founder_office_coordinator"}


class TeamCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    kind: Literal[
        "project", "hackathon", "hr", "founders_office",
        "client_internal", "client_external", "functional", "ad_hoc",
    ] = "project"
    description: str | None = None
    company_id: str | None = None
    client_org_id: str | None = None
    member_ids: list[str] = Field(default_factory=list)


class TeamUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    kind: str | None = None
    description: str | None = None
    company_id: str | None = None
    client_org_id: str | None = None
    is_active: bool | None = None


class MemberAdd(BaseModel):
    user_id: str
    member_role: Literal["owner", "admin", "member"] = "member"


def _slugify(name: str) -> str:
    """Lowercase-dashed slug. Unique-suffix handling is in create_team."""
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "team"


def _get_team(db: Session, team_id: str) -> dict:
    r = db.execute(text("SELECT * FROM teams WHERE id = :id"), {"id": team_id}).mappings().first()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")
    return row(r)


def _membership(db: Session, team_id: str, uid: str) -> dict | None:
    r = db.execute(
        text("SELECT member_role FROM team_members WHERE team_id = :t AND user_id = :u"),
        {"t": team_id, "u": uid},
    ).mappings().first()
    return dict(r) if r else None


def _is_team_admin(db: Session, team: dict, uid: str, roles: set[str]) -> bool:
    if has_any_role(roles, GLOBAL_TEAM_ROLES):
        return True
    if str(team.get("owner_id") or "") == uid:
        return True
    m = _membership(db, team["id"], uid)
    return bool(m and m["member_role"] in TEAM_ADMIN_ROLES)


def _can_see(db: Session, team: dict, uid: str, roles: set[str]) -> bool:
    if has_any_role(roles, GLOBAL_TEAM_ROLES):
        return True
    return _membership(db, team["id"], uid) is not None


def _member_ids(db: Session, team_id: str) -> list[str]:
    rows = db.execute(
        text("SELECT user_id FROM team_members WHERE team_id = :t"),
        {"t": team_id},
    ).all()
    return [str(r[0]) for r in rows]


def _create_team_chat(db: Session, team_id: str, name: str, member_ids: list[str], owner_id: str) -> str | None:
    """Spin up a team_group conversation so the team can chat
    immediately. Returns the new conversation id, or None if no
    members (no chat needed yet). Members are added with member_role
    'owner' for the creator, 'member' for everyone else."""
    if not member_ids:
        return None
    conv_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO conversations (id, channel_type, title, created_by) "
            "VALUES (:id, 'team_group', :title, :uid)"
        ),
        {"id": conv_id, "title": name, "uid": owner_id},
    )
    for uid in member_ids:
        member_role = "owner" if uid == owner_id else "member"
        db.execute(
            text(
                "INSERT INTO conversation_members (conversation_id, user_id, member_role, last_read_at) "
                "VALUES (:c, :u, :r, now())"
            ),
            {"c": conv_id, "u": uid, "r": member_role},
        )
    return conv_id


@router.post("", status_code=status.HTTP_201_CREATED)
def create_team(
    body: TeamCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.kind not in TEAM_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown team kind: {body.kind}")

    # Slug uniqueness: keep retrying with -2, -3, ... until we land. Small N
    # so the loop never costs anything in practice.
    base_slug = _slugify(body.name)
    slug = base_slug
    n = 2
    while db.execute(text("SELECT 1 FROM teams WHERE slug = :s"), {"s": slug}).first():
        slug = f"{base_slug}-{n}"
        n += 1
        if n > 50:
            raise HTTPException(status.HTTP_409_CONFLICT, "Could not generate a unique slug — pick a different name")

    # Creator is always a member + owner.
    member_set = list({user.id, *body.member_ids})

    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO teams (id, name, slug, kind, description, owner_id, "
            "                   company_id, client_org_id, created_by) "
            "VALUES (:id, :name, :slug, :kind, :desc, :owner, :co, :org, :cb)"
        ),
        {
            "id": new_id, "name": body.name.strip(), "slug": slug,
            "kind": body.kind, "desc": body.description,
            "owner": user.id, "co": body.company_id, "org": body.client_org_id,
            "cb": user.id,
        },
    )

    for uid in member_set:
        member_role = "owner" if uid == user.id else "member"
        db.execute(
            text(
                "INSERT INTO team_members (team_id, user_id, member_role, added_by) "
                "VALUES (:t, :u, :r, :ab) ON CONFLICT DO NOTHING"
            ),
            {"t": new_id, "u": uid, "r": member_role, "ab": user.id},
        )

    conv_id = _create_team_chat(db, new_id, body.name.strip(), member_set, user.id)
    if conv_id:
        db.execute(
            text("UPDATE teams SET conversation_id = :c WHERE id = :id"),
            {"c": conv_id, "id": new_id},
        )

    db.commit()
    team = _get_team(db, new_id)
    return {**team, "member_ids": _member_ids(db, new_id)}


@router.get("")
def list_teams(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List teams the caller can see. Global roles see all; everyone
    else only sees teams they belong to. Inactive teams included so the
    UI can render an archived section."""
    if has_any_role(user.roles, GLOBAL_TEAM_ROLES):
        rows = db.execute(text("SELECT * FROM teams ORDER BY created_at DESC")).mappings().all()
    else:
        rows = db.execute(
            text(
                "SELECT t.* FROM teams t "
                "JOIN team_members m ON m.team_id = t.id "
                "WHERE m.user_id = :uid "
                "ORDER BY t.created_at DESC"
            ),
            {"uid": user.id},
        ).mappings().all()
    team_ids = [str(r["id"]) for r in rows]
    members_by_team: dict[str, list[str]] = {}
    if team_ids:
        m_rows = db.execute(
            text("SELECT team_id, user_id FROM team_members WHERE team_id = ANY(:ids)"),
            {"ids": team_ids},
        ).mappings().all()
        for m in m_rows:
            members_by_team.setdefault(str(m["team_id"]), []).append(str(m["user_id"]))
    return [
        {**row(r), "member_ids": members_by_team.get(str(r["id"]), [])}
        for r in rows
    ]


@router.get("/{team_id}")
def get_team(
    team_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    if not _can_see(db, team, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this team")
    return {**team, "member_ids": _member_ids(db, team_id)}


@router.patch("/{team_id}")
def update_team(
    team_id: str,
    patch: TeamUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    if not _is_team_admin(db, team, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner / admin can edit this team")

    fields = patch.model_dump(exclude_unset=True)
    if "kind" in fields and fields["kind"] not in TEAM_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown team kind: {fields['kind']}")
    if not fields:
        return {**team, "member_ids": _member_ids(db, team_id)}

    set_parts: list[str] = []
    params: dict = {"id": team_id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    db.execute(text(f"UPDATE teams SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    return {**_get_team(db, team_id), "member_ids": _member_ids(db, team_id)}


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    # Hard delete is gated to super_admin / founder. Owner / admin can
    # archive (set is_active=false) via PATCH.
    if not has_any_role(user.roles, {"super_admin", "founder"}):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only super_admin / founder can delete a team")
    db.execute(text("DELETE FROM teams WHERE id = :id"), {"id": team_id})
    db.commit()
    return None


@router.post("/{team_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(
    team_id: str,
    body: MemberAdd,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    if not _is_team_admin(db, team, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner / admin can add members")
    db.execute(
        text(
            "INSERT INTO team_members (team_id, user_id, member_role, added_by) "
            "VALUES (:t, :u, :r, :ab) ON CONFLICT (team_id, user_id) DO NOTHING"
        ),
        {"t": team_id, "u": body.user_id, "r": body.member_role, "ab": user.id},
    )
    # Mirror the add into the team's chat conversation so the new
    # member sees the channel + history immediately.
    if team.get("conversation_id"):
        db.execute(
            text(
                "INSERT INTO conversation_members (conversation_id, user_id, member_role, last_read_at) "
                "VALUES (:c, :u, 'member', now()) ON CONFLICT DO NOTHING"
            ),
            {"c": team["conversation_id"], "u": body.user_id},
        )
    db.commit()
    return {"team_id": team_id, "user_id": body.user_id}


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    team_id: str,
    user_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    # Self-removal is allowed; otherwise owner / admin / global only.
    if user_id != user.id and not _is_team_admin(db, team, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot remove other members")
    # The owner can't remove themselves — block that to keep the team
    # always having an owner. Reassign first (V2).
    if user_id == str(team.get("owner_id") or ""):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Owner cannot leave the team — transfer ownership first")
    db.execute(
        text("DELETE FROM team_members WHERE team_id = :t AND user_id = :u"),
        {"t": team_id, "u": user_id},
    )
    if team.get("conversation_id"):
        db.execute(
            text("DELETE FROM conversation_members WHERE conversation_id = :c AND user_id = :u"),
            {"c": team["conversation_id"], "u": user_id},
        )
    db.commit()
    return None
