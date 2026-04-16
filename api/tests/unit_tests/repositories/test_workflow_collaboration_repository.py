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
        mock_redis.get.return_value = b'{"workflow_id":"wf-1","user_id":"u-1"}'
        repository = WorkflowCollaborationRepository()

        # Act
        result = repository.get_sid_mapping("sid-1")

        # Assert
        assert result == {"workflow_id": "wf-1", "user_id": "u-1"}

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
        }

        # Act
        repository.set_session_info("wf-1", payload)

        # Assert
        assert mock_redis.hset.called
        workflow_key, sid, session_json = mock_redis.hset.call_args.args
        assert workflow_key == "workflow_online_users:wf-1"
        assert sid == "sid-1"
        assert json.loads(session_json)["user_id"] == "u-1"
        assert mock_redis.set.called

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
