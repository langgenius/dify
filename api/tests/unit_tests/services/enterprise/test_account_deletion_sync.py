"""Unit tests for account deletion synchronization.

This test module verifies the enterprise account deletion sync functionality,
including Redis queuing, error handling, and community vs enterprise behavior.
"""

from unittest.mock import MagicMock, patch

import pytest
from redis import RedisError

from services.enterprise.account_deletion_sync import (
    _queue_task,
    sync_account_deletion,
    sync_workspace_member_removal,
)


class TestQueueTask:
    """Unit tests for the _queue_task helper function."""

    @pytest.fixture
    def mock_redis_client(self):
        """Mock redis_client for testing."""
        with patch("services.enterprise.account_deletion_sync.redis_client") as mock_redis:
            yield mock_redis

    @pytest.fixture
    def mock_uuid(self):
        """Mock UUID generation for predictable task IDs."""
        with patch("services.enterprise.account_deletion_sync.uuid.uuid4") as mock_uuid_gen:
            mock_uuid_gen.return_value = MagicMock(hex="test-task-id-1234")
            yield mock_uuid_gen

    def test_queue_task_success(self, mock_redis_client, mock_uuid):
        """Test successful task queueing to Redis."""
        # Arrange
        workspace_id = "ws-123"
        member_id = "member-456"
        source = "test_source"

        # Act
        result = _queue_task(workspace_id=workspace_id, member_id=member_id, source=source)

        # Assert
        assert result is True
        mock_redis_client.lpush.assert_called_once()

        # Verify the task payload structure
        call_args = mock_redis_client.lpush.call_args[0]
        assert call_args[0] == "enterprise:member:sync:queue"

        import json

        task_data = json.loads(call_args[1])
        assert task_data["workspace_id"] == workspace_id
        assert task_data["member_id"] == member_id
        assert task_data["source"] == source
        assert task_data["type"] == "sync_member_deletion_from_workspace"
        assert task_data["retry_count"] == 0
        assert "task_id" in task_data
        assert "created_at" in task_data

    def test_queue_task_redis_error(self, mock_redis_client, caplog):
        """Test handling of Redis connection errors."""
        # Arrange
        mock_redis_client.lpush.side_effect = RedisError("Connection failed")

        # Act
        result = _queue_task(workspace_id="ws-123", member_id="member-456", source="test_source")

        # Assert
        assert result is False
        assert "Failed to queue account deletion sync" in caplog.text

    def test_queue_task_type_error(self, mock_redis_client, caplog):
        """Test handling of JSON serialization errors."""
        # Arrange
        mock_redis_client.lpush.side_effect = TypeError("Cannot serialize")

        # Act
        result = _queue_task(workspace_id="ws-123", member_id="member-456", source="test_source")

        # Assert
        assert result is False
        assert "Failed to queue account deletion sync" in caplog.text


class TestSyncWorkspaceMemberRemoval:
    """Unit tests for sync_workspace_member_removal function."""

    @pytest.fixture
    def mock_queue_task(self):
        """Mock _queue_task for testing."""
        with patch("services.enterprise.account_deletion_sync._queue_task") as mock_queue:
            mock_queue.return_value = True
            yield mock_queue

    def test_sync_workspace_member_removal_enterprise_enabled(self, mock_queue_task):
        """Test sync when ENTERPRISE_ENABLED is True."""
        # Arrange
        workspace_id = "ws-123"
        member_id = "member-456"
        source = "workspace_member_removed"

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            # Act
            result = sync_workspace_member_removal(workspace_id=workspace_id, member_id=member_id, source=source)

            # Assert
            assert result is True
            mock_queue_task.assert_called_once_with(workspace_id=workspace_id, member_id=member_id, source=source)

    def test_sync_workspace_member_removal_enterprise_disabled(self, mock_queue_task):
        """Test sync when ENTERPRISE_ENABLED is False (community edition)."""
        # Arrange
        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False

            # Act
            result = sync_workspace_member_removal(workspace_id="ws-123", member_id="member-456", source="test_source")

            # Assert
            assert result is True
            mock_queue_task.assert_not_called()

    def test_sync_workspace_member_removal_queue_failure(self, mock_queue_task):
        """Test handling of queue task failures."""
        # Arrange
        mock_queue_task.return_value = False

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            # Act
            result = sync_workspace_member_removal(workspace_id="ws-123", member_id="member-456", source="test_source")

            # Assert
            assert result is False


