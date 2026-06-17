"""POST /messages — send a chat message, optionally with already-uploaded files.

File flow:
    1. Client uploads files via POST /files → gets attachment IDs back.
    2. Client posts the message body + attachment_ids here.
    3. We create the message row, patch each attachment to point at it, and
       broadcast the enriched row over WebSocket so other recipients see it
       without refreshing.
"""
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row
from . import ws as ws_router

router = APIRouter(prefix="/messages", tags=["chat"])

CONV_ELEVATED = {"super_admin", "founder"}
# Who can delete somebody *else's* message (moderation / confidentiality
# cleanup). The sender of a message can always delete their own.
DELETE_ANYONE_ROLES = {"super_admin", "founder"}


class MessageCreate(BaseModel):
    conversation_id: str
    body: str = Field(default="")
    parent_message_id: str | None = None
    attachment_ids: list[str] = Field(default_factory=list)


def _is_member(db: Session, conv_id: str, uid: str) -> bool:
    found = db.execute(
        text("SELECT 1 FROM conversation_members WHERE conversation_id = :cid AND user_id = :uid"),
        {"cid": conv_id, "uid": uid},
    ).first()
    return found is not None


@router.post("", status_code=status.HTTP_201_CREATED)
def send(
    body: MessageCreate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.body.strip() and not body.attachment_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message must have text or at least one attachment")
    if not (_is_member(db, body.conversation_id, user.id) or user.roles & CONV_ELEVATED):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this conversation")

    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO messages (id, conversation_id, sender_id, body, parent_message_id) "
            "VALUES (:id, :cid, :uid, :body, :parent)"
        ),
        {"id": new_id, "cid": body.conversation_id, "uid": user.id,
         "body": body.body, "parent": body.parent_message_id},
    )

    # Bump conversation preview for the sidebar listing.
    db.execute(
        text(
            "UPDATE conversations SET last_message_at = now(), "
            "last_message_preview = :p WHERE id = :id"
        ),
        {"p": (body.body[:120] if body.body else "(attachment)"), "id": body.conversation_id},
    )

    # Link any pre-uploaded attachments to this message. Only patch rows the
    # current user uploaded — prevents stealing someone else's orphan upload.
    attachments_meta: list[dict] = []
    if body.attachment_ids:
        rows = db.execute(
            text(
                "UPDATE attachments SET entity_type = 'message', entity_id = :mid "
                "WHERE id = ANY(:ids) AND uploaded_by = :uid "
                "RETURNING id, file_name, file_size, mime_type"
            ),
            {"mid": new_id, "ids": body.attachment_ids, "uid": user.id},
        ).mappings().all()
        attachments_meta = [
            {"id": str(r["id"]), "file_name": r["file_name"],
             "file_size": r["file_size"], "mime_type": r["mime_type"]}
            for r in rows
        ]

    db.commit()
    saved = db.execute(text("SELECT * FROM messages WHERE id = :id"), {"id": new_id}).mappings().first()
    payload = {**row(saved), "attachments": attachments_meta}

    # Schedule the WebSocket fan-out as a background task. FastAPI runs it on
    # the main event loop AFTER returning the response, so the sender's POST
    # isn't blocked and the broadcast actually fires (the older
    # asyncio.create_task path silently failed from the threadpool).
    background.add_task(ws_router.message_new, payload, body.conversation_id)

    return payload


@router.delete("/{message_id}")
def delete(
    message_id: str,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft-delete a chat message — sets deleted_at + deleted_by, body stays
    in place for the audit row. The UI renders a tombstone. Sender can
    delete their own; super_admin and founder can delete anyone's.

    Already-deleted messages return 200 (idempotent) so retries are safe.
    """
    msg = db.execute(
        text("SELECT id, conversation_id, sender_id, deleted_at FROM messages WHERE id = :id"),
        {"id": message_id},
    ).mappings().first()
    if not msg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if msg["deleted_at"] is not None:
        return {"id": message_id, "already_deleted": True}

    is_sender = str(msg["sender_id"]) == user.id
    is_mod = bool(user.roles & DELETE_ANYONE_ROLES)
    if not (is_sender or is_mod):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the sender or an admin can delete this message")

    db.execute(
        text("UPDATE messages SET deleted_at = now(), deleted_by = :u WHERE id = :id"),
        {"u": user.id, "id": message_id},
    )
    db.commit()

    updated = db.execute(
        text("SELECT * FROM messages WHERE id = :id"), {"id": message_id}
    ).mappings().first()
    payload = row(updated)

    background.add_task(ws_router.message_deleted, payload, str(msg["conversation_id"]))
    return payload


# ----------------------------------------------------------------------
# Per-viewer hides (delete-from-my-view).
#
# Employees see exactly what they haven't hidden. Founder + super_admin
# see everything regardless of hides — that's the audit layer. The UI
# also surfaces a "Hidden by X" tag to those two roles so the audit
# trail is visible at a glance.
#
# Hiding is silent: no broadcast, no tombstone for others, no warning
# dialog on the client. The user simply doesn't see the row anymore.
# ----------------------------------------------------------------------


@router.post("/{message_id}/hide", status_code=status.HTTP_204_NO_CONTENT)
def hide_message(
    message_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.execute(
        text("SELECT conversation_id FROM messages WHERE id = :id"),
        {"id": message_id},
    ).mappings().first()
    if not msg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    # Only members of the conversation (or elevated) can interact with it.
    if not (_is_member(db, str(msg["conversation_id"]), user.id) or user.roles & CONV_ELEVATED):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this conversation")
    db.execute(
        text(
            "INSERT INTO message_hides (message_id, user_id) VALUES (:m, :u) "
            "ON CONFLICT DO NOTHING"
        ),
        {"m": message_id, "u": user.id},
    )
    db.commit()
    return None


@router.delete("/{message_id}/hide", status_code=status.HTTP_204_NO_CONTENT)
def unhide_message(
    message_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.execute(
        text("DELETE FROM message_hides WHERE message_id = :m AND user_id = :u"),
        {"m": message_id, "u": user.id},
    )
    db.commit()
    return None


# Conversation-level hide endpoints live in routers/conversations.py
# (same prefix as the existing GET /conversations endpoints).
