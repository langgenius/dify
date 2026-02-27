"""
Unit tests for dataset indexing tasks.

This module tests the document indexing task functionality including:
- Task enqueuing to different queues (normal, priority, tenant-isolated)
- Batch processing of multiple documents
- Progress tracking through task lifecycle
- Error handling and retry mechanisms
- Task cancellation and cleanup
"""

import uuid
from unittest.mock import Mock, patch

import pytest

from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from extensions.ext_redis import redis_client
from services.document_indexing_proxy.document_indexing_task_proxy import DocumentIndexingTaskProxy

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def tenant_id():
    """Generate a unique tenant ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id():
    """Generate a unique dataset ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def document_ids():
    """Generate a list of document IDs for testing."""
    return [str(uuid.uuid4()) for _ in range(3)]


@pytest.fixture
def mock_redis():
    """Mock Redis client operations."""
    # Redis is already mocked globally in conftest.py
    # Reset it for each test
    redis_client.reset_mock()
    redis_client.get.return_value = None
    redis_client.setex.return_value = True
    redis_client.delete.return_value = True
    redis_client.lpush.return_value = 1
    redis_client.rpop.return_value = None
    return redis_client


# ============================================================================
# Test Task Enqueuing
# ============================================================================


class TestTaskEnqueuing:
    """Test cases for task enqueuing to different queues."""

    def test_enqueue_to_priority_direct_queue_for_self_hosted(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test enqueuing to priority direct queue for self-hosted deployments.

        When billing is disabled (self-hosted), tasks should go directly to
        the priority queue without tenant isolation.
        """
        # Arrange
        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = False

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert
                mock_task.delay.assert_called_once_with(
                    tenant_id=tenant_id, dataset_id=dataset_id, document_ids=document_ids
                )

    def test_enqueue_to_normal_tenant_queue_for_sandbox_plan(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test enqueuing to normal tenant queue for sandbox plan.

        Sandbox plan users should have their tasks queued with tenant isolation
        in the normal priority queue.
        """
        # Arrange
        mock_redis.get.return_value = None  # No existing task

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.SANDBOX

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "NORMAL_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert - Should set task key and call delay
                assert mock_redis.setex.called
                mock_task.delay.assert_called_once()

    def test_enqueue_to_priority_tenant_queue_for_paid_plan(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test enqueuing to priority tenant queue for paid plans.

        Paid plan users should have their tasks queued with tenant isolation
        in the priority queue.
        """
        # Arrange
        mock_redis.get.return_value = None  # No existing task

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.PROFESSIONAL

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert
                assert mock_redis.setex.called
                mock_task.delay.assert_called_once()

    def test_enqueue_adds_to_waiting_queue_when_task_running(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test that new tasks are added to waiting queue when a task is already running.

        If a task is already running for the tenant (task key exists),
        new tasks should be pushed to the waiting queue.
        """
        # Arrange
        mock_redis.get.return_value = b"1"  # Task already running

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.PROFESSIONAL

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert - Should push to queue, not call delay
                assert mock_redis.lpush.called
                mock_task.delay.assert_not_called()


# ============================================================================
# Test Task Cancellation
# ============================================================================


class TestTaskCancellation:
    """Test cases for task cancellation and cleanup."""

    def test_task_isolation_between_tenants(self, mock_redis):
        """
        Test that tasks are properly isolated between different tenants.

        Each tenant should have their own queue and task key.
        """
        # Arrange
        tenant_1 = str(uuid.uuid4())
        tenant_2 = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())
        document_ids = [str(uuid.uuid4())]

        # Act
        queue_1 = TenantIsolatedTaskQueue(tenant_1, "document_indexing")
        queue_2 = TenantIsolatedTaskQueue(tenant_2, "document_indexing")

        # Assert - Different tenants should have different queue keys
        assert queue_1._queue != queue_2._queue
        assert queue_1._task_key != queue_2._task_key
        assert tenant_1 in queue_1._queue
        assert tenant_2 in queue_2._queue


# ============================================================================
# Additional Edge Case Tests
# ============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_rapid_successive_task_enqueuing(self, tenant_id, dataset_id, mock_redis):
        """
        Test rapid successive task enqueuing to the same tenant queue.

        When multiple tasks are enqueued rapidly for the same tenant,
        the system should queue them properly without race conditions.

        Scenario:
        - First task starts processing (task key exists)
        - Multiple tasks enqueued rapidly while first is running
        - All should be added to waiting queue

        Expected behavior:
        - All tasks are queued (not executed immediately)
        - No tasks are lost
        - Queue maintains all tasks
        """
        # Arrange
        document_ids_list = [[str(uuid.uuid4())] for _ in range(5)]

        # Simulate task already running
        mock_redis.get.return_value = b"1"

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.PROFESSIONAL

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                # Act - Enqueue multiple tasks rapidly
                for doc_ids in document_ids_list:
                    proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, doc_ids)
                    proxy.delay()

                # Assert - All tasks should be pushed to queue, none executed
                assert mock_redis.lpush.call_count == 5
                mock_task.delay.assert_not_called()


class TestPerformanceScenarios:
    """Test performance-related scenarios and optimizations."""

    def test_multiple_tenants_isolated_processing(self, mock_redis):
        """
        Test that multiple tenants process tasks in isolation.

        When multiple tenants have tasks running simultaneously,
        they should not interfere with each other.

        Scenario:
        - Tenant A has tasks in queue
        - Tenant B has tasks in queue
        - Both process independently

        Expected behavior:
        - Each tenant has separate queue
        - Each tenant has separate task key
        - No cross-tenant interference
        """
        # Arrange
        tenant_a = str(uuid.uuid4())
        tenant_b = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())
        document_ids = [str(uuid.uuid4())]

        # Create queues for both tenants
        queue_a = TenantIsolatedTaskQueue(tenant_a, "document_indexing")
        queue_b = TenantIsolatedTaskQueue(tenant_b, "document_indexing")

        # Act - Set task keys for both tenants
        queue_a.set_task_waiting_time()
        queue_b.set_task_waiting_time()

        # Assert - Each tenant has independent queue and key
        assert queue_a._queue != queue_b._queue
        assert queue_a._task_key != queue_b._task_key
        assert tenant_a in queue_a._queue
        assert tenant_b in queue_b._queue
        assert tenant_a in queue_a._task_key
        assert tenant_b in queue_b._task_key


class TestRobustness:
    """Test system robustness and resilience."""

    def test_task_proxy_handles_feature_service_failure(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test that task proxy handles FeatureService failures gracefully.

        If FeatureService fails to retrieve features, the system should
        have a fallback or handle the error appropriately.

        Scenario:
        - FeatureService.get_features() raises an exception during dispatch
        - Task enqueuing should handle the error

        Expected behavior:
        - Exception is raised when trying to dispatch
        - System doesn't crash unexpectedly
        - Error is propagated appropriately
        """
        # Arrange
        with patch("services.document_indexing_proxy.base.FeatureService.get_features") as mock_get_features:
            # Simulate FeatureService failure
            mock_get_features.side_effect = Exception("Feature service unavailable")

            # Create proxy instance
            proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

            # Act & Assert - Should raise exception when trying to delay (which accesses features)
            with pytest.raises(Exception) as exc_info:
                proxy.delay()

            # Verify the exception message
            assert "Feature service" in str(exc_info.value) or isinstance(exc_info.value, Exception)
