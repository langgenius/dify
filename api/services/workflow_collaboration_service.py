from __future__ import annotations

import logging
import os
import socket
import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, override

from models.account import Account
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository, WorkflowSessionInfo
from services.account_avatar_service import AccountAvatarService
from services.workflow_loro_document import LoroDraftSyncResult

logger = logging.getLogger(__name__)

SERVER_HEARTBEAT_INTERVAL_SECONDS = 30
_PROCESS_SERVER_ID: str | None = None
_PROCESS_SERVER_ID_PID: int | None = None


class WorkflowCollaborationForbiddenError(Exception):
    """The authenticated account cannot edit this workflow."""


class WorkflowCollaborationNotEntitledError(Exception):
    """The workspace cannot use workflow collaboration."""


@dataclass(frozen=True, slots=True)
class WorkflowDraftEditor:
    """An admitted editor and the owner scope derived from the joined socket."""

    app_id: str
    tenant_id: str
    account_id: str


class SyncWorkflowDraft(Protocol):
    def __call__(
        self,
        editor: WorkflowDraftEditor,
        /,
        *,
        epoch: str,
        version: bytes | None,
        update: bytes | None,
        allow_empty: bool,
    ) -> LoroDraftSyncResult:
        """Confirm an admitted editor's update from a fresh draft transaction."""
        ...


def _get_process_server_id() -> str:
    global _PROCESS_SERVER_ID, _PROCESS_SERVER_ID_PID  # pylint: disable=global-statement

    pid = os.getpid()
    if _PROCESS_SERVER_ID is None or pid != _PROCESS_SERVER_ID_PID:
        _PROCESS_SERVER_ID_PID = pid
        _PROCESS_SERVER_ID = f"{socket.gethostname()}:{pid}:{uuid.uuid4().hex}"
    return _PROCESS_SERVER_ID


class WorkflowCollaborationService:
    """Track socket membership in Redis and recheck workflow editing access on every draft RPC."""

    _heartbeat_started: bool
    _repository: WorkflowCollaborationRepository
    _server_id_override: str | None
    _socketio: Any

    def __init__(
        self,
        repository: WorkflowCollaborationRepository,
        socketio: Any,
        *,
        check_edit_access: Callable[[WorkflowDraftEditor], None],
        sync_draft: SyncWorkflowDraft,
        server_id: str | None = None,
    ) -> None:
        self._repository = repository
        self._socketio = socketio
        self._server_id_override = server_id
        self._heartbeat_started = False
        self._check_edit_access = check_edit_access
        self._sync_draft = sync_draft

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

    def _socket_identity(self, sid: str) -> Mapping[str, Any]:
        """Read the server-owned identity, allowing a disconnected socket to be absent."""
        try:
            return self._socketio.get_session(sid)
        except KeyError:
            return {}

    def authorize_and_join_workflow_room(self, workflow_id: str, sid: str) -> str | None:
        """Check a live identity before joining its authorized workflow room."""
        socket_session = self._socket_identity(sid)
        user_id = socket_session.get("user_id")
        tenant_id = socket_session.get("tenant_id")
        if not user_id or not tenant_id:
            return None
        self._check_edit_access(WorkflowDraftEditor(workflow_id, tenant_id, user_id))
        previous = self._repository.get_sid_mapping(sid)
        if previous and previous["workflow_id"] != workflow_id:
            self._socketio.leave_room(sid, previous["workflow_id"])
            self.disconnect_session(sid)
        self._ensure_server_heartbeat_started()
        session_info: WorkflowSessionInfo = {
            "user_id": str(user_id),
            "username": str(socket_session.get("username", "Unknown")),
            "avatar": socket_session.get("avatar"),
            "sid": sid,
            "connected_at": int(time.time()),
            "server_id": self.server_id,
        }
        self._repository.set_session_info(workflow_id, session_info)
        self._socketio.enter_room(sid, workflow_id)
        self.broadcast_online_users(workflow_id)
        return str(user_id)

    def authorize_loro_draft_sync(self, sid: str) -> WorkflowDraftEditor | None:
        """Resolve and reauthorize the room's editor before decoding draft data."""
        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return None
        identity = self._socket_identity(sid)
        user_id, tenant_id = identity.get("user_id"), identity.get("tenant_id")
        if not tenant_id or not user_id or user_id != mapping["user_id"]:
            return None
        editor = WorkflowDraftEditor(mapping["workflow_id"], tenant_id, user_id)
        self._check_edit_access(editor)
        return editor

    def sync_loro_draft(
        self,
        sid: str,
        editor: WorkflowDraftEditor,
        *,
        epoch: str,
        version: bytes | None,
        update: bytes | None,
        allow_empty: bool,
    ) -> LoroDraftSyncResult:
        """Refresh presence before opening the transaction for an admitted draft RPC."""
        self.refresh_session_state(editor.app_id, sid)
        return self._sync_draft(editor, epoch=epoch, version=version, update=update, allow_empty=allow_empty)

    def disconnect_session(self, sid: str) -> None:
        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return

        workflow_id = mapping["workflow_id"]
        self._repository.delete_session(workflow_id, sid)

        self.broadcast_online_users(workflow_id)

    def relay_collaboration_event(self, sid: str, data: Mapping[str, object]) -> tuple[dict[str, object], int]:
        """Broadcast admitted presence and workflow notifications to the other room members."""
        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return {"msg": "unauthorized"}, 401

        workflow_id = mapping["workflow_id"]
        user_id = mapping["user_id"]
        self.refresh_session_state(workflow_id, sid)

        event_type = data.get("type")
        event_data = data.get("data")
        timestamp = data.get("timestamp", int(time.time()))

        if event_type not in (
            "mouse_move",
            "node_panel_presence",
            "vars_and_features_update",
            "app_meta_update",
            "workflow_update",
            "comments_update",
            "app_publish_update",
            "workflow_restore_intent",
            "workflow_restore_complete",
            "workflow_history_action",
        ):
            return {"msg": "invalid event type"}, 400

        self._socketio.emit(
            "collaboration_update",
            {"type": event_type, "userId": user_id, "data": event_data, "timestamp": timestamp},
            room=workflow_id,
            skip_sid=sid,
        )

        return {"msg": "event_broadcasted"}, 200

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

        self._socketio.emit(
            "online_users",
            {"workflow_id": workflow_id, "users": users},
            room=workflow_id,
        )

    def get_online_user_avatars(self, sid: str, *, avatar_service: AccountAvatarService) -> dict[str, str]:
        """Resolve current profiles for active room sessions; an unjoined socket receives no URLs.

        The room and account IDs come from server-managed sessions; profile avatars are read in one batch.
        Missing or unowned uploads are omitted so clients can show initials. Redis avatar snapshots are ignored.
        """
        mapping = self._repository.get_sid_mapping(sid)
        if not mapping:
            return {}
        workflow_id = mapping["workflow_id"]
        if not self.is_session_active(workflow_id, sid):
            return {}

        active_users = [
            user
            for user in self._repository.list_sessions(workflow_id)
            if self.is_session_active(workflow_id, user["sid"])
        ]
        urls_by_account = avatar_service.resolve_current_for_accounts(
            account_ids=tuple(dict.fromkeys(user["user_id"] for user in active_users))
        )
        return {user["sid"]: url for user in active_users if (url := urls_by_account.get(user["user_id"])) is not None}

    def refresh_session_state(self, workflow_id: str, sid: str) -> None:
        self._refresh_server_heartbeat()
        self._repository.refresh_session_state(workflow_id, sid)

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
