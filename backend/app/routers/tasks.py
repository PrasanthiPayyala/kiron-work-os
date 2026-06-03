import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_create_task, can_update_task
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/tasks", tags=["tasks"])

# Columns the quick-edit drawer / create dialog are allowed to write.
UPDATABLE = {
    "title", "description", "status", "priority", "visibility",
    "due_at", "start_at", "assignee_id", "reviewer_id",
    "reporting_manager_id", "sla_hours", "labels",
}


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    priority: str = "medium"
    status: str = "created"
    company_id: str
    assignee_id: str | None = None
    project_id: str | None = None


class ActivityIn(BaseModel):
    activity_type: str = "comment"
    message: str | None = None
    note: str | None = None


def _get_task(db: Session, task_id: str) -> dict:
    found = db.execute(text("SELECT * FROM tasks WHERE id = :id"), {"id": task_id}).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return row(found)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_task(body: TaskCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    created_by = user.id
    if not can_create_task(created_by, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to create tasks")
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            """
            INSERT INTO tasks (id, title, description, priority, status, company_id,
                               created_by, assignee_id, project_id)
            VALUES (:id, :title, :description, :priority, :status, :company_id,
                    :created_by, :assignee_id, :project_id)
            """
        ),
        {
            "id": new_id,
            "title": body.title,
            "description": body.description,
            "priority": body.priority,
            "status": body.status,
            "company_id": body.company_id,
            "created_by": created_by,
            "assignee_id": body.assignee_id,
            "project_id": body.project_id,
        },
    )
    db.commit()
    return _get_task(db, new_id)


@router.patch("/{task_id}")
def update_task(
    task_id: str,
    patch: dict,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task(db, task_id)
    if not can_update_task(task, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this task")

    fields = {k: v for k, v in patch.items() if k in UPDATABLE}
    if not fields:
        return task

    set_clause = ", ".join(f"{col} = :{col}" for col in fields)
    params = dict(fields)
    params["id"] = task_id
    db.execute(text(f"UPDATE tasks SET {set_clause} WHERE id = :id"), params)
    db.commit()
    return _get_task(db, task_id)


@router.post("/{task_id}/activity", status_code=status.HTTP_201_CREATED)
def add_activity(
    task_id: str,
    body: ActivityIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task(db, task_id)
    if not can_update_task(task, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to comment on this task")
    new_id = str(uuid.uuid4())
    db.execute(
        text(
            """
            INSERT INTO task_activity (id, task_id, actor_user_id, activity_type, message, note)
            VALUES (:id, :task_id, :actor, :atype, :message, :note)
            """
        ),
        {
            "id": new_id,
            "task_id": task_id,
            "actor": user.id,
            "atype": body.activity_type,
            "message": body.message,
            "note": body.note,
        },
    )
    db.commit()
    return {"id": new_id}
