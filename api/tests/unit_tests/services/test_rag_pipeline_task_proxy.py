import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import cast
from unittest.mock import MagicMock, Mock, patch

import pytest
from celery.canvas import Signature
from pydantic import TypeAdapter, ValidationError

from enums import CloudPlan, DeploymentEdition
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.rag_pipeline.entities import RagPipelineInvokeEntity, RagPipelineWorkflowSnapshot
from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy
from services.rag_pipeline.tenant_task_queue import (
    RagPipelineTaskClaim,
    RagPipelineTaskProtocol,
    RagPipelineTaskTarget,
    RagPipelineTenantTask,
    RagPipelineTenantTaskQueue,
)
from tests.unit_tests.config_override import config_overrides_context

# This is the exact top-level decoder used by the worker from the previous
# release. It cannot parse the snapshot-batch object.
_HEAD_INVOKE_ENTITIES = TypeAdapter(list[dict[str, object]])


@dataclass
class _RecordingDirectTask:
    calls: list[dict[str, object]] = field(default_factory=list)

    def delay(self, **kwargs: object) -> None:
        self.calls.append(kwargs)


@dataclass
class _RecordingTenantQueue:
    claims: tuple[RagPipelineTaskClaim, ...]
    enqueued: list[tuple[RagPipelineTenantTask, int]] = field(default_factory=list)

    def enqueue(
        self,
        task: RagPipelineTenantTask,
        *,
        concurrency: int,
    ) -> tuple[RagPipelineTaskClaim, ...]:
        self.enqueued.append((task, concurrency))
        return self.claims


