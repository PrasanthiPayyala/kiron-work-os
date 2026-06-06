"""WebSocket hub for realtime delivery of chat messages, notifications, and
approval state changes.

One socket per browser tab. The client authenticates by passing its access
token as a query parameter (?token=...) — same JWT used for REST. Subsequent
events flow server → client only; clients keep sending via REST (POST /messages
etc.), and the REST handlers call ``broadcast.message_new()`` etc. to push.

Topology
--------
- The hub holds an in-memory dict of {user_id → set[WebSocket]}.
- ``send_to_user(uid, payload)`` fans out to every socket that user has open.
- ``send_to_conversation(conv_id, payload)`` looks up the conversation's
  members in Postgres and pushes to each connected one.

This is single-process. For multi-worker (uvicorn --workers > 1) we'd need
Redis pub/sub; with the systemd unit at workers=2 the broadcast covers only
one worker. Set workers=1 in /etc/systemd/system/kiron-api.service if you
need cross-worker fan-out, or migrate the hub onto Redis later.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import text

from ..db import engine
from ..security import decode_token

router = APIRouter(tags=["realtime"])


class Hub:
    def __init__(self) -> None:
        self._by_user: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._by_user[user_id].add(ws)

    async def disconnect(self, user_id: str, ws: WebSocket) -> None:
        async with self._lock:
            sockets = self._by_user.get(user_id)
            if sockets:
                sockets.discard(ws)
                if not sockets:
                    self._by_user.pop(user_id, None)

    def _sockets_for(self, user_ids: list[str]) -> list[WebSocket]:
        out: list[WebSocket] = []
        for uid in user_ids:
            out.extend(self._by_user.get(uid, ()))
        return out

    async def send_to_users(self, user_ids: list[str], payload: dict[str, Any]) -> None:
        data = json.dumps(payload, default=str)
        dead: list[tuple[str, WebSocket]] = []
        for uid in user_ids:
            for ws in list(self._by_user.get(uid, ())):
                try:
                    await ws.send_text(data)
                except Exception:  # noqa: BLE001
                    dead.append((uid, ws))
        for uid, ws in dead:
            await self.disconnect(uid, ws)


hub = Hub()


# ---------- public helpers used by REST routers ----------

async def message_new(message_row: dict, conversation_id: str) -> None:
    """Broadcast to every member of the conversation."""
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT user_id FROM conversation_members WHERE conversation_id = :c"),
            {"c": conversation_id},
        ).all()
    user_ids = [str(r[0]) for r in rows]
    await hub.send_to_users(user_ids, {"type": "message.new", "data": message_row})


async def notification_new(notification_row: dict) -> None:
    await hub.send_to_users(
        [str(notification_row["user_id"])],
        {"type": "notification.new", "data": notification_row},
    )


async def approval_changed(approval_row: dict) -> None:
    """Send to requester + approver so both their UIs refresh."""
    targets = [str(approval_row["requested_by"]), str(approval_row["approver_id"])]
    await hub.send_to_users(targets, {"type": "approval.changed", "data": approval_row})


# The fire_* helpers below were a previous attempt to schedule broadcasts
# from sync FastAPI endpoints via asyncio.create_task. That raises
# RuntimeError when called from FastAPI's threadpool ("no running event
# loop"), and the bare except swallowed it so broadcasts silently never
# fired. The right pattern is FastAPI's BackgroundTasks dependency — it
# runs the coroutine on the main event loop after the response is sent.
# Endpoints should now call e.g.
#     background.add_task(ws_router.message_new, payload, conversation_id)
# rather than the old fire_*().


# ---------- the socket endpoint ----------

@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(...)):
    uid = decode_token(token, "access")
    if not uid:
        # 4401 is a custom close code for "unauthorized"; clients should not retry.
        await websocket.close(code=4401)
        return
    await websocket.accept()
    await hub.connect(uid, websocket)
    try:
        # Send a hello so clients know they're attached. After this the channel
        # is one-way (server → client); clients keep using REST for writes.
        await websocket.send_text(json.dumps({"type": "hello", "user_id": uid}))
        while True:
            # We don't expect inbound traffic. Recv to detect disconnects + keepalive.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(uid, websocket)
