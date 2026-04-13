import json
from unittest.mock import Mock, patch

import pytest

from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy


class RagPipelineTaskProxyTestDataFactory:
    """Factory class for creating test data and mock objects for RagPipelineTaskProxy tests."""

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
    def create_rag_pipeline_invoke_entity(
        pipeline_id: str = "pipeline-123",
        user_id: str = "user-456",
        tenant_id: str = "tenant-789",
        workflow_id: str = "workflow-101",
        streaming: bool = True,
        workflow_execution_id: str | None = None,
        workflow_thread_pool_id: str | None = None,
    ) -> RagPipelineInvokeEntity:
        """Create RagPipelineInvokeEntity instance for testing."""
        return RagPipelineInvokeEntity(
            pipeline_id=pipeline_id,
            application_generate_entity={"key": "value"},
            user_id=user_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            streaming=streaming,
            workflow_execution_id=workflow_execution_id,
            workflow_thread_pool_id=workflow_thread_pool_id,
        )

    @staticmethod
    def create_rag_pipeline_task_proxy(
        dataset_tenant_id: str = "tenant-123",
        user_id: str = "user-456",
        rag_pipeline_invoke_entities: list[RagPipelineInvokeEntity] | None = None,
    ) -> RagPipelineTaskProxy:
        """Create RagPipelineTaskProxy instance for testing."""
        if rag_pipeline_invoke_entities is None:
            rag_pipeline_invoke_entities = [RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity()]
        return RagPipelineTaskProxy(dataset_tenant_id, user_id, rag_pipeline_invoke_entities)

    @staticmethod
    def create_mock_upload_file(file_id: str = "file-123") -> Mock:
        """Create mock upload file."""
        upload_file = Mock()
        upload_file.id = file_id
        return upload_file


