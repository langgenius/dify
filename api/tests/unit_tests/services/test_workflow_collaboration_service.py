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

    def test_register_session_returns_leader_status(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, socketio = service
        socketio.get_session.return_value = {"user_id": "u-1", "username": "Jane", "avatar": None}

        with (
            patch.object(collaboration_service, "get_or_set_leader", return_value="sid-1"),
            patch.object(collaboration_service, "broadcast_online_users"),
        ):
            # Act
            result = collaboration_service.register_session("wf-1", "sid-1")

        # Assert
        assert result == ("u-1", True)
        repository.set_session_info.assert_called_once()
        socketio.enter_room.assert_called_once_with("sid-1", "wf-1")
        socketio.emit.assert_called_once_with("status", {"isLeader": True}, room="sid-1")

    def test_register_session_returns_none_when_missing_user(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, _repository, socketio = service
        socketio.get_session.return_value = {}

        # Act
        result = collaboration_service.register_session("wf-1", "sid-1")

        # Assert
        assert result is None

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

        with (
            patch.object(collaboration_service, "is_session_active", return_value=False),
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

        # Act
        result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        # Assert
        assert result == "sid-3"

    def test_handle_leader_disconnect_elects_new(
        self, service: tuple[WorkflowCollaborationService, Mock, Mock]
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = service
        repository.get_current_leader.return_value = "sid-1"
        repository.get_session_sids.return_value = ["sid-2"]

        with patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change:
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
        repository.get_session_sids.return_value = []

        # Act
        collaboration_service.handle_leader_disconnect("wf-1", "sid-1")

        # Assert
        repository.delete_leader.assert_called_once_with("wf-1")

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
