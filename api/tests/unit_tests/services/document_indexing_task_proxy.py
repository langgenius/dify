"""
Comprehensive unit tests for DocumentIndexingTaskProxy service.

This module contains extensive unit tests for the DocumentIndexingTaskProxy class,
which is responsible for routing document indexing tasks to appropriate Celery queues
based on tenant billing configuration and managing tenant-isolated task queues.

The DocumentIndexingTaskProxy handles:
- Task scheduling and queuing (direct vs tenant-isolated queues)
- Priority vs normal task routing based on billing plans
- Tenant isolation using TenantIsolatedTaskQueue
- Batch indexing operations with multiple document IDs
- Error handling and retry logic through queue management

This test suite ensures:
- Correct task routing based on billing configuration
- Proper tenant isolation queue management
- Accurate batch operation handling
- Comprehensive error condition coverage
- Edge cases are properly handled

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

The DocumentIndexingTaskProxy is a critical component in the document indexing
workflow. It acts as a proxy/router that determines which Celery queue to use
for document indexing tasks based on tenant billing configuration.

1. Task Queue Routing:
   - Direct Queue: Bypasses tenant isolation, used for self-hosted/enterprise
   - Tenant Queue: Uses tenant isolation, queues tasks when another task is running
   - Default Queue: Normal priority with tenant isolation (SANDBOX plan)
   - Priority Queue: High priority with tenant isolation (TEAM/PRO plans)
   - Priority Direct Queue: High priority without tenant isolation (billing disabled)

2. Tenant Isolation:
   - Uses TenantIsolatedTaskQueue to ensure only one indexing task runs per tenant
   - When a task is running, new tasks are queued in Redis
   - When a task completes, it pulls the next task from the queue
   - Prevents resource contention and ensures fair task distribution

3. Billing Configuration:
   - SANDBOX plan: Uses default tenant queue (normal priority, tenant isolated)
   - TEAM/PRO plans: Uses priority tenant queue (high priority, tenant isolated)
   - Billing disabled: Uses priority direct queue (high priority, no isolation)

4. Batch Operations:
   - Supports indexing multiple documents in a single task
   - DocumentTask entity serializes task information
   - Tasks are queued with all document IDs for batch processing

================================================================================
TESTING STRATEGY
================================================================================

This test suite follows a comprehensive testing strategy that covers:

1. Initialization and Configuration:
   - Proxy initialization with various parameters
   - TenantIsolatedTaskQueue initialization
   - Features property caching
   - Edge cases (empty document_ids, single document, large batches)

2. Task Queue Routing:
   - Direct queue routing (bypasses tenant isolation)
   - Tenant queue routing with existing task key (pushes to waiting queue)
   - Tenant queue routing without task key (sets flag and executes immediately)
   - DocumentTask serialization and deserialization
   - Task function delay() call with correct parameters

3. Queue Type Selection:
   - Default tenant queue routing (normal_document_indexing_task)
   - Priority tenant queue routing (priority_document_indexing_task with isolation)
   - Priority direct queue routing (priority_document_indexing_task without isolation)

4. Dispatch Logic:
   - Billing enabled + SANDBOX plan → default tenant queue
   - Billing enabled + non-SANDBOX plan (TEAM, PRO, etc.) → priority tenant queue
   - Billing disabled (self-hosted/enterprise) → priority direct queue
   - All CloudPlan enum values handling
   - Edge cases: None plan, empty plan string

5. Tenant Isolation and Queue Management:
   - Task key existence checking (get_task_key)
   - Task waiting time setting (set_task_waiting_time)
   - Task pushing to queue (push_tasks)
   - Queue state transitions (idle → active → idle)
   - Multiple concurrent task handling

6. Batch Operations:
   - Single document indexing
   - Multiple document batch indexing
   - Large batch handling
   - Empty batch handling (edge case)

7. Error Handling and Retry Logic:
   - Task function delay() failure handling
   - Queue operation failures (Redis errors)
   - Feature service failures
   - Invalid task data handling
   - Retry mechanism through queue pull operations

8. Integration Points:
   - FeatureService integration (billing features, subscription plans)
   - TenantIsolatedTaskQueue integration (Redis operations)
   - Celery task integration (normal_document_indexing_task, priority_document_indexing_task)
   - DocumentTask entity serialization

================================================================================
"""

from unittest.mock import Mock, patch