class TestRagPipelineTaskProxy:
    """Test cases for RagPipelineTaskProxy class."""

    def test_initialization(self):
        """Test RagPipelineTaskProxy initialization."""
        # Arrange
        dataset_tenant_id = "tenant-123"
        user_id = "user-456"
        rag_pipeline_invoke_entities = [RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity()]

        # Act
        proxy = RagPipelineTaskProxy(dataset_tenant_id, user_id, rag_pipeline_invoke_entities)

        # Assert
        assert proxy._dataset_tenant_id == dataset_tenant_id
        assert proxy._user_id == user_id
        assert proxy._rag_pipeline_invoke_entities == rag_pipeline_invoke_entities
        assert isinstance(proxy._tenant_isolated_task_queue, TenantIsolatedTaskQueue)
        assert proxy._tenant_isolated_task_queue._tenant_id == dataset_tenant_id
        assert proxy._tenant_isolated_task_queue._unique_key == "pipeline"

    def test_initialization_with_empty_entities(self):
        """Test initialization with empty rag_pipeline_invoke_entities."""
        # Arrange
        dataset_tenant_id = "tenant-123"
        user_id = "user-456"
        rag_pipeline_invoke_entities = []

        # Act
        proxy = RagPipelineTaskProxy(dataset_tenant_id, user_id, rag_pipeline_invoke_entities)

        # Assert
        assert proxy._dataset_tenant_id == dataset_tenant_id
        assert proxy._user_id == user_id
        assert proxy._rag_pipeline_invoke_entities == []

    def test_initialization_with_multiple_entities(self):
        """Test initialization with multiple rag_pipeline_invoke_entities."""
        # Arrange
        dataset_tenant_id = "tenant-123"
        user_id = "user-456"
        rag_pipeline_invoke_entities = [
            RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity(pipeline_id="pipeline-1"),
            RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity(pipeline_id="pipeline-2"),
            RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity(pipeline_id="pipeline-3"),
        ]

        # Act
        proxy = RagPipelineTaskProxy(dataset_tenant_id, user_id, rag_pipeline_invoke_entities)

        # Assert
        assert len(proxy._rag_pipeline_invoke_entities) == 3
        assert proxy._rag_pipeline_invoke_entities[0].pipeline_id == "pipeline-1"
        assert proxy._rag_pipeline_invoke_entities[1].pipeline_id == "pipeline-2"
        assert proxy._rag_pipeline_invoke_entities[2].pipeline_id == "pipeline-3"

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    def test_features_property(self, mock_feature_service):
        """Test cached_property features."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features()
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()

        # Act
        features1 = proxy.features
        features2 = proxy.features  # Second call should use cached property

        # Assert
        assert features1 == mock_features
        assert features2 == mock_features
        assert features1 is features2  # Should be the same instance due to caching
        mock_feature_service.get_features.assert_called_once_with("tenant-123")

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_upload_invoke_entities(self, mock_db, mock_file_service_class):
        """Test _upload_invoke_entities method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        result = proxy._upload_invoke_entities()

        # Assert
        assert result == "file-123"
        mock_file_service_class.assert_called_once_with(mock_db.engine)

        # Verify upload_text was called with correct parameters
        mock_file_service.upload_text.assert_called_once()
        call_args = mock_file_service.upload_text.call_args
        json_text, name, user_id, tenant_id = call_args[0]

        assert name == "rag_pipeline_invoke_entities.json"
        assert user_id == "user-456"
        assert tenant_id == "tenant-123"

        # Verify JSON content
        parsed_json = json.loads(json_text)
        assert len(parsed_json) == 1
        assert parsed_json[0]["pipeline_id"] == "pipeline-123"

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_upload_invoke_entities_with_multiple_entities(self, mock_db, mock_file_service_class):
        """Test _upload_invoke_entities method with multiple entities."""
        # Arrange
        entities = [
            RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity(pipeline_id="pipeline-1"),
            RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity(pipeline_id="pipeline-2"),
        ]
        proxy = RagPipelineTaskProxy("tenant-123", "user-456", entities)
        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-456")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        result = proxy._upload_invoke_entities()

        # Assert
        assert result == "file-456"

        # Verify JSON content contains both entities
        call_args = mock_file_service.upload_text.call_args
        json_text = call_args[0][0]
        parsed_json = json.loads(json_text)
        assert len(parsed_json) == 2
        assert parsed_json[0]["pipeline_id"] == "pipeline-1"
        assert parsed_json[1]["pipeline_id"] == "pipeline-2"

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.rag_pipeline_run_task")
    def test_send_to_direct_queue(self, mock_task):
        """Test _send_to_direct_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._tenant_isolated_task_queue = RagPipelineTaskProxyTestDataFactory.create_mock_tenant_queue()
        upload_file_id = "file-123"
        mock_task.delay = Mock()

        # Act
        proxy._send_to_direct_queue(upload_file_id, mock_task)

        # If sent to direct queue, tenant_isolated_task_queue should not be called
        proxy._tenant_isolated_task_queue.push_tasks.assert_not_called()

        # Celery should be called directly
        mock_task.delay.assert_called_once_with(
            rag_pipeline_invoke_entities_file_id=upload_file_id, tenant_id="tenant-123"
        )

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.rag_pipeline_run_task")
    def test_send_to_tenant_queue_with_existing_task_key(self, mock_task):
        """Test _send_to_tenant_queue when task key exists."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._tenant_isolated_task_queue = RagPipelineTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=True
        )
        upload_file_id = "file-123"
        mock_task.delay = Mock()

        # Act
        proxy._send_to_tenant_queue(upload_file_id, mock_task)

        # If task key exists, should push tasks to the queue
        proxy._tenant_isolated_task_queue.push_tasks.assert_called_once_with([upload_file_id])
        # Celery should not be called directly
        mock_task.delay.assert_not_called()

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.rag_pipeline_run_task")
    def test_send_to_tenant_queue_without_task_key(self, mock_task):
        """Test _send_to_tenant_queue when no task key exists."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._tenant_isolated_task_queue = RagPipelineTaskProxyTestDataFactory.create_mock_tenant_queue(
            has_task_key=False
        )
        upload_file_id = "file-123"
        mock_task.delay = Mock()

        # Act
        proxy._send_to_tenant_queue(upload_file_id, mock_task)

        # If no task key, should set task waiting time key first
        proxy._tenant_isolated_task_queue.set_task_waiting_time.assert_called_once()
        mock_task.delay.assert_called_once_with(
            rag_pipeline_invoke_entities_file_id=upload_file_id, tenant_id="tenant-123"
        )

        # The first task should be sent to celery directly, so push tasks should not be called
        proxy._tenant_isolated_task_queue.push_tasks.assert_not_called()

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.rag_pipeline_run_task")
    def test_send_to_default_tenant_queue(self, mock_task):
        """Test _send_to_default_tenant_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_tenant_queue = Mock()
        upload_file_id = "file-123"

        # Act
        proxy._send_to_default_tenant_queue(upload_file_id)

        # Assert
        proxy._send_to_tenant_queue.assert_called_once_with(upload_file_id, mock_task)

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.priority_rag_pipeline_run_task")
    def test_send_to_priority_tenant_queue(self, mock_task):
        """Test _send_to_priority_tenant_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_tenant_queue = Mock()
        upload_file_id = "file-123"

        # Act
        proxy._send_to_priority_tenant_queue(upload_file_id)

        # Assert
        proxy._send_to_tenant_queue.assert_called_once_with(upload_file_id, mock_task)

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.priority_rag_pipeline_run_task")
    def test_send_to_priority_direct_queue(self, mock_task):
        """Test _send_to_priority_direct_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_direct_queue = Mock()
        upload_file_id = "file-123"

        # Act
        proxy._send_to_priority_direct_queue(upload_file_id)

        # Assert
        proxy._send_to_direct_queue.assert_called_once_with(upload_file_id, mock_task)

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_with_billing_enabled_sandbox_plan(self, mock_db, mock_file_service_class, mock_feature_service):
        """Test _dispatch method when billing is enabled with sandbox plan."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.SANDBOX
        )
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_default_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # If billing is enabled with sandbox plan, should send to default tenant queue
        proxy._send_to_default_tenant_queue.assert_called_once_with("file-123")

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_with_billing_enabled_non_sandbox_plan(
        self, mock_db, mock_file_service_class, mock_feature_service
    ):
        """Test _dispatch method when billing is enabled with non-sandbox plan."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.TEAM
        )
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # If billing is enabled with non-sandbox plan, should send to priority tenant queue
        proxy._send_to_priority_tenant_queue.assert_called_once_with("file-123")

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_with_billing_disabled(self, mock_db, mock_file_service_class, mock_feature_service):
        """Test _dispatch method when billing is disabled."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(billing_enabled=False)
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_priority_direct_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # If billing is disabled, for example: self-hosted or enterprise, should send to priority direct queue
        proxy._send_to_priority_direct_queue.assert_called_once_with("file-123")

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_with_empty_upload_file_id(self, mock_db, mock_file_service_class):
        """Test _dispatch method when upload_file_id is empty."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = Mock()
        mock_upload_file.id = ""  # Empty file ID
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act & Assert
        with pytest.raises(ValueError, match="upload_file_id is empty"):
            proxy._dispatch()

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_edge_case_empty_plan(self, mock_db, mock_file_service_class, mock_feature_service):
        """Test _dispatch method with empty plan string."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(billing_enabled=True, plan="")
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once_with("file-123")

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_edge_case_none_plan(self, mock_db, mock_file_service_class, mock_feature_service):
        """Test _dispatch method with None plan."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(billing_enabled=True, plan=None)
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once_with("file-123")

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_delay_method(self, mock_db, mock_file_service_class, mock_feature_service):
        """Test delay method integration."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(
            billing_enabled=True, plan=CloudPlan.SANDBOX
        )
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._dispatch = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_mock_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy.delay()

        # Assert
        proxy._dispatch.assert_called_once()

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.logger")
    def test_delay_method_with_empty_entities(self, mock_logger):
        """Test delay method with empty rag_pipeline_invoke_entities."""
        # Arrange
        proxy = RagPipelineTaskProxy("tenant-123", "user-456", [])

        # Act
        proxy.delay()

        # Assert
        mock_logger.warning.assert_called_once_with(
            "Received empty rag pipeline invoke entities, no tasks delivered: %s %s", "tenant-123", "user-456"
        )
