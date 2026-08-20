"""Unit tests for account deletion synchronization.

Verifies enterprise account deletion sync functionality including
Redis queuing, error handling, and community vs enterprise behavior.
"""

from __future__ import annotations

import json
from unittest.mock import ANY, patch
from uuid import uuid4

import pytest
from redis import RedisError

from enums import DeploymentEdition
from services.enterprise.account_deletion_sync import (
    ACCOUNT_DELETION_FROM_WORKSPACE_SYNC_TASK_TYPE,
    ACCOUNT_DELETION_SYNC_TASK_TYPE,
    WORKSPACE_MEMBER_REMOVAL_SYNC_TASK_TYPE,
    sync_account_deletion,
    sync_workspace_member_removal,
)


@pytest.fixture(autouse=True)
def _enterprise_edition(config_overrides) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)


class TestSyncWorkspaceMemberRemoval:
    def test_sync_workspace_member_removal_enterprise_edition(self):
        workspace_id = str(uuid4())
        member_id = str(uuid4())

        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            result = sync_workspace_member_removal(workspace_id=workspace_id, member_id=member_id, source="removed")

        assert result is True
        queue, raw_task = mock_redis.lpush.call_args.args
        assert queue == "{enterprise:member:sync}:queue"
        assert json.loads(raw_task) == {
            "task_id": ANY,
            "workspace_id": workspace_id,
            "member_id": member_id,
            "retry_count": 0,
            "created_at": ANY,
            "source": "removed",
            "type": WORKSPACE_MEMBER_REMOVAL_SYNC_TASK_TYPE,
        }

    def test_sync_workspace_member_removal_non_enterprise_edition(self, config_overrides):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            result = sync_workspace_member_removal(
                workspace_id=str(uuid4()), member_id=str(uuid4()), source="test_source"
            )

        assert result is True
        mock_redis.lpush.assert_not_called()

    def test_sync_workspace_member_removal_queue_failure(self):
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            mock_redis.lpush.side_effect = RedisError("Connection failed")

            result = sync_workspace_member_removal(
                workspace_id=str(uuid4()), member_id=str(uuid4()), source="test_source"
            )

        assert result is False


class TestSyncAccountDeletion:
    def test_sync_account_deletion_non_enterprise_edition(self, config_overrides) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            result = sync_account_deletion(account_id=str(uuid4()), workspace_ids=[], source="account_deleted")

            assert result is True
            mock_redis.lpush.assert_not_called()

    def test_sync_account_deletion_multiple_workspaces(self) -> None:
        account_id = str(uuid4())
        workspace_ids = [str(uuid4()) for _ in range(3)]
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            result = sync_account_deletion(account_id=account_id, workspace_ids=workspace_ids, source="account_deleted")

        assert result is True
        queue, *raw_tasks = mock_redis.lpush.call_args.args
        assert queue == "{enterprise:member:sync}:queue"
        tasks = [json.loads(task) for task in raw_tasks]
        assert tasks == [
            {
                "task_id": ANY,
                "workspace_id": workspace_id,
                "member_id": account_id,
                "retry_count": 0,
                "created_at": ANY,
                "source": "account_deleted",
                "type": ACCOUNT_DELETION_FROM_WORKSPACE_SYNC_TASK_TYPE,
            }
            for workspace_id in workspace_ids
        ] + [
            {
                "task_id": ANY,
                "member_id": account_id,
                "retry_count": 0,
                "created_at": ANY,
                "source": "account_deleted",
                "type": ACCOUNT_DELETION_SYNC_TASK_TYPE,
            }
        ]

    def test_sync_account_deletion_no_workspaces(self) -> None:
        account_id = str(uuid4())
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            result = sync_account_deletion(account_id=account_id, workspace_ids=[], source="account_deleted")

        assert result is True
        _, raw_task = mock_redis.lpush.call_args.args
        assert json.loads(raw_task) == {
            "task_id": ANY,
            "member_id": account_id,
            "retry_count": 0,
            "created_at": ANY,
            "source": "account_deleted",
            "type": ACCOUNT_DELETION_SYNC_TASK_TYPE,
        }

    def test_sync_account_deletion_redis_failure_is_atomic(self) -> None:
        account_id = str(uuid4())
        workspace_ids = [str(uuid4()) for _ in range(3)]
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            mock_redis.lpush.side_effect = RedisError("Connection failed")
            result = sync_account_deletion(account_id=account_id, workspace_ids=workspace_ids, source="account_deleted")

        assert result is False
        mock_redis.lpush.assert_called_once()
