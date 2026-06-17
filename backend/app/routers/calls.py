"""Scheduled task calls.

A "call" attaches to a task — a meeting touchpoint (kickoff, follow-up,
sign-off, demo). Each call has a scheduled time, duration, optional
meeting link (paste Zoom/Meet/Teams URL), notes, and a participants
list. The scheduler (app/scheduler.py) sends three email reminders:
``morning_of`` at 09:00 IST on the day, ``t_minus_20`` 20 minutes before
the scheduled time, and ``t_zero`` at the scheduled time.

Authz mirrors the parent task — anyone who can update the task can
schedule, edit, or cancel a call on it. Participants are pre-filled from
the task's assignee + reviewer + reporting_manager, but the creator can
add or remove anyone.
"""
import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_update_task
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(tags=["calls"])


class CallCreate(BaseModel):
    scheduled_at: dt.datetime
    duration_mins: int = Field(30, ge=5, le=600)
    meeting_link: str | None = None
    notes: str | None = None
    participant_ids: list[str] = Field(default_factory=list)


class CallUpdate(BaseModel):
    scheduled_at: dt.datetime | None = None
    duration_mins: int | None = Field(None, ge=5, le=600)
    meeting_link: str | None = None
    notes: str | None = None
    participant_ids: list[str] | None = None


def _get_task(db: Session, task_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM tasks WHERE id = :id"), {"id": task_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return row(found)


def _get_call(db: Session, call_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM task_calls WHERE id = :id"), {"id": call_id}
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
    return row(found)


def _participants(db: Session, call_id: str) -> list[str]:
    rows = db.execute(
        text("SELECT user_id FROM task_call_participants WHERE call_id = :c"),
        {"c": call_id},
    ).mappings().all()
    return [str(r["user_id"]) for r in rows]


def _set_participants(db: Session, call_id: str, user_ids: list[str]) -> None:
    db.execute(
        text("DELETE FROM task_call_participants WHERE call_id = :c"),
        {"c": call_id},
    )
    for uid in {u for u in user_ids if u}:
        db.execute(
            text(
                "INSERT INTO task_call_participants (call_id, user_id) "
                "VALUES (:c, :u) ON CONFLICT DO NOTHING"
            ),
            {"c": call_id, "u": uid},
        )


@router.post("/tasks/{task_id}/calls", status_code=status.HTTP_201_CREATED)
def create_call(
    task_id: str,
    body: CallCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task(db, task_id)
    if not can_update_task(task, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to schedule a call on this task")
    if body.scheduled_at < dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Scheduled time must be in the future")

    new_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO task_calls (id, task_id, scheduled_at, duration_mins, "
            "                        meeting_link, notes, created_by) "
            "VALUES (:id, :tid, :at, :dur, :link, :notes, :cb)"
        ),
        {
            "id": new_id, "tid": task_id, "at": body.scheduled_at,
            "dur": body.duration_mins, "link": body.meeting_link,
            "notes": body.notes, "cb": user.id,
        },
    )

    # Default participants = assignee + reviewer + reporting manager + creator.
    # The dialog passes them explicitly so the user can untick anyone; if it
    # passes an empty list we fall back so a call always has at least the creator.
    parts = list(body.participant_ids) or [
        x for x in [
            task.get("assignee_id"),
            task.get("reviewer_id"),
            task.get("reporting_manager_id"),
            user.id,
        ] if x
    ]
    _set_participants(db, new_id, parts)
    db.commit()
    return {**_get_call(db, new_id), "participant_ids": _participants(db, new_id)}


@router.get("/tasks/{task_id}/calls")
def list_calls(
    task_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task(db, task_id)
    # If you can update the task, you definitely see its calls. Otherwise
    # we check task viewability via project membership — handled by the
    # same predicate the bootstrap uses.
    if not can_update_task(task, user.id, user.roles):
        member_project_ids = {
            r[0] for r in db.execute(
                text("SELECT project_id FROM project_members WHERE user_id = :uid"),
                {"uid": user.id},
            ).all()
        }
        from ..authz import can_view_task
        if not can_view_task(task, user.id, user.roles, member_project_ids):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to view this task")
    rows = db.execute(
        text(
            "SELECT * FROM task_calls WHERE task_id = :tid "
            "ORDER BY scheduled_at DESC LIMIT 200"
        ),
        {"tid": task_id},
    ).mappings().all()
    out = []
    for r in rows:
        c = row(r)
        c["participant_ids"] = _participants(db, c["id"])
        out.append(c)
    return out


@router.patch("/calls/{call_id}")
def update_call(
    call_id: str,
    patch: CallUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    call = _get_call(db, call_id)
    task = _get_task(db, call["task_id"])
    if not can_update_task(task, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this call")
    if call["status"] != "scheduled":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only scheduled calls can be edited")

    fields = patch.model_dump(exclude_unset=True)
    parts = fields.pop("participant_ids", None)
    if "scheduled_at" in fields and fields["scheduled_at"] is not None:
        if fields["scheduled_at"] < dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Scheduled time must be in the future")

    set_parts: list[str] = []
    params: dict = {"id": call_id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    if set_parts:
        db.execute(
            text(f"UPDATE task_calls SET {', '.join(set_parts)} WHERE id = :id"),
            params,
        )
        # If the time moved, forget that we already sent reminders so the
        # scheduler can re-fire for the new slot.
        if "scheduled_at" in fields:
            db.execute(
                text("DELETE FROM task_call_reminders WHERE call_id = :c"),
                {"c": call_id},
            )
    if parts is not None:
        _set_participants(db, call_id, parts)
    db.commit()
    return {**_get_call(db, call_id), "participant_ids": _participants(db, call_id)}


@router.post("/calls/{call_id}/cancel", status_code=status.HTTP_200_OK)
def cancel_call(
    call_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    call = _get_call(db, call_id)
    task = _get_task(db, call["task_id"])
    if not can_update_task(task, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to cancel this call")
    if call["status"] == "cancelled":
        return call
    db.execute(
        text(
            "UPDATE task_calls SET status = 'cancelled', cancelled_at = now(), "
            "cancelled_by = :u WHERE id = :id"
        ),
        {"u": user.id, "id": call_id},
    )
    db.commit()
    return {**_get_call(db, call_id), "participant_ids": _participants(db, call_id)}
