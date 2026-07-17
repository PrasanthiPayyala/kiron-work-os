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
ALLOWED_KIND = {"internal", "client", "rnd", "hackathon", "other"}
ALLOWED_PROGRESS_MODE = {"manual", "auto"}
ALLOWED_MILESTONE_STATUS = {"planned", "in_progress", "done", "skipped"}

# Tasks treated as "done" for the purpose of auto-progress. Mirrors the
# closed-task statuses used elsewhere (only 'done' counts for now — the
# scheduler's OPEN_STATUSES list is the inverse, but we don't pull from
# there to keep the modules independent).
DONE_TASK_STATUSES = ("done",)


def _get(db: Session, project_id: str) -> dict:
    found = db.execute(
        text("SELECT * FROM projects WHERE id = :id"), {"id": project_id},
    ).mappings().first()
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return row(found)


def _create_project_chat(
    db: Session,
    project_id: str,
    title: str,
    member_ids: list[str],
    owner_id: str,
) -> str | None:
    """Spin up a project_group conversation for a new project. Mirrors
    _create_team_chat in the teams router — same shape, same members,
    same owner seed. Returns the new conversation id (or None if there
    are no members yet — nothing to chat about).

    Kept out of a shared helper module because the two callers
    (`teams` and `projects`) each pass their own owner-derivation
    logic, and the SQL is short enough that DRY-ing costs more clarity
    than it saves.
    """
    if not member_ids:
        return None
    import uuid as _uuid
    conv_id = str(_uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO conversations "
            "  (id, channel_type, title, created_by, project_id) "
            "VALUES (:id, 'project_group', :title, :uid, :pid)"
        ),
        {"id": conv_id, "title": title, "uid": owner_id, "pid": project_id},
    )
    for uid in member_ids:
        member_role = "owner" if uid == owner_id else "member"
        db.execute(
            text(
                "INSERT INTO conversation_members "
                "  (conversation_id, user_id, member_role, last_read_at) "
                "VALUES (:c, :u, :r, now()) "
                "ON CONFLICT DO NOTHING"
            ),
            {"c": conv_id, "u": uid, "r": member_role},
        )
    return conv_id


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
    kind: str = "internal"
    tech_stack: list[str] = Field(default_factory=list)
    team_id: Optional[str] = None
    progress_mode: str = "manual"


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
    if body.kind not in ALLOWED_KIND:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"kind must be one of {sorted(ALLOWED_KIND)}")
    if body.progress_mode not in ALLOWED_PROGRESS_MODE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"progress_mode must be one of {sorted(ALLOWED_PROGRESS_MODE)}")

    pid = str(uuid.uuid4())
    owner_id = body.owner_id or user.id
    db.execute(
        text(
            "INSERT INTO projects ("
            " id, company_id, department_id, created_by, owner_id, approver_id, "
            " title, description, status, risk_level, visibility, is_strategic, "
            " progress, start_date, due_date, tags, "
            " kind, tech_stack, team_id, progress_mode"
            ") VALUES ("
            " :id, :co, :dep, :cb, :own, :app, :title, :desc, :st, :risk, "
            " :vis, :strat, :prog, :sd, :dd, :tags, "
            " :kind, :stack, :team, :pmode"
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
            "kind": body.kind, "stack": body.tech_stack or None,
            "team": body.team_id, "pmode": body.progress_mode,
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

    # Auto-create the project group chat so the team can start
    # discussing immediately. The chat lives in two places for the
    # user: the ProjectDetail → Discussion tab (focused view) and the
    # main /chat page under Project groups (quick access).
    conv_id = _create_project_chat(db, pid, body.title.strip(), list(members), owner_id)
    if conv_id:
        db.execute(
            text("UPDATE projects SET conversation_id = :c WHERE id = :id"),
            {"c": conv_id, "id": pid},
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
    kind: Optional[str] = None
    tech_stack: Optional[list[str]] = None
    team_id: Optional[str] = None
    progress_mode: Optional[str] = None


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
    if body.kind is not None and body.kind not in ALLOWED_KIND:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"kind must be one of {sorted(ALLOWED_KIND)}")
    if body.progress_mode is not None and body.progress_mode not in ALLOWED_PROGRESS_MODE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"progress_mode must be one of {sorted(ALLOWED_PROGRESS_MODE)}")

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
    # Explicitly kill the project's chat first — the FK on projects
    # (conversation_id → conversations ON DELETE SET NULL) doesn't
    # cascade the other direction, so without this the conversation
    # would linger with no way to reach it from the UI.
    conv_id = project.get("conversation_id")
    if conv_id:
        # messages + conversation_members cascade from conversations
        # (see 0001_baseline + 0002_chat_realtime).
        db.execute(text("DELETE FROM conversations WHERE id = :c"), {"c": conv_id})
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
    # Mirror into the project's chat so the new member sees the channel
    # + history immediately. No-op if the project predates this feature
    # (conversation_id is null) — backfill in migration 0038 handles that.
    if project.get("conversation_id"):
        db.execute(
            text(
                "INSERT INTO conversation_members "
                "  (conversation_id, user_id, member_role, last_read_at) "
                "VALUES (:c, :u, 'member', now()) "
                "ON CONFLICT DO NOTHING"
            ),
            {"c": project["conversation_id"], "u": body.user_id},
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
    # Mirror the removal into the project chat so the user can't keep
    # reading conversations for a project they were removed from.
    if project.get("conversation_id"):
        db.execute(
            text(
                "DELETE FROM conversation_members "
                "WHERE conversation_id = :c AND user_id = :u"
            ),
            {"c": project["conversation_id"], "u": user_id},
        )
    db.commit()
    return None


# ---------- Milestones ----------
#
# A milestone is a named phase within a project (e.g. "Kickoff",
# "Auth done", "Beta launch"). Each carries its own due_date + status.
# UI surfaces them as a timeline in the project detail page.
#
# Authz mirrors the project: anyone who can manage the project can
# create / edit / delete its milestones. Visibility follows project
# visibility — if you can see the project, you can read its milestones.


class MilestoneCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    due_date: Optional[str] = None
    status: str = "planned"
    position: int = 0


class MilestoneUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    position: Optional[int] = None


@router.get("/{project_id}/milestones")
def list_milestones(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get(db, project_id)  # 404 if absent
    rows = db.execute(
        text(
            "SELECT * FROM project_milestones WHERE project_id = :p "
            "ORDER BY position ASC, due_date ASC NULLS LAST, created_at ASC"
        ),
        {"p": project_id},
    ).mappings().all()
    return [row(r) for r in rows]


@router.post("/{project_id}/milestones", status_code=status.HTTP_201_CREATED)
def create_milestone(
    project_id: str,
    body: MilestoneCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get(db, project_id)
    if not can_manage_project(project, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this project")
    if body.status not in ALLOWED_MILESTONE_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_MILESTONE_STATUS)}")

    mid = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO project_milestones "
            "  (id, project_id, title, description, due_date, status, position, created_by, "
            "   completed_at) "
            "VALUES (:id, :p, :t, :d, :dd, :s, :pos, :cb, "
            "        CASE WHEN :s = 'done' THEN now() ELSE NULL END)"
        ),
        {
            "id": mid, "p": project_id, "t": body.title.strip(),
            "d": body.description, "dd": body.due_date or None,
            "s": body.status, "pos": body.position, "cb": user.id,
        },
    )
    db.commit()
    r = db.execute(text("SELECT * FROM project_milestones WHERE id = :id"), {"id": mid}).mappings().first()
    return row(r)


@router.patch("/milestones/{milestone_id}")
def update_milestone(
    milestone_id: str,
    patch: MilestoneUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.execute(
        text("SELECT * FROM project_milestones WHERE id = :id"), {"id": milestone_id},
    ).mappings().first()
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Milestone not found")
    project = _get(db, str(m["project_id"]))
    if not can_manage_project(project, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this project")

    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return row(m)
    if "status" in fields and fields["status"] not in ALLOWED_MILESTONE_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ALLOWED_MILESTONE_STATUS)}")

    # Stamp completed_at when status flips to/from done.
    set_parts: list[str] = []
    params: dict = {"id": milestone_id}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        params[k] = v
    if "status" in fields:
        if fields["status"] == "done":
            set_parts.append("completed_at = now()")
        else:
            set_parts.append("completed_at = NULL")
    db.execute(text(f"UPDATE project_milestones SET {', '.join(set_parts)} WHERE id = :id"), params)
    db.commit()
    r = db.execute(text("SELECT * FROM project_milestones WHERE id = :id"), {"id": milestone_id}).mappings().first()
    return row(r)


@router.delete("/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_milestone(
    milestone_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.execute(
        text("SELECT project_id FROM project_milestones WHERE id = :id"), {"id": milestone_id},
    ).mappings().first()
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Milestone not found")
    project = _get(db, str(m["project_id"]))
    if not can_manage_project(project, user.id, user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to edit this project")
    db.execute(text("DELETE FROM project_milestones WHERE id = :id"), {"id": milestone_id})
    db.commit()
    return None


# ---------- Auto-progress recompute ----------
#
# When a project is in progress_mode = 'auto', its progress % equals
# (done tasks / total tasks) rounded. Called explicitly via this
# endpoint so the caller can refresh a single project after a task
# status flip without us having to scan every task on every change.


@router.post("/{project_id}/recompute-progress")
def recompute_progress(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get(db, project_id)
    if project.get("progress_mode") != "auto":
        # No-op for manual projects — return the current value so the
        # caller can render it without branching.
        return project

    counts = db.execute(
        text(
            "SELECT count(*) FILTER (WHERE status::text = ANY(:done)) AS done, "
            "       count(*) AS total "
            "FROM tasks WHERE project_id = :p"
        ),
        {"done": list(DONE_TASK_STATUSES), "p": project_id},
    ).mappings().first()
    total = counts["total"] or 0
    done = counts["done"] or 0
    pct = 0 if total == 0 else round((done / total) * 100)
    db.execute(
        text("UPDATE projects SET progress = :pct, updated_at = now() WHERE id = :id"),
        {"pct": pct, "id": project_id},
    )
    db.commit()
    return _get(db, project_id)
