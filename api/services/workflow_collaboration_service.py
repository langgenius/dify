from __future__ import annotations

import logging
import time
from collections.abc import Mapping

from models.account import Account
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository, WorkflowSessionInfo


class WorkflowCollaborationService:
    def __init__(self, repository: WorkflowCollaborationRepository, socketio) -> None:
        self._repository = repository
        self._socketio = socketio

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(repository={self._repository})"

    def save_session(self, sid: str, user: Account) -> None:
        self._socketio.save_session(
            sid,
            {
                "user_id": user.id,
                "username": user.name,
                "avatar": user.avatar,
            },
        )

    def register_session(self, workflow_id: str, sid: str) -> tuple[str, bool] | None:
        session = self._socketio.get_session(sid)
        user_id = session.get("user_id")
        if not user_id:
            return None

        session_info: WorkflowSessionInfo = {
            "user_id": str(user_id),
            "username": str(session.get("username", "Unknown")),
            "avatar": session.get("avatar"),
            "sid": sid,
            "connected_at": int(time.time()),
        }

        self._repository.set_session_info(workflow_id, session_info)

        leader_sid = self.get_or_set_leader(workflow_id, sid)
        is_leader = leader_sid == sid

        self._socketio.enter_room(sid, workflow_id)
        self.broadcast_online_users(workflow_id)

        self._socketio.emit("status", {"isLeader": is_leader}, room=sid)

        return str(user_id), is_leader

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
        self._repository.refresh_session_state(workflow_id, sid)

        event_type = data.get("type")
        event_data = data.get("data")
        timestamp = data.get("timestamp", int(time.time()))

        if not event_type:
            return {"msg": "invalid event type"}, 400

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
        self._repository.refresh_session_state(workflow_id, sid)

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

        session_sids = self._repository.get_session_sids(workflow_id)
        if session_sids:
            new_leader_sid = session_sids[0]
            self._repository.set_leader(workflow_id, new_leader_sid)
            self.broadcast_leader_change(workflow_id, new_leader_sid)
        else:
            self._repository.delete_leader(workflow_id)

    def broadcast_leader_change(self, workflow_id: str, new_leader_sid: str) -> None:
        for sid in self._repository.get_session_sids(workflow_id):
            try:
                is_leader = sid == new_leader_sid
                self._socketio.emit("status", {"isLeader": is_leader}, room=sid)
            except Exception:
                logging.exception("Failed to emit leader status to session %s", sid)

    def get_current_leader(self, workflow_id: str) -> str | None:
        return self._repository.get_current_leader(workflow_id)

    def broadcast_online_users(self, workflow_id: str) -> None:
        users = self._repository.list_sessions(workflow_id)
        users.sort(key=lambda x: x.get("connected_at") or 0)

        leader_sid = self.get_current_leader(workflow_id)

        self._socketio.emit(
            "online_users",
            {"workflow_id": workflow_id, "users": users, "leader": leader_sid},
            room=workflow_id,
        )

    def refresh_session_state(self, workflow_id: str, sid: str) -> None:
        self._repository.refresh_session_state(workflow_id, sid)

    def is_session_active(self, workflow_id: str, sid: str) -> bool:
        if not sid:
            return False

        try:
            if not self._socketio.manager.is_connected(sid, "/"):
                return False
        except AttributeError:
            return False

        if not self._repository.session_exists(workflow_id, sid):
            return False

        if not self._repository.sid_mapping_exists(sid):
            return False

        return True
