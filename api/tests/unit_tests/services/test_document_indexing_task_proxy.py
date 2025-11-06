from unittest.mock import Mock, patch

from core.entities.document_task import DocumentTask
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from services.document_indexing_task_proxy import DocumentIndexingTaskProxy


class DocumentIndexingTaskProxyTestDataFactory:
    """Factory class for creating test data and mock objects for DocumentIndexingTaskProxy tests."""

    @staticmethod
    def create_mock_features(billing_enabled: bool = False, plan: CloudPlan = CloudPlan.SANDBOX) -> Mock:
        """Create mock features with billing configuration."""
        features = Mock()
        features.billing = Mock()
        features.billing.enabled = billing_enabled
        features.billing.subscription = Mock()
        features.billing.subscription.plan = plan
        return features

    @staticmethod
    def create_mock_tenant_queue(has_task_key: bool = False) -> Mock:
        """Create mock TenantIsolatedTaskQueue."""
        queue = Mock(spec=TenantIsolatedTaskQueue)
        queue.get_task_key.return_value = "task_key" if has_task_key else None
        queue.push_tasks = Mock()
        queue.set_task_waiting_time = Mock()
        return queue

    @staticmethod
    def create_document_task_proxy(
        tenant_id: str = "tenant-123", dataset_id: str = "dataset-456", document_ids: list[str] | None = None
    ) -> DocumentIndexingTaskProxy:
        """Create DocumentIndexingTaskProxy instance for testing."""
        if document_ids is None:
            document_ids = ["doc-1", "doc-2", "doc-3"]
        return DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)


class TestDocumentIndexingTaskProxy:
    """Test cases for DocumentIndexingTaskProxy class."""

    def test_initialization(self):
        """Test DocumentIndexingTaskProxy initialization."""
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

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_features_property(self, mock_feature_service):
        """Test cached_property features."""
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

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_direct_queue(self, mock_task):
        """Test _send_to_direct_queue method."""
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
    def test_send_to_tenant_queue_with_existing_task_key(self, mock_task):
        """Test _send_to_tenant_queue when task key exists."""
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
        assert isinstance(DocumentTask(**pushed_tasks[0]), DocumentTask)
        assert pushed_tasks[0]["tenant_id"] == "tenant-123"
        assert pushed_tasks[0]["dataset_id"] == "dataset-456"
        assert pushed_tasks[0]["document_ids"] == ["doc-1", "doc-2", "doc-3"]
        mock_task.delay.assert_not_called()

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_tenant_queue_without_task_key(self, mock_task):
        """Test _send_to_tenant_queue when no task key exists."""
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

    @patch("services.document_indexing_task_proxy.normal_document_indexing_task")
    def test_send_to_default_tenant_queue(self, mock_task):
        """Test _send_to_default_tenant_queue method."""
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()
        proxy._send_to_tenant_queue = Mock()

        # Act
        proxy._send_to_default_tenant_queue()

        # Assert
        proxy._send_to_tenant_queue.assert_called_once_with(mock_task)

    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_send_to_priority_tenant_queue(self, mock_task):
        """Test _send_to_priority_tenant_queue method."""
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()
        proxy._send_to_tenant_queue = Mock()

        # Act
        proxy._send_to_priority_tenant_queue()

        # Assert
        proxy._send_to_tenant_queue.assert_called_once_with(mock_task)

    @patch("services.document_indexing_task_proxy.priority_document_indexing_task")
    def test_send_to_priority_direct_queue(self, mock_task):
        """Test _send_to_priority_direct_queue method."""
        # Arrange
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()
        proxy._send_to_direct_queue = Mock()

        # Act
        proxy._send_to_priority_direct_queue()

        # Assert
        proxy._send_to_direct_queue.assert_called_once_with(mock_task)

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_with_billing_enabled_sandbox_plan(self, mock_feature_service):
        """Test _dispatch method when billing is enabled with sandbox plan."""
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
    def test_dispatch_with_billing_enabled_non_sandbox_plan(self, mock_feature_service):
        """Test _dispatch method when billing is enabled with non-sandbox plan."""
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.TEAM
        )
        mock_feature_service.get_features.return_value = mock_features
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        # Act
        proxy._dispatch()

        # If billing enabled with non sandbox plan, should send to priority tenant queue
        proxy._send_to_priority_tenant_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_with_billing_disabled(self, mock_feature_service):
        """Test _dispatch method when billing is disabled."""
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(billing_enabled=False)
        mock_feature_service.get_features.return_value = mock_features
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()
        proxy._send_to_priority_direct_queue = Mock()

        # Act
        proxy._dispatch()

        # If billing disabled, for example: self-hosted or enterprise, should send to priority direct queue
        proxy._send_to_priority_direct_queue.assert_called_once()

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_delay_method(self, mock_feature_service):
        """Test delay method integration."""
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
        # If billing enabled with sandbox plan, should send to default tenant queue
        proxy._send_to_default_tenant_queue.assert_called_once()

    def test_document_task_dataclass(self):
        """Test DocumentTask dataclass."""
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

    @patch("services.document_indexing_task_proxy.FeatureService")
    def test_dispatch_edge_case_empty_plan(self, mock_feature_service):
        """Test _dispatch method with empty plan string."""
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
        """Test _dispatch method with None plan."""
        # Arrange
        mock_features = DocumentIndexingTaskProxyTestDataFactory.create_mock_features(billing_enabled=True, plan=None)
        mock_feature_service.get_features.return_value = mock_features
        proxy = DocumentIndexingTaskProxyTestDataFactory.create_document_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once()

    def test_initialization_with_empty_document_ids(self):
        """Test initialization with empty document_ids list."""
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

    def test_initialization_with_single_document_id(self):
        """Test initialization with single document_id."""
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
