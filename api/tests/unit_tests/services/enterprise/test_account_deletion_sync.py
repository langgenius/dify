"""Unit tests for account deletion synchronization with SQLite memberships.

Verifies enterprise account deletion sync functionality including
Redis queuing, error handling, and community vs enterprise behavior.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from redis import RedisError
from sqlalchemy.orm import Session

from models.account import TenantAccountJoin
from services.enterprise.account_deletion_sync import (
    _queue_task,
    sync_account_deletion,
    sync_workspace_member_removal,
)


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

    def test_sync_workspace_member_removal_enterprise_enabled(self, mock_queue_task):
        workspace_id = str(uuid4())
        member_id = str(uuid4())

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            result = sync_workspace_member_removal(workspace_id=workspace_id, member_id=member_id, source="removed")

            assert result is True
            mock_queue_task.assert_called_once_with(workspace_id=workspace_id, member_id=member_id, source="removed")

    def test_sync_workspace_member_removal_enterprise_disabled(self, mock_queue_task):
        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False

            result = sync_workspace_member_removal(
                workspace_id=str(uuid4()), member_id=str(uuid4()), source="test_source"
            )

            assert result is True
            mock_queue_task.assert_not_called()

    def test_sync_workspace_member_removal_queue_failure(self, mock_queue_task):
        mock_queue_task.return_value = False

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            result = sync_workspace_member_removal(
                workspace_id=str(uuid4()), member_id=str(uuid4()), source="test_source"
            )

            assert result is False


@pytest.mark.parametrize("sqlite_session", [(TenantAccountJoin,)], indirect=True)
class TestSyncAccountDeletion:
    @pytest.fixture
    def mock_queue_task(self):
        with patch("services.enterprise.account_deletion_sync._queue_task") as mock_queue:
            mock_queue.return_value = True
            yield mock_queue

    def test_sync_account_deletion_enterprise_disabled(self, mock_queue_task, sqlite_session: Session) -> None:
        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False

            result = sync_account_deletion(account_id=str(uuid4()), source="account_deleted", session=sqlite_session)

            assert result is True
            mock_queue_task.assert_not_called()

    def test_sync_account_deletion_multiple_workspaces(self, sqlite_session: Session, mock_queue_task) -> None:
        account_id = str(uuid4())
        tenant_ids = [str(uuid4()) for _ in range(3)]

        for tenant_id in tenant_ids:
            join = TenantAccountJoin(tenant_id=tenant_id, account_id=account_id)
            sqlite_session.add(join)
        sqlite_session.commit()

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            result = sync_account_deletion(account_id=account_id, source="account_deleted", session=sqlite_session)

            assert result is True
            assert mock_queue_task.call_count == 3

            queued_workspace_ids = {call.kwargs["workspace_id"] for call in mock_queue_task.call_args_list}
            assert queued_workspace_ids == set(tenant_ids)

    def test_sync_account_deletion_no_workspaces(self, sqlite_session: Session, mock_queue_task) -> None:
        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            result = sync_account_deletion(account_id=str(uuid4()), source="account_deleted", session=sqlite_session)

            assert result is True
            mock_queue_task.assert_not_called()

    def test_sync_account_deletion_partial_failure(self, sqlite_session: Session, mock_queue_task) -> None:
        account_id = str(uuid4())
        tenant_ids = [str(uuid4()) for _ in range(3)]
        fail_tenant = tenant_ids[1]

        for tenant_id in tenant_ids:
            join = TenantAccountJoin(tenant_id=tenant_id, account_id=account_id)
            sqlite_session.add(join)
        sqlite_session.commit()

        def queue_side_effect(workspace_id, member_id, source):
            return workspace_id != fail_tenant

        mock_queue_task.side_effect = queue_side_effect

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            result = sync_account_deletion(account_id=account_id, source="account_deleted", session=sqlite_session)

            assert result is False
            assert mock_queue_task.call_count == 3

    def test_sync_account_deletion_all_failures(self, sqlite_session: Session, mock_queue_task) -> None:
        account_id = str(uuid4())
        tenant_id = str(uuid4())

        join = TenantAccountJoin(tenant_id=tenant_id, account_id=account_id)
        sqlite_session.add(join)
        sqlite_session.commit()

        mock_queue_task.return_value = False

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            result = sync_account_deletion(account_id=account_id, source="account_deleted", session=sqlite_session)

            assert result is False
            mock_queue_task.assert_called_once()
