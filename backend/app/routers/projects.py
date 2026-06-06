"""Projects CRUD + member management.

Endpoints
---------
POST   /projects                          create
PATCH  /projects/{id}                     update fields (owner/manager/global)
DELETE /projects/{id}                     delete (cascades to project_members;
                                          tasks lose their project_id link)
POST   /projects/{id}/members             add a member
DELETE /projects/{id}/members/{user_id}   remove a member

Conventions match the rest of the backend: SQLAlchemy `text()` queries,
`row()` for psycopg → dict, authz checks before any write.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..authz import can_create_project, can_manage_project
from ..db import get_db
from ..deps import CurrentUser, get_current_user
from ..util import row

router = APIRouter(prefix="/projects", tags=["projects"])

ALLOWED_STATUS = {"draft", "planning", "active", "on_hold", "completed", "at_risk"}
ALLOWED_RISK = {"low", "medium", "high"}


def _get(db: Session, project_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM projects WHERE id = :id"), {"id": project_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return row(found)


# ---------- Create ----------

class ProjectCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    company_id: str
    department_id: Optional[str] = None
    owner_id: Optional[str] = None
    approver_id: Optional[str] = None
    status: str = "active"
    risk_level: str = "medium"
    visibility: str = "team"
    is_strategic: bool = False
    progress: int = Field(0, ge=0, le=100)
    start_date: Optional[str] = None  # YYYY-MM-DD
    due_date: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    member_ids: list[str] = Field(default_factory=list)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not can_create_project(user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to create projects")
    if body.status not in ALLOWED_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_STATUS)}")
    if body.risk_level not in ALLOWED_RISK:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"risk_level must be one of {sorted(ALLOWED_RISK)}")

    pid = str(uuid.uuid4())
    owner_id = body.owner_id or user.id
    db.execute(
        text(
            "INSERT INTO projects ("
            " id, company_id, department_id, created_by, owner_id, approver_id, "
            " title, description, status, risk_level, visibility, is_strategic, "
            " progress, start_date, due_date, tags"
            ") VALUES ("
            " :id, :co, :dep, :cb, :own, :app, :title, :desc, :st, :risk, "
            " :vis, :strat, :prog, :sd, :dd, :tags"
            ")"
        ),
        {
            "id": pid, "co": body.company_id, "dep": body.department_id,
            "cb": user.id, "own": owner_id, "app": body.approver_id,
            "title": body.title, "desc": body.description,
            "st": body.status, "risk": body.risk_level, "vis": body.visibility,
            "strat": body.is_strategic, "prog": body.progress,
            "sd": body.start_date or None, "dd": body.due_date or None,
            "tags": body.tags or None,
        },
    )

    # Always add the owner + the creator as members so the project shows up in
    # their bootstrap. Dedupe via ON CONFLICT (the (project_id,user_id) unique).
    members = {owner_id, user.id, *body.member_ids}
    for uid in members:
        db.execute(
            text(
                "INSERT INTO project_members (project_id, user_id, member_role) "
                "VALUES (:p, :u, :r) ON CONFLICT DO NOTHING"
            ),
            {"p": pid, "u": uid, "r": "owner" if uid == owner_id else "member"},
        )
    db.commit()
    return _get(db, pid)


# ---------- Update ----------

class ProjectUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    department_id: Optional[str] = None
    owner_id: Optional[str] = None
    approver_id: Optional[str] = None
    status: Optional[str] = None
    risk_level: Optional[str] = None
    visibility: Optional[str] = None
    is_strategic: Optional[bool] = None
    progress: Optional[int] = Field(None, ge=0, le=100)
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    tags: Optional[list[str]] = None


@router.patch("/{project_id}")
def update_project(
    project_id: str,
    body: ProjectUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get(db, project_id)
    if not can_manage_project(project, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this project")
    if body.status is not None and body.status not in ALLOWED_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_STATUS)}")
    if body.risk_level is not None and body.risk_level not in ALLOWED_RISK:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"risk_level must be one of {sorted(ALLOWED_RISK)}")

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return project

    set_parts = []
    params: dict = {"id": project_id}
    for col, val in fields.items():
        set_parts.append(f"{col} = :{col}")
        params[col] = val
    set_parts.append("updated_at = now()")
    sql = f"UPDATE projects SET {', '.join(set_parts)} WHERE id = :id"
    db.execute(text(sql), params)
    db.commit()
    return _get(db, project_id)


# ---------- Delete ----------

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get(db, project_id)
    if not can_manage_project(project, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to delete this project")
    # project_members cascades; tasks.project_id is ON DELETE SET NULL so tasks
    # survive but become unattached.
    db.execute(text("DELETE FROM projects WHERE id = :id"), {"id": project_id})
    db.commit()
    return None


# ---------- Members ----------

class MemberAdd(BaseModel):
    user_id: str
    member_role: str = "member"


@router.post("/{project_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(
    project_id: str,
    body: MemberAdd,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get(db, project_id)
    if not can_manage_project(project, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to manage members")
    db.execute(
        text(
            "INSERT INTO project_members (project_id, user_id, member_role) "
            "VALUES (:p, :u, :r) ON CONFLICT DO NOTHING"
        ),
        {"p": project_id, "u": body.user_id, "r": body.member_role},
    )
    db.commit()
    return {"project_id": project_id, "user_id": body.user_id, "member_role": body.member_role}


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    project_id: str,
    user_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get(db, project_id)
    if user_id == project.get("owner_id"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reassign owner before removing them")
    # Self-removal allowed; otherwise need manage rights.
    if user_id != user.id and not can_manage_project(project, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to remove this member")
    db.execute(
        text("DELETE FROM project_members WHERE project_id = :p AND user_id = :u"),
        {"p": project_id, "u": user_id},
    )
    db.commit()
    return None