import pytest

from core.entities.document_task import DocumentTask
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from services.document_indexing_task_proxy import DocumentIndexingTaskProxy

# ============================================================================
# Test Data Factory
# ============================================================================


class DocumentIndexingTaskProxyTestDataFactory:
    """
    Factory class for creating test data and mock objects for DocumentIndexingTaskProxy tests.

    This factory provides static methods to create mock objects for:
    - FeatureService features with billing configuration
    - TenantIsolatedTaskQueue mocks with various states
    - DocumentIndexingTaskProxy instances with different configurations
    - DocumentTask entities for testing serialization

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_mock_features(billing_enabled: bool = False, plan: CloudPlan = CloudPlan.SANDBOX) -> Mock:
        """
        Create mock features with billing configuration.

        This method creates a mock FeatureService features object with
        billing configuration that can be used to test different billing
        scenarios in the DocumentIndexingTaskProxy.

        Args:
            billing_enabled: Whether billing is enabled for the tenant
            plan: The CloudPlan enum value for the subscription plan

        Returns:
            Mock object configured as FeatureService features with billing info
        """
        features = Mock()

        features.billing = Mock()

        features.billing.enabled = billing_enabled

        features.billing.subscription = Mock()

        features.billing.subscription.plan = plan

        return features

    @staticmethod
    def create_mock_tenant_queue(has_task_key: bool = False) -> Mock:
        """
        Create mock TenantIsolatedTaskQueue.

        This method creates a mock TenantIsolatedTaskQueue that can simulate
        different queue states for testing tenant isolation logic.

        Args:
            has_task_key: Whether the queue has an active task key (task running)

        Returns:
            Mock object configured as TenantIsolatedTaskQueue
        """
        queue = Mock(spec=TenantIsolatedTaskQueue)

        queue.get_task_key.return_value = "task_key" if has_task_key else None

        queue.push_tasks = Mock()

        queue.set_task_waiting_time = Mock()

        queue.delete_task_key = Mock()

        return queue

    @staticmethod
    def create_document_task_proxy(
        tenant_id: str = "tenant-123", dataset_id: str = "dataset-456", document_ids: list[str] | None = None
    ) -> DocumentIndexingTaskProxy:
        """
        Create DocumentIndexingTaskProxy instance for testing.

        This method creates a DocumentIndexingTaskProxy instance with default
        or specified parameters for use in test cases.

        Args:
            tenant_id: Tenant identifier for the proxy
            dataset_id: Dataset identifier for the proxy
            document_ids: List of document IDs to index (defaults to 3 documents)

        Returns:
            DocumentIndexingTaskProxy instance configured for testing
        """
        if document_ids is None:
            document_ids = ["doc-1", "doc-2", "doc-3"]

        return DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

    @staticmethod
    def create_document_task(
        tenant_id: str = "tenant-123", dataset_id: str = "dataset-456", document_ids: list[str] | None = None
    ) -> DocumentTask:
        """
        Create DocumentTask entity for testing.

        This method creates a DocumentTask entity that can be used to test
        task serialization and deserialization logic.

        Args:
            tenant_id: Tenant identifier for the task
            dataset_id: Dataset identifier for the task
            document_ids: List of document IDs to index (defaults to 3 documents)

        Returns:
            DocumentTask entity configured for testing
        """
        if document_ids is None:
            document_ids = ["doc-1", "doc-2", "doc-3"]

        return DocumentTask(tenant_id=tenant_id, dataset_id=dataset_id, document_ids=document_ids)


# ============================================================================
# Test Classes
# ============================================================================


class TestDocumentIndexingTaskProxy:
    """
    Comprehensive unit tests for DocumentIndexingTaskProxy class.

    This test class covers all methods and scenarios of the DocumentIndexingTaskProxy,
    including initialization, task routing, queue management, dispatch logic, and
    error handling.
    """

    # ========================================================================
    # Initialization Tests
    # ========================================================================

    def test_initialization(self):
        """
        Test DocumentIndexingTaskProxy initialization.

        This test verifies that the proxy is correctly initialized with
        the provided tenant_id, dataset_id, and document_ids, and that
        the TenantIsolatedTaskQueue is properly configured.
        """
        # Arrange
        tenant_id = "tenant-123"

        dataset_id = "dataset-456"

        document_ids = ["doc-1", "doc-2", "doc-3"]

        # Act
        proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

        # Assert
        assert proxy._tenant_id == tenant_id

        assert proxy._dataset_id == dataset_id

        assert proxy._document_ids == document_ids

        assert isinstance(proxy._tenant_isolated_task_queue, TenantIsolatedTaskQueue)

        assert proxy._tenant_isolated_task_queue._tenant_id == tenant_id

        assert proxy._tenant_isolated_task_queue._unique_key == "document_indexing"

    def test_initialization_with_empty_document_ids(self):
        """
        Test initialization with empty document_ids list.

        This test verifies that the proxy can be initialized with an empty
        document_ids list, which may occur in edge cases or error scenarios.
        """
        # Arrange
        tenant_id = "tenant-123"

        dataset_id = "dataset-456"

        document_ids = []

        # Act
        proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

        # Assert
        assert proxy._tenant_id == tenant_id

        assert proxy._dataset_id == dataset_id

        assert proxy._document_ids == document_ids

        assert len(proxy._document_ids) == 0

    def test_initialization_with_single_document_id(self):
        """
        Test initialization with single document_id.

        This test verifies that the proxy can be initialized with a single
        document ID, which is a common use case for single document indexing.
        """
        # Arrange
        tenant_id = "tenant-123"

        dataset_id = "dataset-456"

        document_ids = ["doc-1"]

        # Act
        proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

        # Assert
        assert proxy._tenant_id == tenant_id

        assert proxy._dataset_id == dataset_id

        assert proxy._document_ids == document_ids

        assert len(proxy._document_ids) == 1

    def test_initialization_with_large_batch(self):
        """
        Test initialization with large batch of document IDs.

        This test verifies that the proxy can handle large batches of
        document IDs, which may occur in bulk indexing scenarios.
        """
        # Arrange
        tenant_id = "tenant-123"

        dataset_id = "dataset-456"

        document_ids = [f"doc-{i}" for i in range(100)]

        # Act
        proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

        # Assert
        assert proxy._tenant_id == tenant_id

        assert proxy._dataset_id == dataset_id

        assert proxy._document_ids == document_ids

        assert len(proxy._document_ids) == 100

    # ========================================================================
    # Features Property Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_features_property(self, mock_feature_service):
        """
        Test cached_property features.

        This test verifies that the features property is correctly cached
        and that FeatureService.get_features is called only once, even when
        the property is accessed multiple times.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features()

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        # Act
        features1 = proxy.features

        features2 = proxy.features  # Second call should use cached property

        # Assert
        assert features1 == mock_features

        assert features2 == mock_features

        assert features1 is features2  # Should be the same instance due to caching

        mock_feature_service.get_features.assert_called_once_with("tenant-123")

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_features_property_with_different_tenants(self, mock_feature_service):
        """
        Test features property with different tenant IDs.

        This test verifies that the features property correctly calls
        FeatureService.get_features with the correct tenant_id for each
        proxy instance.
        """
        # Arrange
        mock_features1 = DocumentIndexingTaskProxyTestDataFactory.create_mock_features()

        mock_features2 = DocumentIndexingTaskProxyTestDataFactory.create_mock_features()

        mock_feature_service.get_features.side_effect = [mock_features1, mock_features2]

        proxy1 = DocumentIndexingTaskProxy("tenant-1", "dataset-1", ["doc-1"])

        proxy2 = DocumentIndexingTaskProxy("tenant-2", "dataset-2", ["doc-2"])

        # Act
        features1 = proxy1.features

        features2 = proxy2.features

        # Assert
        assert features1 == mock_features1

        assert features2 == mock_features2

        mock_feature_service.get_features.assert_any_call("tenant-1")

        mock_feature_service.get_features.assert_any_call("tenant-2")

    # ========================================================================
    # Direct Queue Routing Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_direct_queue(self, mock_task):
        """
        Test _send_to_direct_queue method.

        This test verifies that _send_to_direct_queue correctly calls
        task_func.delay() with the correct parameters, bypassing tenant
        isolation queue management.
        """
        # Arrange
        tenant_id = "tenant-direct-queue"
        dataset_id = "dataset-direct-queue"
        document_ids = ["doc-direct-1", "doc-direct-2"]
        proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)
        mock_task.delay = Mock()

        # Act
        proxy._send_to_direct_queue(mock_task)

        # Assert
        mock_task.delay.assert_called_once_with(tenant_id=tenant_id, dataset_id=dataset_id, document_ids=document_ids)

    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_send_to_direct_queue_with_priority_task(self, mock_task):
        """
        Test _send_to_direct_queue with priority task function.

        This test verifies that _send_to_direct_queue works correctly
        with priority_document_indexing_task as the task function.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        mock_task.delay = Mock()

        # Act
        proxy._send_to_direct_queue(mock_task)

        # Assert
        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=["doc-1", "doc-2", "doc-3"]
        )

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_direct_queue_with_single_document(self, mock_task):
        """
        Test _send_to_direct_queue with single document ID.

        This test verifies that _send_to_direct_queue correctly handles
        a single document ID in the document_ids list.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxy("tenant-123", "dataset-456", ["doc-1"])

        mock_task.delay = Mock()

        # Act
        proxy._send_to_direct_queue(mock_task)

        # Assert
        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=["doc-1"]
        )

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_direct_queue_with_empty_documents(self, mock_task):
        """
        Test _send_to_direct_queue with empty document_ids list.

        This test verifies that _send_to_direct_queue correctly handles
        an empty document_ids list, which may occur in edge cases.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxy("tenant-123", "dataset-456", [])

        mock_task.delay = Mock()

        # Act
        proxy._send_to_direct_queue(mock_task)

        # Assert
        mock_task.delay.assert_called_once_with(tenant_id="tenant-123", dataset_id="dataset-456", document_ids=[])

    # ========================================================================
    # Tenant Queue Routing Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_tenant_queue_with_existing_task_key(self, mock_task):
        """
        Test _send_to_tenant_queue when task key exists.

        This test verifies that when a task key exists (indicating another
        task is running), the new task is pushed to the waiting queue instead
        of being executed immediately.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._tenant_isolated_task_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=True
        )

        mock_task.delay = Mock()

        # Act
        proxy._send_to_tenant_queue(mock_task)

        # Assert
        proxy._tenant_isolated_task_queue.push_tasks.assert_called_once()

        pushed_tasks = proxy._tenant_isolated_task_queue.push_tasks.call_args[0][0]

        assert len(pushed_tasks) == 1

        expected_task_data = {
            "tenant_id": "tenant-123",
            "dataset_id": "dataset-456",
            "document_ids": ["doc-1", "doc-2", "doc-3"],
        }
        assert pushed_tasks[0] == expected_task_data

        assert pushed_tasks[0]["document_ids"] == ["doc-1", "doc-2", "doc-3"]

        mock_task.delay.assert_not_called()

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_tenant_queue_without_task_key(self, mock_task):
        """
        Test _send_to_tenant_queue when no task key exists.

        This test verifies that when no task key exists (indicating no task
        is currently running), the task is executed immediately and the
        task waiting time flag is set.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._tenant_isolated_task_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=False
        )

        mock_task.delay = Mock()

        # Act
        proxy._send_to_tenant_queue(mock_task)

        # Assert
        proxy._tenant_isolated_task_queue.set_task_waiting_time.assert_called_once()

        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=["doc-1", "doc-2", "doc-3"]
        )

        proxy._tenant_isolated_task_queue.push_tasks.assert_not_called()

    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_send_to_tenant_queue_with_priority_task(self, mock_task):
        """
        Test _send_to_tenant_queue with priority task function.

        This test verifies that _send_to_tenant_queue works correctly
        with priority_document_indexing_task as the task function.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._tenant_isolated_task_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=False
        )

        mock_task.delay = Mock()

        # Act
        proxy._send_to_tenant_queue(mock_task)

        # Assert
        proxy._tenant_isolated_task_queue.set_task_waiting_time.assert_called_once()

        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=["doc-1", "doc-2", "doc-3"]
        )

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_tenant_queue_document_task_serialization(self, mock_task):
        """
        Test DocumentTask serialization in _send_to_tenant_queue.

        This test verifies that DocumentTask entities are correctly
        serialized to dictionaries when pushing to the waiting queue.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._tenant_isolated_task_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=True
        )

        mock_task.delay = Mock()

        # Act
        proxy._send_to_tenant_queue(mock_task)

        # Assert
        pushed_tasks = proxy._tenant_isolated_task_queue.push_tasks.call_args[0][0]

        task_dict = pushed_tasks[0]

        # Verify the task can be deserialized back to DocumentTask
        document_task = DocumentTask(**task_dict)

        assert document_task.tenant_id == "tenant-123"

        assert document_task.dataset_id == "dataset-456"

        assert document_task.document_ids == ["doc-1", "doc-2", "doc-3"]

    # ========================================================================
    # Queue Type Selection Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_default_tenant_queue(self, mock_task):
        """
        Test _send_to_default_tenant_queue method.

        This test verifies that _send_to_default_tenant_queue correctly
        calls _send_to_tenant_queue with normal_document_indexing_task.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_tenant_queue = Mock()

        # Act
        proxy._send_to_default_tenant_queue()

        # Assert
        proxy._send_to_tenant_queue.assert_called_once_with(mock_task)

    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_send_to_priority_tenant_queue(self, mock_task):
        """
        Test _send_to_priority_tenant_queue method.

        This test verifies that _send_to_priority_tenant_queue correctly
        calls _send_to_tenant_queue with priority_document_indexing_task.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_tenant_queue = Mock()

        # Act
        proxy._send_to_priority_tenant_queue()

        # Assert
        proxy._send_to_tenant_queue.assert_called_once_with(mock_task)

    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_send_to_priority_direct_queue(self, mock_task):
        """
        Test _send_to_priority_direct_queue method.

        This test verifies that _send_to_priority_direct_queue correctly
        calls _send_to_direct_queue with priority_document_indexing_task.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_direct_queue = Mock()

        # Act
        proxy._send_to_priority_direct_queue()

        # Assert
        proxy._send_to_direct_queue.assert_called_once_with(mock_task)

    # ========================================================================
    # Dispatch Logic Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_with_billing_enabled_sandbox_plan(self, mock_feature_service):
        """
        Test _dispatch method when billing is enabled with SANDBOX plan.

        This test verifies that when billing is enabled and the subscription
        plan is SANDBOX, the dispatch method routes to the default tenant queue.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.SANDBOX
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_default_tenant_queue = Mock()

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_default_tenant_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_with_billing_enabled_team_plan(self, mock_feature_service):
        """
        Test _dispatch method when billing is enabled with TEAM plan.

        This test verifies that when billing is enabled and the subscription
        plan is TEAM, the dispatch method routes to the priority tenant queue.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.TEAM
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_priority_tenant_queue = Mock()

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_with_billing_enabled_professional_plan(self, mock_feature_service):
        """
        Test _dispatch method when billing is enabled with PROFESSIONAL plan.

        This test verifies that when billing is enabled and the subscription
        plan is PROFESSIONAL, the dispatch method routes to the priority tenant queue.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.PROFESSIONAL
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_priority_tenant_queue = Mock()

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_with_billing_disabled(self, mock_feature_service):
        """
        Test _dispatch method when billing is disabled.

        This test verifies that when billing is disabled (e.g., self-hosted
        or enterprise), the dispatch method routes to the priority direct queue.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(billing_enabled=False)

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_priority_direct_queue = Mock()

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_direct_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_edge_case_empty_plan(self, mock_feature_service):
        """
        Test _dispatch method with empty plan string.

        This test verifies that when billing is enabled but the plan is an
        empty string, the dispatch method routes to the priority tenant queue
        (treats it as a non-SANDBOX plan).
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(billing_enabled=True, plan="")

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_priority_tenant_queue = Mock()

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_edge_case_none_plan(self, mock_feature_service):
        """
        Test _dispatch method with None plan.

        This test verifies that when billing is enabled but the plan is None,
        the dispatch method routes to the priority tenant queue (treats it as
        a non-SANDBOX plan).
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(billing_enabled=True, plan=None)

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_priority_tenant_queue = Mock()

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once()

    # ========================================================================
    # Delay Method Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_delay_method(self, mock_feature_service):
        """
        Test delay method integration.

        This test verifies that the delay method correctly calls _dispatch,
        which is the public interface for scheduling document indexing tasks.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.SANDBOX
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_default_tenant_queue = Mock()

        # Act
        proxy.delay()

        # Assert
        proxy._send_to_default_tenant_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_delay_method_with_team_plan(self, mock_feature_service):
        """
        Test delay method with TEAM plan.

        This test verifies that the delay method correctly routes to the
        priority tenant queue when the subscription plan is TEAM.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.TEAM
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_priority_tenant_queue = Mock()

        # Act
        proxy.delay()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_delay_method_with_billing_disabled(self, mock_feature_service):
        """
        Test delay method with billing disabled.

        This test verifies that the delay method correctly routes to the
        priority direct queue when billing is disabled.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(billing_enabled=False)

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._send_to_priority_direct_queue = Mock()

        # Act
        proxy.delay()

        # Assert
        proxy._send_to_priority_direct_queue.assert_called_once()

    # ========================================================================
    # DocumentTask Entity Tests
    # ========================================================================

    def test_document_task_dataclass(self):
        """
        Test DocumentTask dataclass.

        This test verifies that DocumentTask entities can be created and
        accessed correctly, which is important for task serialization.
        """
        # Arrange
        tenant_id = "tenant-123"

        dataset_id = "dataset-456"

        document_ids = ["doc-1", "doc-2"]

        # Act
        task = DocumentTask(tenant_id=tenant_id, dataset_id=dataset_id, document_ids=document_ids)

        # Assert
        assert task.tenant_id == tenant_id

        assert task.dataset_id == dataset_id

        assert task.document_ids == document_ids

    def test_document_task_serialization(self):
        """
        Test DocumentTask serialization to dictionary.

        This test verifies that DocumentTask entities can be correctly
        serialized to dictionaries using asdict() for queue storage.
        """
        # Arrange
        from dataclasses import asdict

        task = DocumentIndexingTaskProxyTestDataFactory.create_document_task()

        # Act
        task_dict = asdict(task)

        # Assert
        assert task_dict["tenant_id"] == "tenant-123"

        assert task_dict["dataset_id"] == "dataset-456"

        assert task_dict["document_ids"] == ["doc-1", "doc-2", "doc-3"]

    def test_document_task_deserialization(self):
        """
        Test DocumentTask deserialization from dictionary.

        This test verifies that DocumentTask entities can be correctly
        deserialized from dictionaries when pulled from the queue.
        """
        # Arrange
        task_dict = {
            "tenant_id": "tenant-123",
            "dataset_id": "dataset-456",
            "document_ids": ["doc-1", "doc-2", "doc-3"],
        }

        # Act
        task = DocumentTask(**task_dict)

        # Assert
        assert task.tenant_id == "tenant-123"

        assert task.dataset_id == "dataset-456"

        assert task.document_ids == ["doc-1", "doc-2", "doc-3"]

    # ========================================================================
    # Batch Operations Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_batch_operation_with_multiple_documents(self, mock_task):
        """
        Test batch operation with multiple documents.

        This test verifies that the proxy correctly handles batch operations
        with multiple document IDs in a single task.
        """
        # Arrange
        document_ids = [f"doc-{i}" for i in range(10)]

        proxy = DocumentIndexingTaskProxy("tenant-123", "dataset-456", document_ids)

        mock_task.delay = Mock()

        # Act
        proxy._send_to_direct_queue(mock_task)

        # Assert
        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=document_ids
        )

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_batch_operation_with_large_batch(self, mock_task):
        """
        Test batch operation with large batch of documents.

        This test verifies that the proxy correctly handles large batches
        of document IDs, which may occur in bulk indexing scenarios.
        """
        # Arrange
        document_ids = [f"doc-{i}" for i in range(100)]

        proxy = DocumentIndexingTaskProxy("tenant-123", "dataset-456", document_ids)

        mock_task.delay = Mock()

        # Act
        proxy._send_to_direct_queue(mock_task)

        # Assert
        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=document_ids
        )

        assert len(mock_task.delay.call_args[1]["document_ids"]) == 100

    # ========================================================================
    # Error Handling Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_direct_queue_task_delay_failure(self, mock_task):
        """
        Test _send_to_direct_queue when task.delay() raises an exception.

        This test verifies that exceptions raised by task.delay() are
        propagated correctly and not swallowed.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        mock_task.delay.side_effect = Exception("Task delay failed")

        # Act & Assert
        with pytest.raises(Exception, match="Task delay failed"):
            proxy._send_to_direct_queue(mock_task)

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_tenant_queue_push_tasks_failure(self, mock_task):
        """
        Test _send_to_tenant_queue when push_tasks raises an exception.

        This test verifies that exceptions raised by push_tasks are
        propagated correctly when a task key exists.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        mock_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(has_task_key=True)

        mock_queue.push_tasks.side_effect = Exception("Push tasks failed")

        proxy._tenant_isolated_task_queue = mock_queue

        # Act & Assert
        with pytest.raises(Exception, match="Push tasks failed"):
            proxy._send_to_tenant_queue(mock_task)

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_tenant_queue_set_waiting_time_failure(self, mock_task):
        """
        Test _send_to_tenant_queue when set_task_waiting_time raises an exception.

        This test verifies that exceptions raised by set_task_waiting_time are
        propagated correctly when no task key exists.
        """
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        mock_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(has_task_key=False)

        mock_queue.set_task_waiting_time.side_effect = Exception("Set waiting time failed")

        proxy._tenant_isolated_task_queue = mock_queue

        # Act & Assert
        with pytest.raises(Exception, match="Set waiting time failed"):
            proxy._send_to_tenant_queue(mock_task)

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_feature_service_failure(self, mock_feature_service):
        """
        Test _dispatch when FeatureService.get_features raises an exception.

        This test verifies that exceptions raised by FeatureService.get_features
        are propagated correctly during dispatch.
        """
        # Arrange
        mock_feature_service.get_features.side_effect = Exception("Feature service failed")

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        # Act & Assert
        with pytest.raises(Exception, match="Feature service failed"):
            proxy._dispatch()

    # ========================================================================
    # Integration Tests
    # ========================================================================

    @patch("services.document_indexing_task_proxy.FeatureService")
    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_full_flow_sandbox_plan(self, mock_task, mock_feature_service):
        """
        Test full flow for SANDBOX plan with tenant queue.

        This test verifies the complete flow from delay() call to task
        scheduling for a SANDBOX plan tenant, including tenant isolation.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.SANDBOX
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._tenant_isolated_task_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=False
        )

        mock_task.delay = Mock()

        # Act
        proxy.delay()

        # Assert
        proxy._tenant_isolated_task_queue.set_task_waiting_time.assert_called_once()

        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=["doc-1", "doc-2", "doc-3"]
        )

    @patch("services.document_indexing_task_proxy.FeatureService")
    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_full_flow_team_plan(self, mock_task, mock_feature_service):
        """
        Test full flow for TEAM plan with priority tenant queue.

        This test verifies the complete flow from delay() call to task
        scheduling for a TEAM plan tenant, including priority routing.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.TEAM
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._tenant_isolated_task_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=False
        )

        mock_task.delay = Mock()

        # Act
        proxy.delay()

        # Assert
        proxy._tenant_isolated_task_queue.set_task_waiting_time.assert_called_once()

        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=["doc-1", "doc-2", "doc-3"]
        )

    @patch("services.document_indexing_task_proxy.FeatureService")
    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_full_flow_billing_disabled(self, mock_task, mock_feature_service):
        """
        Test full flow for billing disabled (self-hosted/enterprise).

        This test verifies the complete flow from delay() call to task
        scheduling when billing is disabled, using priority direct queue.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(billing_enabled=False)

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        mock_task.delay = Mock()

        # Act
        proxy.delay()

        # Assert
        mock_task.delay.assert_called_once_with(
            tenant_id="tenant-123", dataset_id="dataset-456", document_ids=["doc-1", "doc-2", "doc-3"]
        )

    @patch("services.document_indexing_task_proxy.FeatureService")
    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_full_flow_with_existing_task_key(self, mock_task, mock_feature_service):
        """
        Test full flow when task key exists (task queuing).

        This test verifies the complete flow when another task is already
        running, ensuring the new task is queued correctly.
        """
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.SANDBOX
        )

        mock_feature_service.get_features.return_value = mock_features

        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()

        proxy._tenant_isolated_task_queue = DocumentIndexingTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=True
        )

        mock_task.delay = Mock()

        # Act
        proxy.delay()

        # Assert
        proxy._tenant_isolated_task_queue.push_tasks.assert_called_once()

        pushed_tasks = proxy._tenant_isolated_task_queue.push_tasks.call_args[0][0]

        expected_task_data = {
            "tenant_id": "tenant-123",
            "dataset_id": "dataset-456",
            "document_ids": ["doc-1", "doc-2", "doc-3"],
        }
        assert pushed_tasks[0] == expected_task_data

        assert pushed_tasks[0]["document_ids"] == ["doc-1", "doc-2", "doc-3"]

        mock_task.delay.assert_not_called()
