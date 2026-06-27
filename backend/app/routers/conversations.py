"""Conversations + members + per-user read state.

Designed to replace 'use WhatsApp to talk to colleagues': anyone in the org can
start a 1:1 DM, or create a named group with multiple members. Unread badges
are driven by `conversation_members.last_read_at` vs. the latest message.

Endpoints
---------
POST   /conversations                       create a DM or group
GET    /conversations/{id}/messages         paginated message list
POST   /conversations/{id}/members          add a member (group only)
DELETE /conversations/{id}/members/{uid}    remove a member (self or admin)
POST   /conversations/{id}/read             mark all-read up to now
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/conversations", tags=["chat"])

ELEVATED = {"super_admin", "founder"}


def _membership(db: Session, conv_id: str, uid: str) -> Optional[dict]:
    r = db.execute(
        text(
            "SELECT id, member_role, last_read_at "
            "FROM conversation_members WHERE conversation_id = :c AND user_id = :u"
        ),
        {"c": conv_id, "u": uid},
    ).mappings().first()
    return dict(r) if r else None


def _require_member(db: Session, conv_id: str, user: CurrentUser) -> dict:
    m = _membership(db, conv_id, user.id)
    if m is None and not (user.roles & ELEVATED):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this conversation")
    return m or {"member_role": "shadow_admin"}


# ---------- create ----------

class ConversationCreate(BaseModel):
    channel_type: str = Field(..., description="direct | team_group | company_group | project_group | announcement")
    title: Optional[str] = None
    member_ids: list[str] = Field(default_factory=list)
    company_id: Optional[str] = None
    project_id: Optional[str] = None
    task_id: Optional[str] = None


@router.post("", status_code=status.HTTP_201_CREATED)
def create_conversation(
    body: ConversationCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.channel_type not in {"direct", "team_group", "company_group", "project_group", "announcement"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown channel_type")

    # Direct messages: enforce exactly two distinct members, dedupe if a DM
    # already exists between the same pair.
    members = list({*body.member_ids, user.id})
    if body.channel_type == "direct":
        if len(members) != 2:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "DM requires exactly 2 members")
        existing = db.execute(
            text(
                """
                SELECT c.id
                FROM conversations c
                JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = :a
                JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = :b
                WHERE c.channel_type = 'direct'
                LIMIT 1
                """
            ),
            {"a": members[0], "b": members[1]},
        ).first()
        if existing:
            return {"id": str(existing[0]), "reused": True}

    if body.channel_type in {"team_group", "project_group"} and not body.title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "title required for group conversations")

    conv_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO conversations (id, channel_type, title, company_id, project_id, task_id, created_by) "
            "VALUES (:id, :ct, :title, :co, :pr, :tk, :uid)"
        ),
        {"id": conv_id, "ct": body.channel_type, "title": body.title,
         "co": body.company_id, "pr": body.project_id, "tk": body.task_id, "uid": user.id},
    )
    for uid in members:
        member_role = "owner" if uid == user.id else "member"
        db.execute(
            text(
                "INSERT INTO conversation_members (conversation_id, user_id, member_role, last_read_at) "
                "VALUES (:c, :u, :r, now())"
            ),
            {"c": conv_id, "u": uid, "r": member_role},
        )
    db.commit()

    created = db.execute(
        text("SELECT * FROM conversations WHERE id = :id"), {"id": conv_id}
    ).mappings().first()
    return {**row(created), "member_ids": members}


# ---------- messages list ----------

@router.get("/{conv_id}/messages")
def list_messages(
    conv_id: str,
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None, description="ISO timestamp; returns messages created strictly before this"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, conv_id, user)
    is_elevated = bool(user.roles & ELEVATED)
    params: dict = {"c": conv_id, "lim": limit, "uid": user.id}
    where_before = ""
    if before:
        where_before = " AND created_at < :before"
        params["before"] = before
    # Per-viewer hide: non-elevated viewers filter out messages they hid.
    # Founder + super_admin see everything (with hidden_by attached below).
    hide_filter = "" if is_elevated else (
        " AND NOT EXISTS (SELECT 1 FROM message_hides h "
        "WHERE h.message_id = messages.id AND h.user_id = :uid)"
    )
    rows = db.execute(
        text(
            "SELECT * FROM messages WHERE conversation_id = :c" + where_before + hide_filter +
            " ORDER BY created_at DESC LIMIT :lim"
        ),
        params,
    ).mappings().all()
    # Pull attachments for these messages in one round-trip.
    msg_ids = [str(r["id"]) for r in rows]
    attachments: dict[str, list[dict]] = {}
    hidden_by: dict[str, list[str]] = {}
    if msg_ids:
        att_rows = db.execute(
            text(
                "SELECT id, entity_id, file_name, file_size, mime_type "
                "FROM attachments WHERE entity_type = 'message' AND entity_id = ANY(:ids)"
            ),
            {"ids": msg_ids},
        ).mappings().all()
        for a in att_rows:
            attachments.setdefault(str(a["entity_id"]), []).append({
                "id": str(a["id"]),
                "file_name": a["file_name"],
                "file_size": a["file_size"],
                "mime_type": a["mime_type"],
            })
        # Elevated viewers see who hid each message (audit marker).
        if is_elevated:
            hide_rows = db.execute(
                text(
                    "SELECT message_id, user_id FROM message_hides "
                    "WHERE message_id = ANY(:ids)"
                ),
                {"ids": msg_ids},
            ).mappings().all()
            for h in hide_rows:
                hidden_by.setdefault(str(h["message_id"]), []).append(str(h["user_id"]))
    return {
        "messages": [
            {
                **row(r),
                "attachments": attachments.get(str(r["id"]), []),
                **({"hidden_by": hidden_by.get(str(r["id"]), [])} if is_elevated else {}),
            }
            for r in reversed(rows)
        ],
    }


# ---------- members ----------

class MemberAdd(BaseModel):
    user_id: str


@router.post("/{conv_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(
    conv_id: str,
    body: MemberAdd,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    me = _require_member(db, conv_id, user)
    conv = db.execute(
        text("SELECT channel_type FROM conversations WHERE id = :id"), {"id": conv_id}
    ).mappings().first()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if conv["channel_type"] == "direct":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot add members to a DM; create a group")
    # owners + elevated can add anyone; members can add as well (groups are open by default)
    if me.get("member_role") not in {"owner", "admin", "shadow_admin", "member"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    try:
        db.execute(
            text(
                "INSERT INTO conversation_members (conversation_id, user_id, member_role, last_read_at) "
                "VALUES (:c, :u, 'member', now()) ON CONFLICT DO NOTHING"
            ),
            {"c": conv_id, "u": body.user_id},
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return {"conversation_id": conv_id, "user_id": body.user_id}


@router.delete("/{conv_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    conv_id: str,
    user_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    me = _require_member(db, conv_id, user)
    # Only allow self-removal, or owner/admin removing others.
    if user_id != user.id and me.get("member_role") not in {"owner", "admin", "shadow_admin"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot remove other members")
    db.execute(
        text("DELETE FROM conversation_members WHERE conversation_id = :c AND user_id = :u"),
        {"c": conv_id, "u": user_id},
    )
    db.commit()
    return None


# ---------- read state ----------

# ---------- per-viewer hide (delete chat from my view) ----------
# Founder + super_admin always see the chat regardless of hides — they
# have the audit responsibility. Auto-unhide on new message arrives via
# the trigger installed in migration 0016, so a hidden conversation
# reappears the moment someone messages there again.


@router.post("/{conv_id}/hide", status_code=status.HTTP_204_NO_CONTENT)
def hide_conversation(
    conv_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, conv_id, user)
    db.execute(
        text(
            "INSERT INTO conversation_hides (conversation_id, user_id) VALUES (:c, :u) "
            "ON CONFLICT DO NOTHING"
        ),
        {"c": conv_id, "u": user.id},
    )
    db.commit()
    return None


@router.delete("/{conv_id}/hide", status_code=status.HTTP_204_NO_CONTENT)
def unhide_conversation(
    conv_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.execute(
        text("DELETE FROM conversation_hides WHERE conversation_id = :c AND user_id = :u"),
        {"c": conv_id, "u": user.id},
    )
    db.commit()
    return None


@router.post("/{conv_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(
    conv_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, conv_id, user)
    db.execute(
        text(
            "UPDATE conversation_members SET last_read_at = now() "
            "WHERE conversation_id = :c AND user_id = :u"
        ),
        {"c": conv_id, "u": user.id},
    )
    # Also mark any per-message bell notifications for this conversation as
    # read so the bell badge doesn't keep counting stale entries after the
    # user has caught up in chat. Links are written by chat.send() as
    # "/chat?conv=<id>", so a LIKE match is enough.
    db.execute(
        text(
            "UPDATE notifications SET is_read = true "
            "WHERE user_id = :u AND link = :link AND is_read = false"
        ),
        {"u": user.id, "link": f"/chat?conv={conv_id}"},
    )
    db.commit()
    return None
