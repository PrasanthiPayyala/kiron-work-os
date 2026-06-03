from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import (
    approvals,
    attendance,
    auth,
    bootstrap,
    chat,
    conversations,
    files,
    leave,
    notifications,
    tasks,
    ws,
)

app = FastAPI(title="Kiron API", version="0.1.0")

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
app.include_router(ws.router)


@app.get("/health")
def health():
    return {"status": "ok"}
