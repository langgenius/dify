"""Unit tests for account deletion synchronization.

Verifies enterprise account deletion sync functionality including
Redis queuing, error handling, and community vs enterprise behavior.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from redis import RedisError

from enums import DeploymentEdition
from services.enterprise.account_deletion_sync import (
    _queue_task,
    sync_account_deletion_memberships,
    sync_workspace_member_removal,
)


@pytest.fixture(autouse=True)
def _enterprise_edition(config_overrides) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)


class TestQueueTask:
    def test_queue_task_redis_error(self, caplog: pytest.LogCaptureFixture):
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            mock_redis.lpush.side_effect = RedisError("Connection failed")

            result = _queue_task(workspace_id="ws-123", member_id="member-456", source="test_source")

            assert result is False
            assert "Failed to queue account deletion sync" in caplog.text

    def test_queue_task_type_error(self, caplog: pytest.LogCaptureFixture):
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            mock_redis.lpush.side_effect = TypeError("Cannot serialize")

            result = _queue_task(workspace_id="ws-123", member_id="member-456", source="test_source")

            assert result is False
            assert "Failed to queue account deletion sync" in caplog.text


class TestSyncWorkspaceMemberRemoval:
    @pytest.fixture
    def mock_queue_task(self):
        with patch("services.enterprise.account_deletion_sync._queue_task") as mock_queue:
            mock_queue.return_value = True
            yield mock_queue

    def test_sync_workspace_member_removal_enterprise_edition(self, mock_queue_task):
        workspace_id = str(uuid4())
        member_id = str(uuid4())

        result = sync_workspace_member_removal(workspace_id=workspace_id, member_id=member_id, source="removed")

        assert result is True
        mock_queue_task.assert_called_once_with(workspace_id=workspace_id, member_id=member_id, source="removed")

    def test_sync_workspace_member_removal_non_enterprise_edition(self, mock_queue_task, config_overrides):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        result = sync_workspace_member_removal(workspace_id=str(uuid4()), member_id=str(uuid4()), source="test_source")

        assert result is True
        mock_queue_task.assert_not_called()

    def test_sync_workspace_member_removal_queue_failure(self, mock_queue_task):
        mock_queue_task.return_value = False

        result = sync_workspace_member_removal(workspace_id=str(uuid4()), member_id=str(uuid4()), source="test_source")

        assert result is False


def test_sync_account_deletion_memberships_queues_preloaded_workspace_ids() -> None:
    with (
        patch("services.enterprise.account_deletion_sync.dify_config") as mock_config,
        patch("services.enterprise.account_deletion_sync._queue_task", return_value=True) as queue_task,
    ):
        mock_config.DEPLOYMENT_EDITION = DeploymentEdition.ENTERPRISE

        result = sync_account_deletion_memberships(
            account_id="account-1",
            workspace_ids=("workspace-1", "workspace-2"),
            source="account_deleted",
        )

    assert result is True
    assert [call.kwargs["workspace_id"] for call in queue_task.call_args_list] == ["workspace-1", "workspace-2"]