class RagPipelineTaskProxyTestDataFactory:
    """Factory class for creating test data and mock objects for RagPipelineTaskProxy tests."""

    @staticmethod
    def create_mock_features(plan: CloudPlan = CloudPlan.SANDBOX) -> Mock:
        """Create mock features with billing configuration."""
        features = Mock()
        features.billing = Mock()
        features.billing.subscription = Mock()
        features.billing.subscription.plan = plan
        return features

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
    def create_workflow_snapshot() -> RagPipelineWorkflowSnapshot:
        return RagPipelineWorkflowSnapshot(
            id="workflow-101",
            tenant_id="tenant-789",
            app_id="pipeline-123",
            type="rag-pipeline",
            kind="standard",
            version="v1",
            version_number=1,
            marked_name="V1",
            marked_comment="queued",
            graph='{"nodes": [{"id": "snapshot-root"}], "edges": []}',
            features="{}",
            created_by="user-456",
            created_at=datetime(2025, 1, 1),
            updated_by=None,
            updated_at=datetime(2025, 1, 1),
            environment_variables="[]",
            conversation_variables="[]",
            rag_pipeline_variables="[]",
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
    def create_upload_file(file_id: str = "file-123") -> UploadFile:
        """Create a transient upload file returned by the mocked storage service."""
        upload_file = UploadFile(
            tenant_id="tenant-123",
            storage_type=StorageType.LOCAL,
            key="rag-pipeline.json",
            name="rag-pipeline.json",
            size=1,
            extension="json",
            mime_type="application/json",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-456",
            created_at=datetime(2025, 1, 1),
            used=True,
        )
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
        assert isinstance(proxy._tenant_isolated_task_queue, RagPipelineTenantTaskQueue)
        assert proxy._tenant_isolated_task_queue._tenant_id == dataset_tenant_id

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
    def test_features_property(self, mock_feature_service: MagicMock):
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
        mock_feature_service.get_features.assert_called_once_with("tenant-123", exclude_vector_space=True)

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_upload_invoke_entities(self, mock_db: MagicMock, mock_file_service_class: MagicMock):
        """Test _upload_invoke_entities method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-123")
        mock_file_service.upload_text.return_value = upload_file

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
    def test_upload_invoke_entities_with_multiple_entities(
        self, mock_db: MagicMock, mock_file_service_class: MagicMock
    ):
        """Test _upload_invoke_entities method with multiple entities."""
        # Arrange
        entities = [
            RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity(pipeline_id="pipeline-1"),
            RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity(pipeline_id="pipeline-2"),
        ]
        proxy = RagPipelineTaskProxy(
            "tenant-123",
            "user-456",
            entities,
            workflow_snapshot=RagPipelineTaskProxyTestDataFactory.create_workflow_snapshot(),
        )
        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-456")
        mock_file_service.upload_text.return_value = upload_file

        # Act
        result = proxy._upload_invoke_entities()

        # Assert
        assert result == "file-456"

        # Verify JSON content contains both entities
        call_args = mock_file_service.upload_text.call_args
        json_text = call_args[0][0]
        parsed_json = json.loads(json_text)
        assert parsed_json["workflow_snapshot"]["graph"] == '{"nodes": [{"id": "snapshot-root"}], "edges": []}'
        assert len(parsed_json["invoke_entities"]) == 2
        assert parsed_json["invoke_entities"][0]["pipeline_id"] == "pipeline-1"
        assert parsed_json["invoke_entities"][1]["pipeline_id"] == "pipeline-2"
        assert all("workflow_snapshot" not in entity for entity in parsed_json["invoke_entities"])
        with pytest.raises(ValidationError):
            _HEAD_INVOKE_ENTITIES.validate_json(json_text)

    def test_send_to_direct_queue(self):
        """Test _send_to_direct_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        upload_file_id = "file-123"
        task = _RecordingDirectTask()
        mock_task = cast("Signature[object]", task)

        # Act
        proxy._send_to_direct_queue(upload_file_id, mock_task)

        # Celery should be called directly
        assert task.calls == [{"rag_pipeline_invoke_entities_file_id": upload_file_id, "tenant_id": "tenant-123"}]

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.dispatch_rag_pipeline_claims")
    def test_send_to_tenant_queue_claims_available_capacity(self, dispatch_claims: MagicMock):
        """The durable queue claim is handed to the shared publisher."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        upload_file_id = "file-123"
        task = RagPipelineTenantTask(file_id=upload_file_id, target=RagPipelineTaskTarget.REGULAR)
        claim = RagPipelineTaskClaim(receipt="receipt-1", task=task)
        queue = _RecordingTenantQueue((claim,))
        proxy._tenant_isolated_task_queue = cast("RagPipelineTenantTaskQueue", queue)

        # Act
        proxy._send_to_tenant_queue(upload_file_id, RagPipelineTaskTarget.REGULAR)

        assert queue.enqueued == [(task, 1)]
        dispatch_claims.assert_called_once_with(
            tenant_id="tenant-123",
            queue=proxy._tenant_isolated_task_queue,
            claims=(claim,),
        )

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.dispatch_rag_pipeline_claims")
    def test_send_to_tenant_queue_waits_when_capacity_is_full(self, dispatch_claims: MagicMock):
        """An accepted task stays pending when all tenant slots are claimed."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        upload_file_id = "file-123"
        task = RagPipelineTenantTask(file_id=upload_file_id, target=RagPipelineTaskTarget.PRIORITY)
        queue = _RecordingTenantQueue(())
        proxy._tenant_isolated_task_queue = cast("RagPipelineTenantTaskQueue", queue)

        # Act
        proxy._send_to_tenant_queue(upload_file_id, RagPipelineTaskTarget.PRIORITY)

        assert queue.enqueued == [(task, 1)]
        dispatch_claims.assert_called_once_with(
            tenant_id="tenant-123",
            queue=proxy._tenant_isolated_task_queue,
            claims=(),
        )

    def test_send_to_default_tenant_queue(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test _send_to_default_tenant_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        upload_file_id = "file-123"
        sent: list[tuple[str, RagPipelineTaskTarget]] = []

        def record(file_id: str, target: RagPipelineTaskTarget) -> None:
            sent.append((file_id, target))

        monkeypatch.setattr(proxy, "_send_to_tenant_queue", record)

        # Act
        proxy._send_to_default_tenant_queue(upload_file_id)

        # Assert
        assert sent == [(upload_file_id, RagPipelineTaskTarget.REGULAR)]

    def test_send_to_priority_tenant_queue(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test _send_to_priority_tenant_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        upload_file_id = "file-123"
        sent: list[tuple[str, RagPipelineTaskTarget]] = []

        def record(file_id: str, target: RagPipelineTaskTarget) -> None:
            sent.append((file_id, target))

        monkeypatch.setattr(proxy, "_send_to_tenant_queue", record)

        # Act
        proxy._send_to_priority_tenant_queue(upload_file_id)

        # Assert
        assert sent == [(upload_file_id, RagPipelineTaskTarget.PRIORITY)]

    def test_send_to_priority_direct_queue(self):
        """Test _send_to_priority_direct_queue method."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_direct_queue = Mock()
        upload_file_id = "file-123"

        # Act
        proxy._send_to_priority_direct_queue(upload_file_id)

        # Assert
        proxy._send_to_direct_queue.assert_called_once()
        sent_file_id, task = proxy._send_to_direct_queue.call_args.args
        assert sent_file_id == upload_file_id
        assert task.task == "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task"
        assert task.options["queue"] == "priority_pipeline"

    def test_snapshot_batch_uses_versioned_direct_task_and_queue(self, monkeypatch: pytest.MonkeyPatch) -> None:
        entity = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_invoke_entity()
        proxy = RagPipelineTaskProxy(
            "tenant-123",
            "user-456",
            [entity],
            workflow_snapshot=RagPipelineTaskProxyTestDataFactory.create_workflow_snapshot(),
        )
        sent: list[tuple[str, Signature[object]]] = []

        def record(file_id: str, task: Signature[object]) -> None:
            sent.append((file_id, task))

        monkeypatch.setattr(proxy, "_send_to_direct_queue", record)

        proxy._send_to_priority_direct_queue("file-v2")

        assert proxy._task_protocol is RagPipelineTaskProtocol.SNAPSHOT_BATCH_V2
        assert len(sent) == 1
        file_id, task = sent[0]
        assert file_id == "file-v2"
        assert task.task == "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task_v2"
        assert task.options["queue"] == "priority_pipeline_v2"

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_with_cloud_sandbox_plan(
        self, mock_db: MagicMock, mock_file_service_class: MagicMock, mock_feature_service: MagicMock
    ):
        """Test _dispatch method in Cloud with Sandbox plan."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(plan=CloudPlan.SANDBOX)
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_default_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # If billing is enabled with sandbox plan, should send to default tenant queue
        proxy._send_to_default_tenant_queue.assert_called_once_with("file-123")

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_with_cloud_paid_plan(self, mock_db, mock_file_service_class, mock_feature_service):
        """Test _dispatch method in Cloud with a paid plan."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(plan=CloudPlan.TEAM)
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # If billing is enabled with non-sandbox plan, should send to priority tenant queue
        proxy._send_to_priority_tenant_queue.assert_called_once_with("file-123")

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_outside_cloud(
        self,
        mock_db: MagicMock,
        mock_file_service_class: MagicMock,
        mock_feature_service: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Test _dispatch method outside Cloud."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features()
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        dispatched: list[str] = []

        def record(file_id: str) -> None:
            dispatched.append(file_id)

        monkeypatch.setattr(proxy, "_send_to_priority_direct_queue", record)

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # If billing is disabled, for example: self-hosted or enterprise, should send to priority direct queue
        assert dispatched == ["file-123"]

    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_with_empty_upload_file_id(self, mock_db: MagicMock, mock_file_service_class: MagicMock):
        """Test _dispatch method when upload_file_id is empty."""
        # Arrange
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("")
        mock_file_service.upload_text.return_value = upload_file

        # Act & Assert
        with pytest.raises(ValueError, match="upload_file_id is empty"):
            proxy._dispatch()

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_edge_case_empty_plan(
        self, mock_db: MagicMock, mock_file_service_class: MagicMock, mock_feature_service: MagicMock
    ):
        """Test _dispatch method with empty plan string."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(plan="")
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once_with("file-123")

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_dispatch_edge_case_none_plan(
        self, mock_db: MagicMock, mock_file_service_class: MagicMock, mock_feature_service: MagicMock
    ):
        """Test _dispatch method with None plan."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(plan=None)
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._send_to_priority_tenant_queue = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy._dispatch()

        # Assert
        proxy._send_to_priority_tenant_queue.assert_called_once_with("file-123")

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FeatureService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    @patch("services.rag_pipeline.rag_pipeline_task_proxy.db")
    def test_delay_method(
        self, mock_db: MagicMock, mock_file_service_class: MagicMock, mock_feature_service: MagicMock
    ):
        """Test delay method integration."""
        # Arrange
        mock_features = RagPipelineTaskProxyTestDataFactory.create_mock_features(plan=CloudPlan.SANDBOX)
        mock_feature_service.get_features.return_value = mock_features
        proxy = RagPipelineTaskProxyTestDataFactory.create_rag_pipeline_task_proxy()
        proxy._dispatch = Mock()

        mock_file_service = Mock()
        mock_file_service_class.return_value = mock_file_service
        mock_upload_file = RagPipelineTaskProxyTestDataFactory.create_upload_file("file-123")
        mock_file_service.upload_text.return_value = mock_upload_file

        # Act
        proxy.delay()

        # Assert
        proxy._dispatch.assert_called_once()

    def test_delay_method_with_empty_entities(self, caplog: pytest.LogCaptureFixture):
        """Test delay method with empty rag_pipeline_invoke_entities."""
        # Arrange
        proxy = RagPipelineTaskProxy("tenant-123", "user-456", [])

        # Act
        with caplog.at_level(logging.WARNING, logger="services.rag_pipeline.rag_pipeline_task_proxy"):
            proxy.delay()

        # Assert
        assert "Received empty rag pipeline invoke entities, no tasks delivered: tenant-123 user-456" in caplog.text
