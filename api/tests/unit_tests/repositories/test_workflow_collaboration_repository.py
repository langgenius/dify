import json
from unittest.mock import Mock

import pytest

from repositories import workflow_collaboration_repository as repo_module
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository


class TestWorkflowCollaborationRepository:
    @pytest.fixture
    def mock_redis(self, monkeypatch: pytest.MonkeyPatch) -> Mock:
        mock_redis = Mock()
        monkeypatch.setattr(repo_module, "redis_client", mock_redis)
        return mock_redis

    def test_get_sid_mapping_returns_mapping(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.get.return_value = b'{"workflow_id":"wf-1","user_id":"u-1","server_id":"server-1"}'
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.get_sid_mapping("sid-1")

        # Assert
        assert result == {"workflow_id": "wf-1", "user_id": "u-1", "server_id": "server-1"}

    def test_list_sessions_filters_invalid_entries(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.hgetall.return_value = {
            b"sid-1": b'{"user_id":"u-1","username":"Jane","sid":"sid-1","connected_at":2}',
            b"sid-2": b'{"username":"Missing","sid":"sid-2"}',
            b"sid-3": b"not-json",
        }
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.list_sessions("wf-1")

        # Assert
        assert result == [
            {
                "user_id": "u-1",
                "username": "Jane",
                "avatar": None,
                "sid": "sid-1",
                "connected_at": 2,
            }
        ]

    def test_list_sessions_preserves_graph_active_false(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.hgetall.return_value = {
            b"sid-1": b'{"user_id":"u-1","username":"Jane","sid":"sid-1","connected_at":2,"graph_active":false}',
        }
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.list_sessions("wf-1")

        # Assert
        assert result[0]["graph_active"] is False

    def test_get_session_info_returns_session_with_optional_fields(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.hget.return_value = (
            b'{"user_id":"u-1","username":"Jane","sid":"sid-1","connected_at":2,'
            b'"server_id":"server-1","graph_active":false}'
        )
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.get_session_info("wf-1", "sid-1")

        # Assert
        assert result == {
            "user_id": "u-1",
            "username": "Jane",
            "avatar": None,
            "sid": "sid-1",
            "connected_at": 2,
            "server_id": "server-1",
            "graph_active": False,
        }
        mock_redis.hget.assert_called_once_with("workflow_online_users:wf-1", "sid-1")

    def test_get_session_info_returns_none_on_missing_or_bad_json(self, mock_redis: Mock) -> None:
        repository = WorkflowCollaborationRepository()

        mock_redis.hget.return_value = None
        assert repository.get_session_info("wf-1", "sid-1") is None

        mock_redis.hget.return_value = b"not-json"
        assert repository.get_session_info("wf-1", "sid-1") is None

        mock_redis.hget.return_value = b'{"username":"missing-required-keys"}'
        assert repository.get_session_info("wf-1", "sid-1") is None

    def test_update_session_graph_active_preserves_other_fields(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.hget.return_value = (
            b'{"user_id":"u-1","username":"Jane","avatar":"a-1","sid":"sid-1","connected_at":2,"server_id":"server-1"}'
        )
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.update_session_graph_active("wf-1", "sid-1", active=False)

        # Assert
        assert result is True
        workflow_key, sid, session_json = mock_redis.hset.call_args.args
        assert workflow_key == "workflow_online_users:wf-1"
        assert sid == "sid-1"
        stored = json.loads(session_json)
        assert stored["graph_active"] is False
        assert stored["server_id"] == "server-1"
        assert stored["user_id"] == "u-1"

    def test_update_session_graph_active_returns_false_when_session_missing(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.hget.return_value = None
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.update_session_graph_active("wf-1", "sid-1", active=False)

        # Assert
        assert result is False
        mock_redis.hset.assert_not_called()

    def test_set_session_info_persists_payload(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.exists.return_value = True
        repository = WorkflowCollaborationRepository()
        payload = {
            "user_id": "u-1",
            "username": "Jane",
            "avatar": None,
            "sid": "sid-1",
            "connected_at": 1,
            "server_id": "server-1",
        }

        # Act
        repository.set_session_info("wf-1", payload)

        # Assert
        assert mock_redis.hset.called
        workflow_key, sid, session_json = mock_redis.hset.call_args_list[0].args
        assert workflow_key == "workflow_online_users:wf-1"
        assert sid == "sid-1"
        assert json.loads(session_json)["user_id"] == "u-1"
        server_sessions_key, server_sid, server_workflow_id = mock_redis.hset.call_args_list[1].args
        assert server_sessions_key == "ws_server_sessions:server-1"
        assert server_sid == "sid-1"
        assert server_workflow_id == "wf-1"
        assert mock_redis.set.called
        _sid_key, sid_mapping_json = mock_redis.set.call_args.args
        assert json.loads(sid_mapping_json)["server_id"] == "server-1"

    def test_delete_session_removes_server_session_mapping(self, mock_redis: Mock) -> None:
        mock_redis.get.return_value = b'{"workflow_id":"wf-1","user_id":"u-1","server_id":"server-1"}'
        repository = WorkflowCollaborationRepository()

        repository.delete_session("wf-1", "sid-1")

        mock_redis.hdel.assert_any_call("ws_server_sessions:server-1", "sid-1")
        mock_redis.hdel.assert_any_call("workflow_online_users:wf-1", "sid-1")
        mock_redis.delete.assert_called_once_with("ws_sid_map:sid-1")

    def test_refresh_session_state_expires_keys(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.exists.return_value = True
        repository = WorkflowCollaborationRepository()

        # Act
        repository.refresh_session_state("wf-1", "sid-1")

        # Assert
        assert mock_redis.expire.call_count == 2

    def test_get_current_leader_decodes_bytes(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.get.return_value = b"sid-1"
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.get_current_leader("wf-1")

        # Assert
        assert result == "sid-1"

    def test_set_leader_if_absent_uses_nx(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.set.return_value = True
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.set_leader_if_absent("wf-1", "sid-1")

        # Assert
        assert result is True
        _key, _value = mock_redis.set.call_args.args
        assert _key == "workflow_leader:wf-1"
        assert _value == "sid-1"
        assert mock_redis.set.call_args.kwargs["nx"] is True
        assert "ex" in mock_redis.set.call_args.kwargs

    def test_get_session_sids_decodes(self, mock_redis: Mock) -> None:
        # Arrange
        mock_redis.hkeys.return_value = [b"sid-1", "sid-2"]
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.get_session_sids("wf-1")

        # Assert
        assert result == ["sid-1", "sid-2"]

    def test_refresh_server_heartbeat_sets_ttl(self, mock_redis: Mock) -> None:
        repository = WorkflowCollaborationRepository()

        repository.refresh_server_heartbeat("server-1")

        mock_redis.set.assert_called_once()
        key, value = mock_redis.set.call_args.args
        assert key == "ws_server_heartbeat:server-1"
        assert value == "1"
        assert mock_redis.set.call_args.kwargs["ex"] > 0

    def test_server_heartbeat_exists(self, mock_redis: Mock) -> None:
        mock_redis.exists.return_value = 1
        repository = WorkflowCollaborationRepository()

        assert repository.server_heartbeat_exists("server-1") is True
        mock_redis.exists.assert_called_once_with("ws_server_heartbeat:server-1")

    def test_refresh_server_sessions_refreshes_owned_session_ttls(self, mock_redis: Mock) -> None:
        mock_redis.hgetall.return_value = {b"sid-1": b"wf-1"}
        mock_redis.exists.return_value = 1
        repository = WorkflowCollaborationRepository()

        repository.refresh_server_sessions("server-1")

        mock_redis.expire.assert_any_call("workflow_online_users:wf-1", 3600)
        mock_redis.expire.assert_any_call("ws_sid_map:sid-1", 3600)
        mock_redis.expire.assert_any_call("ws_server_sessions:server-1", 3600)

    def test_refresh_server_sessions_drops_stale_sid(self, mock_redis: Mock) -> None:
        mock_redis.hgetall.return_value = {b"sid-stale": b"wf-1"}
        mock_redis.exists.return_value = 0
        repository = WorkflowCollaborationRepository()

        repository.refresh_server_sessions("server-1")

        mock_redis.hdel.assert_called_once_with("ws_server_sessions:server-1", "sid-stale")
