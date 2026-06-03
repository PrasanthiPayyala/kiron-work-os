"""POST /messages — send a chat message, optionally with already-uploaded files.

File flow:
    1. Client uploads files via POST /files → gets attachment IDs back.
    2. Client posts the message body + attachment_ids here.
    3. We create the message row, patch each attachment to point at it, and
       broadcast the enriched row over WebSocket so other recipients see it
       without refreshing.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row
from . import ws as ws_router

router = APIRouter(prefix="/messages", tags=["chat"])

CONV_ELEVATED = {"super_admin", "founder"}


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

    # Fire-and-forget WebSocket fan-out to every conversation member.
    try:
        ws_router.fire_message_new(payload, body.conversation_id)
    except RuntimeError:
        # No running event loop (e.g. unit tests) — skip broadcast.
        pass

    return payload
