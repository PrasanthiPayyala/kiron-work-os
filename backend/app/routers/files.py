"""File uploads + downloads, backed by the local filesystem.

Two-step flow for chat:
    1. POST /files  → uploads one file, returns an attachment row (entity_id NULL)
    2. POST /messages with attachment_ids=[...] → patches each attachment to
       reference the new message.

For task attachments / general use, set entity_type + entity_id at upload time.

Storage layout on disk: ``$FILES_DIR/<attachment_id>/<original-filename>``.
The original filename is preserved (after sanitising) so the browser can save
it with a sensible name; FILES_DIR is set in /etc/kiron/backend.env.
"""
import os
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/files", tags=["files"])

# Per-file size cap. nginx also enforces client_max_body_size 25m by default.
MAX_BYTES = 25 * 1024 * 1024
FILES_DIR = Path(os.environ.get("FILES_DIR", "/var/lib/kiron/files"))
SAFE_NAME = re.compile(r"[^A-Za-z0-9._\-]+")


def _sanitize(name: str) -> str:
    # Strip any path separators an attacker might smuggle via Content-Disposition.
    name = name.replace("\\", "/").split("/")[-1] or "file"
    name = SAFE_NAME.sub("_", name).lstrip(".")
    return name[:200] or "file"


def _resolve_storage(att_id: str, filename: str) -> Path:
    base = FILES_DIR / att_id
    base.mkdir(parents=True, exist_ok=True)
    return base / filename


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload(
    file: UploadFile = File(...),
    entity_type: Optional[str] = Form(None),
    entity_id: Optional[str] = Form(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    att_id = str(uuid.uuid4())
    safe_name = _sanitize(file.filename or "file")
    target = _resolve_storage(att_id, safe_name)

    # Stream to disk while measuring size. UploadFile is already a spooled
    # temp file; copy in chunks to avoid loading huge files into memory.
    written = 0
    with target.open("wb") as out:
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_BYTES:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                    f"File exceeds {MAX_BYTES // (1024*1024)}MB limit")
            out.write(chunk)

    db.execute(
        text(
            "INSERT INTO attachments (id, entity_type, entity_id, file_name, file_url, "
            "file_size, mime_type, uploaded_by, storage_path) "
            "VALUES (:id, :et, :eid, :fn, :url, :sz, :mt, :uid, :sp)"
        ),
        {
            "id": att_id,
            "et": entity_type,
            "eid": entity_id,
            "fn": file.filename or safe_name,
            "url": f"/files/{att_id}",   # URL clients use to GET the bytes
            "sz": written,
            "mt": file.content_type,
            "uid": user.id,
            "sp": str(target),
        },
    )
    db.commit()

    saved = db.execute(text("SELECT * FROM attachments WHERE id = :id"), {"id": att_id}).mappings().first()
    return row(saved)


@router.get("/{attachment_id}")
def download(
    attachment_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    att = db.execute(
        text("SELECT * FROM attachments WHERE id = :id"), {"id": attachment_id}
    ).mappings().first()
    if not att:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")

    # Ownership / visibility check.
    #   - uploader can always read their own file
    #   - if linked to a message, recipient must be a member of the conversation
    #   - if linked to a task, must be assignee/reviewer/creator/manager OR a project member
    #   - elevated roles always allowed
    allowed = (
        str(att["uploaded_by"]) == user.id
        or user.roles & {"super_admin", "founder"}
    )
    if not allowed and att["entity_type"] == "message" and att["entity_id"]:
        is_member = db.execute(
            text(
                "SELECT 1 FROM messages m "
                "JOIN conversation_members cm ON cm.conversation_id = m.conversation_id "
                "WHERE m.id = :mid AND cm.user_id = :uid"
            ),
            {"mid": str(att["entity_id"]), "uid": user.id},
        ).first()
        allowed = is_member is not None
    if not allowed and att["entity_type"] == "task" and att["entity_id"]:
        on_task = db.execute(
            text(
                "SELECT 1 FROM tasks t WHERE t.id = :tid AND ("
                "  t.assignee_id = :u OR t.reviewer_id = :u OR t.created_by = :u "
                "  OR t.reporting_manager_id = :u OR EXISTS ("
                "    SELECT 1 FROM project_members pm "
                "    WHERE pm.project_id = t.project_id AND pm.user_id = :u))"
            ),
            {"tid": str(att["entity_id"]), "u": user.id},
        ).first()
        allowed = on_task is not None

    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to read this file")

    storage = att.get("storage_path")
    if not storage or not Path(storage).is_file():
        raise HTTPException(status.HTTP_410_GONE, "File bytes missing on disk")
    return FileResponse(
        storage,
        media_type=att.get("mime_type") or "application/octet-stream",
        filename=att.get("file_name") or attachment_id,
    )
