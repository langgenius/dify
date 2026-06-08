from unittest.mock import Mock, patch

import pytest

from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from services.workflow_collaboration_service import WorkflowCollaborationService


class TestWorkflowCollaborationService:
    @pytest.fixture
    def service(self) -> tuple[WorkflowCollaborationService, Mock, Mock]:
        repository = Mock(spec=WorkflowCollaborationRepository)
        socketio = Mock()
        return WorkflowCollaborationService(repository, socketio), repository, socketio

    def test_authorize_and_join_workflow_room_returns_leader_status(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, socketio = service
        socketio.get_session.return_value = {
            "user_id": "u-1",
            "username": "Jane",
            "avatar": None,
            "tenant_id": "t-1",
        }

        with (
            patch.object(collaboration_service, "_can_access_workflow", return_value=True),
            patch.object(collaboration_service, "get_or_set_leader", return_value="sid-1"),
            patch.object(collaboration_service, "broadcast_online_users"),
        ):
            # Act
            result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1")

        # Assert
        assert result == ("u-1", True)
        repository.set_session_info.assert_called_once()
        socketio.enter_room.assert_called_once_with("sid-1", "wf-1")
        socketio.emit.assert_called_once_with("status", {"isLeader": True}, room="sid-1")

    def test_authorize_and_join_workflow_room_returns_none_when_missing_user(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, _repository, socketio = service
        socketio.get_session.return_value = {}

        # Act
        result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1")

        # Assert
        assert result is None

    def test_authorize_and_join_workflow_room_returns_none_when_missing_tenant(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, socketio = service
        socketio.get_session.return_value = {"user_id": "u-1", "username": "Jane", "avatar": None}

        result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1")

        assert result is None
        repository.set_session_info.assert_not_called()
        socketio.enter_room.assert_not_called()
        socketio.emit.assert_not_called()

    def test_authorize_and_join_workflow_room_returns_none_when_workflow_is_not_accessible(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, socketio = service
        socketio.get_session.return_value = {
            "user_id": "u-1",
            "username": "Jane",
            "avatar": None,
            "tenant_id": "t-1",
        }

        with patch.object(collaboration_service, "_can_access_workflow", return_value=False):
            result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1")

        assert result is None
        repository.set_session_info.assert_not_called()
        socketio.enter_room.assert_not_called()
        socketio.emit.assert_not_called()

    def test_repr_and_save_socket_identity(self, service: tuple[WorkflowCollaborationService, Mock, Mock]) -> None:
        collaboration_service, _repository, socketio = service
        user = Mock()
        user.id = "u-1"
        user.name = "Jane"
        user.avatar = "avatar.png"
        user.current_tenant_id = "t-1"

        assert "WorkflowCollaborationService" in repr(collaboration_service)

        collaboration_service.save_socket_identity("sid-1", user)

        socketio.save_session.assert_called_once_with(
            "sid-1",
            {"user_id": "u-1", "username": "Jane", "avatar": "avatar.png", "tenant_id": "t-1"},
        )

    def test_can_access_workflow_uses_session_factory(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, _repository, _socketio = service
        session = Mock()
        session.scalar.return_value = "wf-1"
        session_context = Mock()
        session_context.__enter__ = Mock(return_value=session)
        session_context.__exit__ = Mock(return_value=False)

        with patch(
            "services.workflow_collaboration_service.session_factory.create_session",
            return_value=session_context,
        ):
            result = collaboration_service._can_access_workflow("wf-1", "tenant-1")

        assert result is True
        session.scalar.assert_called_once()

    def test_relay_collaboration_event_unauthorized(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_sid_mapping.return_value = None

        # Act
        result = collaboration_service.relay_collaboration_event("sid-1", {})

        # Assert
        assert result == ({"msg": "unauthorized"}, 401)

    def test_relay_collaboration_event_emits_update(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, socketio = service
        repository.get_sid_mapping.return_value = {"workflow_id": "wf-1", "user_id": "u-1"}
        payload = {"type": "mouse_move", "data": {"x": 1}, "timestamp": 123}

        # Act
        result = collaboration_service.relay_collaboration_event("sid-1", payload)

        # Assert
        assert result == ({"msg": "event_broadcasted"}, 200)
        socketio.emit.assert_called_once_with(
            "collaboration_update",
            {"type": "mouse_move", "userId": "u-1", "data": {"x": 1}, "timestamp": 123},
            room="wf-1",
            skip_sid="sid-1",
        )

    def test_relay_collaboration_event_requires_event_type(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, _socketio = service
        repository.get_sid_mapping.return_value = {"workflow_id": "wf-1", "user_id": "u-1"}

        result = collaboration_service.relay_collaboration_event("sid-1", {"data": {"x": 1}})

        assert result == ({"msg": "invalid event type"}, 400)

    def test_relay_collaboration_event_sync_request_forwards_to_active_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, socketio = service
        repository.get_sid_mapping.return_value = {"workflow_id": "wf-1", "user_id": "u-1"}
        repository.get_current_leader.return_value = "sid-leader"
        payload = {"type": "sync_request", "data": {"reason": "join"}, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "sync_request_forwarded"}, 200)
        socketio.emit.assert_called_once_with(
            "collaboration_update",
            {"type": "sync_request", "userId": "u-1", "data": {"reason": "join"}, "timestamp": 123},
            room="sid-leader",
        )
        repository.set_leader.assert_not_called()

    def test_relay_collaboration_event_sync_request_reelects_active_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, socketio = service
        repository.get_sid_mapping.return_value = {"workflow_id": "wf-1", "user_id": "u-1"}
        repository.get_current_leader.return_value = "sid-old"
        repository.list_sessions.return_value = [
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-2",
                "connected_at": 1,
                "graph_active": True,
            },
            {
                "user_id": "u-3",
                "username": "C",
                "avatar": None,
                "sid": "sid-3",
                "connected_at": 2,
                "graph_active": True,
            },
        ]
        payload = {"type": "sync_request", "data": {"reason": "join"}, "timestamp": 123}

        def _is_session_active(_workflow_id: str, session_sid: str) -> bool:
            return session_sid != "sid-old"

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
            patch.object(collaboration_service, "is_session_active", side_effect=_is_session_active),
        ):
            result = collaboration_service.relay_collaboration_event("sid-2", payload)

        assert result == ({"msg": "sync_request_forwarded"}, 200)
        repository.delete_leader.assert_called_once_with("wf-1")
        repository.set_leader.assert_called_once_with("wf-1", "sid-2")
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")
        socketio.emit.assert_called_once_with(
            "collaboration_update",
            {"type": "sync_request", "userId": "u-1", "data": {"reason": "join"}, "timestamp": 123},
            room="sid-2",
        )

    def test_relay_collaboration_event_sync_request_returns_when_no_active_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, socketio = service
        repository.get_sid_mapping.return_value = {"workflow_id": "wf-1", "user_id": "u-1"}
        repository.get_current_leader.return_value = "sid-old"
        repository.list_sessions.return_value = []
        payload = {"type": "sync_request", "data": {"reason": "join"}, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=False),
        ):
            result = collaboration_service.relay_collaboration_event("sid-2", payload)

        assert result == ({"msg": "no_active_leader"}, 200)
        repository.delete_leader.assert_called_once_with("wf-1")
        socketio.emit.assert_not_called()

    def test_relay_graph_event_unauthorized(self, service: tuple[WorkflowCollaborationService, Mock, Mock]) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_sid_mapping.return_value = None

        # Act
        result = collaboration_service.relay_graph_event("sid-1", {"nodes": []})

        # Assert
        assert result == ({"msg": "unauthorized"}, 401)

    def test_disconnect_session_no_mapping(self, service: tuple[WorkflowCollaborationService, Mock, Mock]) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_sid_mapping.return_value = None

        # Act
        collaboration_service.disconnect_session("sid-1")

        # Assert
        repository.delete_session.assert_not_called()

    def test_disconnect_session_cleans_up(self, service: tuple[WorkflowCollaborationService, Mock, Mock]) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_sid_mapping.return_value = {"workflow_id": "wf-1", "user_id": "u-1"}

        with (
            patch.object(collaboration_service, "handle_leader_disconnect") as handle_leader_disconnect,
            patch.object(collaboration_service, "broadcast_online_users") as broadcast_online_users,
        ):
            # Act
            collaboration_service.disconnect_session("sid-1")

        # Assert
        repository.delete_session.assert_called_once_with("wf-1", "sid-1")
        handle_leader_disconnect.assert_called_once_with("wf-1", "sid-1")
        broadcast_online_users.assert_called_once_with("wf-1")

    def test_get_or_set_leader_returns_active_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = "sid-1"

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            # Act
            result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        # Assert
        assert result == "sid-1"
        repository.set_leader_if_absent.assert_not_called()

    def test_get_or_set_leader_replaces_dead_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = "sid-1"
        repository.set_leader_if_absent.return_value = True
        repository.list_sessions.return_value = [
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-2",
                "connected_at": 1,
                "graph_active": True,
            }
        ]

        with (
            patch.object(collaboration_service, "is_session_active", side_effect=lambda _wf, sid: sid != "sid-1"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            # Act
            result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        # Assert
        assert result == "sid-2"
        repository.delete_session.assert_called_once_with("wf-1", "sid-1")
        repository.delete_leader.assert_called_once_with("wf-1")
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")

    def test_get_or_set_leader_falls_back_to_existing(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.side_effect = [None, "sid-3"]
        repository.set_leader_if_absent.return_value = False
        repository.list_sessions.return_value = [
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-2",
                "connected_at": 1,
                "graph_active": True,
            }
        ]

        # Act
        result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        # Assert
        assert result == "sid-3"

    def test_get_or_set_leader_returns_sid_when_leader_still_missing(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.side_effect = [None, None]
        repository.set_leader_if_absent.return_value = False

        result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        assert result == "sid-2"

    def test_handle_leader_disconnect_elects_new(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = "sid-1"
        repository.list_sessions.return_value = [
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-2",
                "connected_at": 1,
                "graph_active": True,
            }
        ]

        with (
            patch.object(collaboration_service, "is_session_active", return_value=True),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            # Act
            collaboration_service.handle_leader_disconnect("wf-1", "sid-1")

        # Assert
        repository.set_leader.assert_called_once_with("wf-1", "sid-2")
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")

    def test_handle_leader_disconnect_clears_when_empty(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = "sid-1"
        repository.list_sessions.return_value = []

        # Act
        collaboration_service.handle_leader_disconnect("wf-1", "sid-1")

        # Assert
        repository.delete_leader.assert_called_once_with("wf-1")

    def test_handle_leader_disconnect_ignores_non_leader_or_missing_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, _socketio = service

        repository.get_current_leader.return_value = None
        collaboration_service.handle_leader_disconnect("wf-1", "sid-1")

        repository.get_current_leader.return_value = "sid-leader"
        collaboration_service.handle_leader_disconnect("wf-1", "sid-other")

        repository.set_leader.assert_not_called()
        repository.delete_leader.assert_not_called()

    def test_broadcast_leader_change_logs_emit_errors(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, socketio = service
        repository.get_session_sids.return_value = ["sid-1", "sid-2"]
        socketio.emit.side_effect = [RuntimeError("boom"), None]

        with patch("services.workflow_collaboration_service.logging.exception") as exception_mock:
            collaboration_service.broadcast_leader_change("wf-1", "sid-2")

        assert exception_mock.call_count == 1

    def test_broadcast_online_users_sorts_and_emits(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, socketio = service
        repository.list_sessions.return_value = [
            {"user_id": "u-1", "username": "A", "avatar": None, "sid": "sid-1", "connected_at": 3},
            {"user_id": "u-2", "username": "B", "avatar": None, "sid": "sid-2", "connected_at": 1},
        ]
        repository.get_current_leader.return_value = "sid-1"

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            # Act
            collaboration_service.broadcast_online_users("wf-1")

        # Assert
        socketio.emit.assert_called_once_with(
            "online_users",
            {
                "workflow_id": "wf-1",
                "users": [
                    {"user_id": "u-2", "username": "B", "avatar": None, "sid": "sid-2", "connected_at": 1},
                    {"user_id": "u-1", "username": "A", "avatar": None, "sid": "sid-1", "connected_at": 3},
                ],
                "leader": "sid-1",
            },
            room="wf-1",
        )

    def test_broadcast_online_users_reassigns_missing_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, socketio = service
        users = [{"user_id": "u-2", "username": "B", "avatar": None, "sid": "sid-2", "connected_at": 1}]
        repository.get_current_leader.return_value = "sid-old"

        with (
            patch.object(collaboration_service, "_prune_inactive_sessions", return_value=users),
            patch.object(collaboration_service, "_select_graph_leader", return_value="sid-2"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            collaboration_service.broadcast_online_users("wf-1")

        repository.delete_leader.assert_called_once_with("wf-1")
        repository.set_leader.assert_called_once_with("wf-1", "sid-2")
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")
        socketio.emit.assert_called_once_with(
            "online_users",
            {"workflow_id": "wf-1", "users": users, "leader": "sid-2"},
            room="wf-1",
        )

    def test_refresh_session_state_expires_active_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = "sid-1"

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            # Act
            collaboration_service.refresh_session_state("wf-1", "sid-1")

        # Assert
        repository.refresh_session_state.assert_called_once_with("wf-1", "sid-1")
        repository.expire_leader.assert_called_once_with("wf-1")
        repository.set_leader.assert_not_called()

    def test_refresh_session_state_sets_leader_when_missing(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = None
        repository.list_sessions.return_value = [
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-2",
                "connected_at": 1,
                "graph_active": True,
            }
        ]

        with (
            patch.object(collaboration_service, "is_session_active", return_value=True),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            # Act
            collaboration_service.refresh_session_state("wf-1", "sid-2")

        # Assert
        repository.set_leader.assert_called_once_with("wf-1", "sid-2")
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")

    def test_refresh_session_state_replaces_inactive_existing_leader(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = "sid-old"

        with (
            patch.object(collaboration_service, "is_session_active", return_value=False),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            collaboration_service.refresh_session_state("wf-1", "sid-new")

        repository.delete_leader.assert_called_once_with("wf-1")
        repository.set_leader.assert_called_once_with("wf-1", "sid-new")
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-new")

    def test_relay_graph_event_emits_update(self, service: tuple[WorkflowCollaborationService, Mock, Mock]) -> None:
        # Arrange
        collaboration_service, repository, socketio = service
        repository.get_sid_mapping.return_value = {"workflow_id": "wf-1", "user_id": "u-1"}

        # Act
        result = collaboration_service.relay_graph_event("sid-1", {"nodes": []})

        # Assert
        assert result == ({"msg": "graph_update_broadcasted"}, 200)
        repository.refresh_session_state.assert_called_once_with("wf-1", "sid-1")
        socketio.emit.assert_called_once_with("graph_update", {"nodes": []}, room="wf-1", skip_sid="sid-1")

    def test_prune_inactive_sessions_handles_empty_and_removes_stale(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        collaboration_service, repository, _socketio = service
        repository.list_sessions.return_value = []
        assert collaboration_service._prune_inactive_sessions("wf-1") == []

        active = {"sid": "sid-1", "user_id": "u-1", "connected_at": 1}
        stale = {"sid": "sid-2", "user_id": "u-2", "connected_at": 2}
        repository.list_sessions.return_value = [active, stale]

        with patch.object(
            collaboration_service,
            "is_session_active",
            side_effect=lambda _workflow_id, sid: sid == "sid-1",
        ):
            users = collaboration_service._prune_inactive_sessions("wf-1")

        assert users == [active]
        repository.delete_session.assert_called_with("wf-1", "sid-2")

    def test_is_session_active_guard_branches(self, service: tuple[WorkflowCollaborationService, Mock, Mock]) -> None:
        collaboration_service, repository, socketio = service
        socketio.manager.is_connected.return_value = True
        repository.session_exists.return_value = True
        repository.sid_mapping_exists.return_value = True

        assert collaboration_service.is_session_active("wf-1", "") is False

        socketio.manager.is_connected.return_value = False
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False

        socketio.manager.is_connected.side_effect = AttributeError("missing manager")
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False
        socketio.manager.is_connected.side_effect = None

        socketio.manager.is_connected.return_value = True
        repository.session_exists.return_value = False
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False

        repository.session_exists.return_value = True
        repository.sid_mapping_exists.return_value = False
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False
