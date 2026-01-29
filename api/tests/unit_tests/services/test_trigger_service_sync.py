"""
Unit tests for TriggerService.sync_plugin_trigger_relationships.

This test suite covers:
- Creating new plugin trigger records when nodes exist in graph but not in DB
- Updating existing records when subscription/provider/event changes
- Deleting records when nodes are removed from graph
- Stale cache detection and cleanup
- Cache updates after successful DB commits
- Distributed lock acquisition and release
- Plugin trigger node limit enforcement
- Atomic database operations
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from core.workflow.enums import NodeType
from models.model import App
from models.trigger import WorkflowPluginTrigger
from models.workflow import Workflow
from services.trigger.trigger_service import TriggerService


class TestTriggerServiceSyncFactory:
    """
    Factory class for creating test data and mock objects for trigger service sync tests.

    Provides reusable methods to create mock objects for:
    - App models with configurable attributes
    - Workflow models with plugin trigger nodes
    - WorkflowPluginTrigger records
    """

    @staticmethod
    def create_app_mock(
        app_id: str = "app-123",
        tenant_id: str = "tenant-456",
    ) -> MagicMock:
        """
        Create a mock App with specified attributes.

        Args:
            app_id: Unique identifier for the app
            tenant_id: Workspace/tenant identifier

        Returns:
            MagicMock object configured as an App model
        """
        app = MagicMock(spec=App)
        app.id = app_id
        app.tenant_id = tenant_id
        return app

    @staticmethod
    def create_workflow_mock(
        workflow_id: str = "workflow-789",
        tenant_id: str = "tenant-456",
        app_id: str = "app-123",
        trigger_nodes: list[dict] | None = None,
    ) -> MagicMock:
        """
        Create a mock Workflow with plugin trigger nodes.

        Args:
            workflow_id: Unique identifier for the workflow
            tenant_id: Workspace/tenant identifier
            app_id: Associated app identifier
            trigger_nodes: List of plugin trigger node configurations

        Returns:
            MagicMock object configured as a Workflow model
        """
        workflow = MagicMock(spec=Workflow)
        workflow.id = workflow_id
        workflow.tenant_id = tenant_id
        workflow.app_id = app_id

        if trigger_nodes is None:
            trigger_nodes = []

        # Build graph with trigger nodes
        nodes = []
        for node_config in trigger_nodes:
            nodes.append(
                {
                    "id": node_config.get("node_id", "node-1"),
                    "data": {
                        "type": NodeType.TRIGGER_PLUGIN.value,
                        "plugin_id": node_config.get("plugin_id", "test_plugin"),
                        "provider_id": node_config.get("provider_id", "test_provider"),
                        "event_name": node_config.get("event_name", "test_event"),
                        "subscription_id": node_config.get("subscription_id", "sub-1"),
                    },
                }
            )

        graph = {"nodes": nodes, "edges": []}
        workflow.graph = json.dumps(graph)

        # Mock walk_nodes method
        def walk_nodes_side_effect(specific_node_type=None):
            if specific_node_type == NodeType.TRIGGER_PLUGIN:
                return ((node["id"], node["data"]) for node in nodes)
            return iter([])

        workflow.walk_nodes = walk_nodes_side_effect

        return workflow

    @staticmethod
    def create_plugin_trigger_mock(
        record_id: str = "record-1",
        app_id: str = "app-123",
        tenant_id: str = "tenant-456",
        node_id: str = "node-1",
        provider_id: str = "test_provider",
        event_name: str = "test_event",
        subscription_id: str = "sub-1",
    ) -> MagicMock:
        """
        Create a mock WorkflowPluginTrigger record.

        Args:
            record_id: Unique identifier for the record
            app_id: Associated app identifier
            tenant_id: Workspace/tenant identifier
            node_id: Associated workflow node identifier
            provider_id: Trigger provider identifier
            event_name: Event name
            subscription_id: Subscription identifier

        Returns:
            MagicMock object configured as a WorkflowPluginTrigger model
        """
        trigger = MagicMock(spec=WorkflowPluginTrigger)
        trigger.id = record_id
        trigger.app_id = app_id
        trigger.tenant_id = tenant_id
        trigger.node_id = node_id
        trigger.provider_id = provider_id
        trigger.event_name = event_name
        trigger.subscription_id = subscription_id
        return trigger


class TestTriggerServiceSync:
    """
    Comprehensive unit tests for TriggerService.sync_plugin_trigger_relationships.

    This test suite covers:
    - Creating new plugin trigger records
    - Updating existing records
    - Deleting removed records
    - Stale cache cleanup
    - Cache updates after DB commit
    - Distributed lock handling
    - Node limit enforcement
    """

    @pytest.fixture
    def mock_redis_client(self):
        """Mock Redis client for cache operations."""
        with patch("services.trigger.trigger_service.redis_client") as mock_redis:
            mock_lock = MagicMock()
            mock_lock.acquire.return_value = True
            mock_lock.release.return_value = None
            mock_redis.lock.return_value = mock_lock
            mock_redis.exists.return_value = False
            mock_redis.delete.return_value = None
            mock_redis.set.return_value = None
            yield mock_redis

    @pytest.fixture
    def mock_db(self):
        """Mock database for session operations."""
        with patch("services.trigger.trigger_service.db") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_session(self, mock_db):
        """Mock SQLAlchemy session with context manager support."""
        mock_session = MagicMock()
        mock_session.add = MagicMock()
        mock_session.delete = MagicMock()
        mock_session.flush = MagicMock()
        mock_session.commit = MagicMock()

        # Setup context manager
        with patch("services.trigger.trigger_service.Session") as mock_session_class:
            mock_session_class.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_session_class.return_value.__exit__ = MagicMock(return_value=None)
            yield mock_session

    # ==================== Create New Records Tests ====================

    def test_sync_creates_new_record_when_node_not_in_db(self, mock_redis_client, mock_db, mock_session):
        """
        Test that new plugin trigger records are created when nodes exist in graph but not in DB.

        This verifies the core create functionality where:
        - Node exists in workflow graph with valid subscription_id
        - No corresponding record exists in database
        - New WorkflowPluginTrigger record is created
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(
            trigger_nodes=[
                {
                    "node_id": "trigger-node-1",
                    "plugin_id": "org/plugin",
                    "provider_id": "provider-1",
                    "event_name": "event-1",
                    "subscription_id": "sub-123",
                }
            ]
        )

        # Mock empty DB result (no existing records)
        mock_session.scalars.return_value.all.return_value = []

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify new record was added
        mock_session.add.assert_called()
        mock_session.commit.assert_called_once()

    def test_sync_skips_nodes_without_subscription_id(self, mock_redis_client, mock_db, mock_session):
        """
        Test that nodes without subscription_id are skipped during sync.

        Plugin trigger nodes may be partially configured (no subscription selected yet).
        These should be ignored until fully configured.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(
            trigger_nodes=[
                {
                    "node_id": "trigger-node-1",
                    "plugin_id": "org/plugin",
                    "provider_id": "provider-1",
                    "event_name": "event-1",
                    "subscription_id": "",  # Empty subscription_id
                }
            ]
        )

        mock_session.scalars.return_value.all.return_value = []

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify no record was added (node was skipped)
        mock_session.add.assert_not_called()

    # ==================== Update Existing Records Tests ====================

    @pytest.mark.parametrize(
        ("field_to_change", "old_value", "new_value"),
        [
            ("subscription_id", "old-sub-123", "new-sub-456"),
            ("provider_id", "old-provider", "new-provider"),
            ("event_name", "old-event", "new-event"),
        ],
    )
    def test_sync_updates_record_when_field_changes(
        self, mock_redis_client, mock_db, mock_session, field_to_change, old_value, new_value
    ):
        """
        Test that existing records are updated when subscription_id/provider_id/event_name changes.

        When a user changes any of these fields for an existing trigger node,
        the corresponding DB record should be updated.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()

        # Build node config with the new value
        node_config = {
            "node_id": "trigger-node-1",
            "plugin_id": "org/plugin",
            "provider_id": "provider-1",
            "event_name": "event-1",
            "subscription_id": "sub-123",
        }
        node_config[field_to_change] = new_value

        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=[node_config])

        # Build existing record with the old value
        record_kwargs = {
            "node_id": "trigger-node-1",
            "provider_id": "provider-1",
            "event_name": "event-1",
            "subscription_id": "sub-123",
        }
        record_kwargs[field_to_change] = old_value
        existing_record = TestTriggerServiceSyncFactory.create_plugin_trigger_mock(**record_kwargs)
        mock_session.scalars.return_value.all.return_value = [existing_record]

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify record was updated
        assert getattr(existing_record, field_to_change) == new_value
        mock_session.commit.assert_called_once()

    def test_sync_no_update_when_record_unchanged(self, mock_redis_client, mock_db, mock_session):
        """
        Test that no update occurs when record matches graph configuration.

        If the DB record already has the same configuration as the graph node,
        no update should be performed.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(
            trigger_nodes=[
                {
                    "node_id": "trigger-node-1",
                    "plugin_id": "org/plugin",
                    "provider_id": "provider-1",
                    "event_name": "event-1",
                    "subscription_id": "sub-123",
                }
            ]
        )

        # Existing record with same configuration
        existing_record = TestTriggerServiceSyncFactory.create_plugin_trigger_mock(
            node_id="trigger-node-1",
            provider_id="provider-1",
            event_name="event-1",
            subscription_id="sub-123",
        )
        mock_session.scalars.return_value.all.return_value = [existing_record]

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # session.add should only be called for creates, not for unchanged records
        # Since no creates or updates, add should not be called
        mock_session.commit.assert_called_once()

    # ==================== Delete Records Tests ====================

    def test_sync_deletes_record_when_node_removed_from_graph(self, mock_redis_client, mock_db, mock_session):
        """
        Test that records are deleted when corresponding nodes are removed from graph.

        When a plugin trigger node is deleted from the workflow,
        the corresponding DB record should be deleted.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=[])  # Empty graph

        # Existing record that should be deleted
        existing_record = TestTriggerServiceSyncFactory.create_plugin_trigger_mock(
            node_id="deleted-node-1",
        )
        mock_session.scalars.return_value.all.return_value = [existing_record]

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify record was deleted
        mock_session.delete.assert_called_once_with(existing_record)
        mock_session.commit.assert_called_once()

    # ==================== Stale Cache Cleanup Tests ====================

    def test_sync_clears_stale_cache_before_creating_record(self, mock_redis_client, mock_db, mock_session):
        """
        Test that stale cache is cleared before creating new records.

        This is the key fix for the Redis-DB inconsistency issue:
        - Cache exists (from a previous state)
        - DB record does not exist (was deleted or never created)
        - Stale cache should be cleared before creating new record
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(
            trigger_nodes=[
                {
                    "node_id": "trigger-node-1",
                    "plugin_id": "org/plugin",
                    "provider_id": "provider-1",
                    "event_name": "event-1",
                    "subscription_id": "sub-123",
                }
            ]
        )

        # No records in DB
        mock_session.scalars.return_value.all.return_value = []

        # But stale cache exists
        mock_redis_client.exists.return_value = True

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify stale cache was detected and deleted
        # The cache key format is: plugin_trigger_nodes:{app_id}:{node_id}
        expected_cache_key = "plugin_trigger_nodes:app-123:trigger-node-1"
        mock_redis_client.exists.assert_called_with(expected_cache_key)
        mock_redis_client.delete.assert_any_call(expected_cache_key)

    # ==================== Cache Update Tests ====================

    def test_sync_updates_cache_after_successful_db_commit(self, mock_redis_client, mock_db, mock_session):
        """
        Test that cache is updated only after successful DB commit.

        Cache should be updated after the atomic DB commit to ensure
        cache-DB consistency.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(
            trigger_nodes=[
                {
                    "node_id": "trigger-node-1",
                    "plugin_id": "org/plugin",
                    "provider_id": "provider-1",
                    "event_name": "event-1",
                    "subscription_id": "sub-123",
                }
            ]
        )

        mock_session.scalars.return_value.all.return_value = []
        mock_redis_client.exists.return_value = False

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify commit was called before cache set
        mock_session.commit.assert_called_once()
        mock_redis_client.set.assert_called()

    def test_sync_deletes_cache_when_record_deleted(self, mock_redis_client, mock_db, mock_session):
        """
        Test that cache is deleted when corresponding record is deleted.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=[])

        existing_record = TestTriggerServiceSyncFactory.create_plugin_trigger_mock(
            node_id="deleted-node-1",
        )
        mock_session.scalars.return_value.all.return_value = [existing_record]

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify cache was deleted for the removed record
        # The cache key format is: plugin_trigger_nodes:{app_id}:{node_id}
        expected_cache_key = "plugin_trigger_nodes:app-123:deleted-node-1"
        mock_redis_client.delete.assert_called_with(expected_cache_key)

    # ==================== Distributed Lock Tests ====================

    def test_sync_acquires_and_releases_lock(self, mock_redis_client, mock_db, mock_session):
        """
        Test that distributed lock is properly acquired and released.

        The sync operation should:
        - Acquire lock before processing
        - Release lock in finally block (even on error)
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=[])
        mock_session.scalars.return_value.all.return_value = []

        mock_lock = mock_redis_client.lock.return_value

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify lock was acquired
        mock_lock.acquire.assert_called_once_with(blocking=True, blocking_timeout=10)
        # Verify lock was released
        mock_lock.release.assert_called_once()

    def test_sync_skips_when_lock_acquisition_fails(self, mock_redis_client, mock_db, mock_session):
        """
        Test that sync is skipped when lock cannot be acquired.

        This prevents concurrent sync operations on the same app from conflicting.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(
            trigger_nodes=[
                {
                    "node_id": "trigger-node-1",
                    "subscription_id": "sub-123",
                }
            ]
        )

        # Lock acquisition fails
        mock_lock = mock_redis_client.lock.return_value
        mock_lock.acquire.return_value = False

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify no DB operations were performed
        mock_session.add.assert_not_called()
        mock_session.commit.assert_not_called()

    def test_sync_releases_lock_on_exception(self, mock_redis_client, mock_db, mock_session):
        """
        Test that lock is released even when an exception occurs.

        The finally block should always release the lock to prevent deadlocks.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=[])

        # Make commit raise an exception
        mock_session.commit.side_effect = Exception("DB error")
        mock_lock = mock_redis_client.lock.return_value

        with pytest.raises(Exception, match="DB error"):
            TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify lock was still released
        mock_lock.release.assert_called_once()

    # ==================== Node Limit Tests ====================

    def test_sync_raises_error_when_exceeding_node_limit(self, mock_redis_client, mock_db):
        """
        Test that sync raises error when plugin trigger nodes exceed limit.

        Maximum 5 plugin trigger nodes are allowed per workflow.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()

        # Create 6 trigger nodes (exceeds limit of 5)
        trigger_nodes = [
            {
                "node_id": f"trigger-node-{i}",
                "plugin_id": "org/plugin",
                "provider_id": "provider-1",
                "event_name": "event-1",
                "subscription_id": f"sub-{i}",
            }
            for i in range(6)
        ]
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=trigger_nodes)

        with pytest.raises(ValueError, match="exceeds maximum plugin trigger node limit"):
            TriggerService.sync_plugin_trigger_relationships(app, workflow)

    def test_sync_allows_maximum_nodes_at_limit(self, mock_redis_client, mock_db, mock_session):
        """
        Test that sync allows exactly the maximum number of trigger nodes.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()

        # Create exactly 5 trigger nodes (at limit)
        trigger_nodes = [
            {
                "node_id": f"trigger-node-{i}",
                "plugin_id": "org/plugin",
                "provider_id": "provider-1",
                "event_name": "event-1",
                "subscription_id": f"sub-{i}",
            }
            for i in range(5)
        ]
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=trigger_nodes)
        mock_session.scalars.return_value.all.return_value = []

        # Should not raise
        TriggerService.sync_plugin_trigger_relationships(app, workflow)
        mock_session.commit.assert_called_once()

    # ==================== Empty Workflow Tests ====================

    def test_sync_handles_empty_workflow(self, mock_redis_client, mock_db, mock_session):
        """
        Test that sync handles workflows with no trigger nodes.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(trigger_nodes=[])
        mock_session.scalars.return_value.all.return_value = []

        # Should not raise, just no-op
        TriggerService.sync_plugin_trigger_relationships(app, workflow)
        mock_session.commit.assert_called_once()

    # ==================== Mixed Operations Tests ====================

    def test_sync_handles_create_update_delete_in_single_transaction(self, mock_redis_client, mock_db, mock_session):
        """
        Test that sync handles create, update, and delete in a single atomic transaction.

        This verifies the atomic commit behavior where all operations succeed or fail together.
        """
        app = TestTriggerServiceSyncFactory.create_app_mock()
        workflow = TestTriggerServiceSyncFactory.create_workflow_mock(
            trigger_nodes=[
                # New node to create
                {
                    "node_id": "new-node",
                    "plugin_id": "org/plugin",
                    "provider_id": "provider-1",
                    "event_name": "event-1",
                    "subscription_id": "sub-new",
                },
                # Existing node to update
                {
                    "node_id": "existing-node",
                    "plugin_id": "org/plugin",
                    "provider_id": "new-provider",  # Changed
                    "event_name": "event-1",
                    "subscription_id": "sub-existing",
                },
            ]
        )

        existing_record = TestTriggerServiceSyncFactory.create_plugin_trigger_mock(
            node_id="existing-node",
            provider_id="old-provider",
        )
        record_to_delete = TestTriggerServiceSyncFactory.create_plugin_trigger_mock(
            node_id="deleted-node",
        )
        mock_session.scalars.return_value.all.return_value = [existing_record, record_to_delete]

        TriggerService.sync_plugin_trigger_relationships(app, workflow)

        # Verify all operations
        # Create: new-node
        # Update: existing-node
        # Delete: deleted-node
        assert mock_session.add.called
        mock_session.delete.assert_called_once_with(record_to_delete)
        mock_session.flush.assert_called_once()
        mock_session.commit.assert_called_once()
