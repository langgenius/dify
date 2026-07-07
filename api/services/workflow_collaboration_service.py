from __future__ import annotations

import logging
import os
import socket
import time
import uuid
from collections.abc import Mapping
from typing import Any, override

from sqlalchemy import select

from core.db.session_factory import session_factory
from models.account import Account
from models.model import App
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository, WorkflowSessionInfo

logger = logging.getLogger(__name__)

SERVER_HEARTBEAT_INTERVAL_SECONDS = 30
_PROCESS_SERVER_ID: str | None = None
_PROCESS_SERVER_ID_PID: int | None = None


def _get_process_server_id() -> str:
    global _PROCESS_SERVER_ID, _PROCESS_SERVER_ID_PID  # pylint: disable=global-statement

    pid = os.getpid()
    if _PROCESS_SERVER_ID is None or pid != _PROCESS_SERVER_ID_PID:
        _PROCESS_SERVER_ID_PID = pid
        _PROCESS_SERVER_ID = f"{socket.gethostname()}:{pid}:{uuid.uuid4().hex}"
    return _PROCESS_SERVER_ID


class WorkflowCollaborationService:
    """
    Coordinate workflow collaboration state across Socket.IO workers.

    Socket.IO rooms are process-local unless backed by a message queue, while online users and leader election live in
    Redis. Each websocket worker writes a small heartbeat keyed by `server_id`; session rows store their owner so a
    worker can distinguish a live remote sid from a stale sid left behind by a dead worker.
    """

    _heartbeat_started: bool
    _repository: WorkflowCollaborationRepository
    _server_id_override: str | None
    _socketio: Any

    def __init__(
        self, repository: WorkflowCollaborationRepository, socketio: Any, server_id: str | None = None
    ) -> None:
        self._repository = repository
        self._socketio = socketio
        self._server_id_override = server_id
        self._heartbeat_started = False

    @override
    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(repository={self._repository})"

    @property
    def server_id(self) -> str:
        return self._server_id_override or _get_process_server_id()

    def _refresh_server_heartbeat(self) -> None:
        self._repository.refresh_server_heartbeat(self.server_id)

    def _server_heartbeat_loop(self) -> None:
        while True:
            try:
                self._refresh_server_heartbeat()
                self._repository.refresh_server_sessions(self.server_id)
            except Exception:
                logger.exception("Failed to refresh workflow collaboration server heartbeat")
            self._socketio.sleep(SERVER_HEARTBEAT_INTERVAL_SECONDS)

    def _ensure_server_heartbeat_started(self) -> None:
        if self._heartbeat_started:
            return

        self._heartbeat_started = True
        self._refresh_server_heartbeat()
        self._socketio.start_background_task(self._server_heartbeat_loop)

    def save_socket_identity(self, sid: str, user: Account) -> None:
        """Persist the authenticated console user on the raw socket session."""
        self._socketio.save_session(
            sid,
            {
                "user_id": user.id,
                "username": user.name,
                "avatar": user.avatar,
                "tenant_id": user.current_tenant_id,
            },
        )

    def authorize_and_join_workflow_room(self, workflow_id: str, sid: str) -> tuple[str, bool] | None:
        """
        Join a collaboration room only after validating the socket session and tenant-scoped app access.

        The Socket.IO payload still calls the room key `workflow_id`, but the identifier is the workflow app's
        `App.id`. Returning `None` lets the controller reject the join before any Redis or room state is created.
        """
        session = self._socketio.get_session(sid)
        user_id = session.get("user_id")
        tenant_id = session.get("tenant_id")
        if not user_id or not tenant_id:
            return None

        if not self._can_access_workflow(workflow_id, str(tenant_id)):
            logger.warning(
                "Workflow collaboration join rejected: workflow_id=%s tenant_id=%s user_id=%s sid=%s",
                workflow_id,
                tenant_id,
                user_id,
                sid,
            )
            return None

        self._ensure_server_heartbeat_started()

        session_info: WorkflowSessionInfo = {
            "user_id": str(user_id),
            "username": str(session.get("username", "Unknown")),
            "avatar": session.get("avatar"),
            "sid": sid,
            "connected_at": int(time.time()),
            "server_id": self.server_id,
        }

        self._repository.set_session_info(workflow_id, session_info)

        leader_sid = self.get_or_set_leader(workflow_id, sid)
        is_leader = leader_sid == sid

        self._socketio.enter_room(sid, workflow_id)
        self.broadcast_online_users(workflow_id)

        self._socketio.emit("status", {"isLeader": is_leader}, room=sid)

        return str(user_id), is_leader

    def _can_access_workflow(self, workflow_id: str, tenant_id: str) -> bool:
        """Check room access without relying on Flask's app-context-bound scoped session."""
        with session_factory.create_session() as session:
            app_id = session.scalar(select(App.id).where(App.id == workflow_id, App.tenant_id == tenant_id).limit(1))
        return app_id is not None

    def disconnect_session(self, sid: str) -> None:
        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return

        workflow_id = mapping["workflow_id"]
        self._repository.delete_session(workflow_id, sid)

        self.handle_leader_disconnect(workflow_id, sid)
        self.broadcast_online_users(workflow_id)

    def relay_collaboration_event(self, sid: str, data: Mapping[str, object]) -> tuple[dict[str, str], int]:
        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return {"msg": "unauthorized"}, 401

        workflow_id = mapping["workflow_id"]
        user_id = mapping["user_id"]
        self.refresh_session_state(workflow_id, sid)

        event_type = data.get("type")
        event_data = data.get("data")
        timestamp = data.get("timestamp", int(time.time()))

        if not event_type:
            return {"msg": "invalid event type"}, 400

        if event_type == "sync_request":
            leader_sid = self._repository.get_current_leader(workflow_id)
            target_sid: str | None
            if leader_sid and self.is_session_active(workflow_id, leader_sid):
                target_sid = leader_sid
            else:
                if leader_sid:
                    self._repository.delete_leader(workflow_id)
                target_sid = self._select_graph_leader(workflow_id, preferred_sid=sid)
                if target_sid:
                    self._repository.set_leader(workflow_id, target_sid)
                    self.broadcast_leader_change(workflow_id, target_sid)

            if not target_sid:
                return {"msg": "no_active_leader"}, 200

            self._socketio.emit(
                "collaboration_update",
                {"type": event_type, "userId": user_id, "data": event_data, "timestamp": timestamp},
                room=target_sid,
            )

            return {"msg": "sync_request_forwarded"}, 200

        self._socketio.emit(
            "collaboration_update",
            {"type": event_type, "userId": user_id, "data": event_data, "timestamp": timestamp},
            room=workflow_id,
            skip_sid=sid,
        )

        return {"msg": "event_broadcasted"}, 200

    def relay_graph_event(self, sid: str, data: object) -> tuple[dict[str, str], int]:
        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return {"msg": "unauthorized"}, 401

        workflow_id = mapping["workflow_id"]
        self.refresh_session_state(workflow_id, sid)

        self._socketio.emit("graph_update", data, room=workflow_id, skip_sid=sid)

        return {"msg": "graph_update_broadcasted"}, 200

    def get_or_set_leader(self, workflow_id: str, sid: str) -> str:
        current_leader = self._repository.get_current_leader(workflow_id)

        if current_leader:
            if self.is_session_active(workflow_id, current_leader):
                return current_leader
            self._repository.delete_session(workflow_id, current_leader)
            self._repository.delete_leader(workflow_id)

        was_set = self._repository.set_leader_if_absent(workflow_id, sid)

        if was_set:
            if current_leader:
                self.broadcast_leader_change(workflow_id, sid)
            return sid

        current_leader = self._repository.get_current_leader(workflow_id)
        if current_leader:
            return current_leader

        return sid

    def handle_leader_disconnect(self, workflow_id: str, disconnected_sid: str) -> None:
        current_leader = self._repository.get_current_leader(workflow_id)
        if not current_leader:
            return

        if current_leader != disconnected_sid:
            return

        new_leader_sid = self._select_graph_leader(workflow_id)
        if new_leader_sid:
            self._repository.set_leader(workflow_id, new_leader_sid)
            self.broadcast_leader_change(workflow_id, new_leader_sid)
        else:
            self._repository.delete_leader(workflow_id)

    def broadcast_leader_change(self, workflow_id: str, new_leader_sid: str | None) -> None:
        for sid in self._repository.get_session_sids(workflow_id):
            try:
                is_leader = new_leader_sid is not None and sid == new_leader_sid
                self._socketio.emit("status", {"isLeader": is_leader}, room=sid)
            except Exception:
                logging.exception("Failed to emit leader status to session %s", sid)

    def get_current_leader(self, workflow_id: str) -> str | None:
        return self._repository.get_current_leader(workflow_id)

    def _prune_inactive_sessions(self, workflow_id: str) -> list[WorkflowSessionInfo]:
        """Remove inactive sessions from storage and return active sessions only."""
        sessions = self._repository.list_sessions(workflow_id)
        if not sessions:
            return []

        active_sessions: list[WorkflowSessionInfo] = []
        stale_sids: list[str] = []
        for session in sessions:
            sid = session["sid"]
            if self.is_session_active(workflow_id, sid):
                active_sessions.append(session)
            else:
                stale_sids.append(sid)

        for sid in stale_sids:
            self._repository.delete_session(workflow_id, sid)

        return active_sessions

    def broadcast_online_users(self, workflow_id: str) -> None:
        users = self._prune_inactive_sessions(workflow_id)
        users.sort(key=lambda x: x.get("connected_at") or 0)

        leader_sid = self.get_current_leader(workflow_id)
        previous_leader = leader_sid
        active_sids = {user["sid"] for user in users}
        if leader_sid and leader_sid not in active_sids:
            self._repository.delete_leader(workflow_id)
            leader_sid = None

        if not leader_sid and users:
            leader_sid = self._select_graph_leader(workflow_id)
            if leader_sid:
                self._repository.set_leader(workflow_id, leader_sid)

        if leader_sid != previous_leader:
            self.broadcast_leader_change(workflow_id, leader_sid)

        self._socketio.emit(
            "online_users",
            {"workflow_id": workflow_id, "users": users, "leader": leader_sid},
            room=workflow_id,
        )

    def refresh_session_state(self, workflow_id: str, sid: str) -> None:
        self._refresh_server_heartbeat()
        self._repository.refresh_session_state(workflow_id, sid)
        self._ensure_leader(workflow_id, sid)

    def _ensure_leader(self, workflow_id: str, sid: str) -> None:
        current_leader = self._repository.get_current_leader(workflow_id)
        if current_leader and self.is_session_active(workflow_id, current_leader):
            self._repository.expire_leader(workflow_id)
            return

        if current_leader:
            self._repository.delete_leader(workflow_id)

        self._repository.set_leader(workflow_id, sid)
        self.broadcast_leader_change(workflow_id, sid)

    def _select_graph_leader(self, workflow_id: str, preferred_sid: str | None = None) -> str | None:
        session_sids = [
            session["sid"]
            for session in self._repository.list_sessions(workflow_id)
            if session.get("graph_active", True) and self.is_session_active(workflow_id, session["sid"])
        ]
        if not session_sids:
            return None
        if preferred_sid and preferred_sid in session_sids:
            return preferred_sid
        return session_sids[0]

    def is_session_active(self, workflow_id: str, sid: str) -> bool:
        if not sid:
            return False

        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return False

        if not self._repository.session_exists(workflow_id, sid):
            return False

        server_id = mapping.get("server_id")
        if not server_id:
            return self._is_socket_connected_locally(sid)

        if server_id == self.server_id:
            return self._is_socket_connected_locally(sid)

        return self._repository.server_heartbeat_exists(server_id)

    def _is_socket_connected_locally(self, sid: str) -> bool:
        try:
            return bool(self._socketio.manager.is_connected(sid, "/"))
        except AttributeError:
            return False