class TestSyncAccountDeletion:
    """Unit tests for sync_account_deletion function."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session for testing."""
        with patch("services.enterprise.account_deletion_sync.db.session") as mock_session:
            yield mock_session

    @pytest.fixture
    def mock_queue_task(self):
        """Mock _queue_task for testing."""
        with patch("services.enterprise.account_deletion_sync._queue_task") as mock_queue:
            mock_queue.return_value = True
            yield mock_queue

    def test_sync_account_deletion_enterprise_disabled(self, mock_db_session, mock_queue_task):
        """Test sync when ENTERPRISE_ENABLED is False (community edition)."""
        # Arrange
        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False

            # Act
            result = sync_account_deletion(account_id="acc-123", source="account_deleted")

            # Assert
            assert result is True
            mock_db_session.query.assert_not_called()
            mock_queue_task.assert_not_called()

    def test_sync_account_deletion_multiple_workspaces(self, mock_db_session, mock_queue_task):
        """Test sync for account with multiple workspace memberships."""
        # Arrange
        account_id = "acc-123"

        # Mock workspace joins
        mock_join1 = MagicMock()
        mock_join1.tenant_id = "tenant-1"
        mock_join2 = MagicMock()
        mock_join2.tenant_id = "tenant-2"
        mock_join3 = MagicMock()
        mock_join3.tenant_id = "tenant-3"

        mock_query = MagicMock()
        mock_query.filter_by.return_value.all.return_value = [mock_join1, mock_join2, mock_join3]
        mock_db_session.query.return_value = mock_query

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            # Act
            result = sync_account_deletion(account_id=account_id, source="account_deleted")

            # Assert
            assert result is True
            assert mock_queue_task.call_count == 3

            # Verify each workspace was queued
            mock_queue_task.assert_any_call(workspace_id="tenant-1", member_id=account_id, source="account_deleted")
            mock_queue_task.assert_any_call(workspace_id="tenant-2", member_id=account_id, source="account_deleted")
            mock_queue_task.assert_any_call(workspace_id="tenant-3", member_id=account_id, source="account_deleted")

    def test_sync_account_deletion_no_workspaces(self, mock_db_session, mock_queue_task):
        """Test sync for account with no workspace memberships."""
        # Arrange
        mock_query = MagicMock()
        mock_query.filter_by.return_value.all.return_value = []
        mock_db_session.query.return_value = mock_query

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            # Act
            result = sync_account_deletion(account_id="acc-123", source="account_deleted")

            # Assert
            assert result is True
            mock_queue_task.assert_not_called()

    def test_sync_account_deletion_partial_failure(self, mock_db_session, mock_queue_task):
        """Test sync when some tasks fail to queue."""
        # Arrange
        account_id = "acc-123"

        # Mock workspace joins
        mock_join1 = MagicMock()
        mock_join1.tenant_id = "tenant-1"
        mock_join2 = MagicMock()
        mock_join2.tenant_id = "tenant-2"
        mock_join3 = MagicMock()
        mock_join3.tenant_id = "tenant-3"

        mock_query = MagicMock()
        mock_query.filter_by.return_value.all.return_value = [mock_join1, mock_join2, mock_join3]
        mock_db_session.query.return_value = mock_query

        # Mock queue_task to fail for second workspace
        def queue_side_effect(workspace_id, member_id, source):
            return workspace_id != "tenant-2"

        mock_queue_task.side_effect = queue_side_effect

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            # Act
            result = sync_account_deletion(account_id=account_id, source="account_deleted")

            # Assert
            assert result is False  # Should return False if any task fails
            assert mock_queue_task.call_count == 3

    def test_sync_account_deletion_all_failures(self, mock_db_session, mock_queue_task):
        """Test sync when all tasks fail to queue."""
        # Arrange
        mock_join = MagicMock()
        mock_join.tenant_id = "tenant-1"

        mock_query = MagicMock()
        mock_query.filter_by.return_value.all.return_value = [mock_join]
        mock_db_session.query.return_value = mock_query

        mock_queue_task.return_value = False

        with patch("services.enterprise.account_deletion_sync.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            # Act
            result = sync_account_deletion(account_id="acc-123", source="account_deleted")

            # Assert
            assert result is False
            mock_queue_task.assert_called_once()
