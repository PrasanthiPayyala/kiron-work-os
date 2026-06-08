import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Surface our own loggers (scheduler, email, auth, …) at INFO via uvicorn's
# root handlers. Without this, kiron.scheduler's run summaries stay hidden.
logging.getLogger("kiron").setLevel(logging.INFO)

from .config import settings
from .routers import (
    approvals,
    attendance,
    auth,
    bootstrap,
    chat,
    companies,
    conversations,
    files,
    leave,
    notifications,
    projects,
    tasks,
    users,
    ws,
)
from .scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(_: FastAPI):
    # SLA breach scheduler — runs the check every N min, idempotent + multi-
    # worker safe via Postgres advisory lock. See app/scheduler.py.
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(title="Kiron API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(bootstrap.router)
app.include_router(tasks.router)
app.include_router(attendance.router)
app.include_router(leave.router)
app.include_router(approvals.router)
app.include_router(chat.router)
app.include_router(conversations.router)
app.include_router(files.router)
app.include_router(notifications.router)
app.include_router(projects.router)
app.include_router(companies.router)
app.include_router(users.router)
app.include_router(ws.router)


@app.get("/health")
def health():
    return {"status": "ok"}
