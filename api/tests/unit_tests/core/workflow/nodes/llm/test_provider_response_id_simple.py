import uuid
from datetime import datetime
from decimal import Decimal

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.node_events.node import ModelInvokeCompletedEvent


class TestProviderResponseIdSimple:
    """Simple test cases for provider_response_id functionality that doesn't require complex setup."""

    def test_model_invoke_completed_event_supports_provider_response_id(self):
        """Test that ModelInvokeCompletedEvent includes provider_response_id field."""
        test_provider_response_id = "chatcmpl-test-response-123"

        test_usage = LLMUsage(
            prompt_tokens=10,
            prompt_unit_price=Decimal("0.00001"),
            prompt_price_unit=Decimal("0.0001"),
            prompt_price=Decimal("0.0001"),
            completion_tokens=20,
            completion_unit_price=Decimal("0.00002"),
            completion_price_unit=Decimal("0.0004"),
            completion_price=Decimal("0.0004"),
            total_tokens=30,
            total_price=Decimal("0.0005"),
            currency="USD",
            latency=1.5,
        )

        event = ModelInvokeCompletedEvent(
            text="Test response",
            usage=test_usage,
            finish_reason="stop",
            provider_response_id=test_provider_response_id,
        )

        assert event.provider_response_id == test_provider_response_id

    def test_model_invoke_completed_event_supports_none_provider_response_id(self):
        """Test that ModelInvokeCompletedEvent supports None provider_response_id."""
        test_usage = LLMUsage(
            prompt_tokens=5,
            prompt_unit_price=Decimal("0.00001"),
            prompt_price_unit=Decimal("0.00005"),
            prompt_price=Decimal("0.00005"),
            completion_tokens=10,
            completion_unit_price=Decimal("0.00002"),
            completion_price_unit=Decimal("0.0002"),
            completion_price=Decimal("0.0002"),
            total_tokens=15,
            total_price=Decimal("0.00025"),
            currency="USD",
            latency=1.0,
        )

        event = ModelInvokeCompletedEvent(
            text="Test response",
            usage=test_usage,
            finish_reason="stop",
            provider_response_id=None,
        )

        assert event.provider_response_id is None

    def test_workflow_node_execution_metadata_accepts_provider_response_id(self):
        """Test that WorkflowNodeExecution can store provider_response_id in metadata."""
        test_provider_response_id = "chatcmpl-workflow-test-456"

        metadata = {
            WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID: test_provider_response_id,
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.002,
        }

        execution = WorkflowNodeExecution(
            id=str(uuid.uuid4()),
            tenant_id="test-tenant",
            app_id="test-app",
            workflow_id="test-workflow",
            executor_id="test-executor",
            node_id="test-node",
            title="Test Node",
            node_type="llm",
            index=1,
            predecessor_node_id=None,
            inputs={},
            process_data={},
            outputs={},
            metadata=metadata,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=datetime.now(),
        )

        assert execution.metadata is not None
        assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID in execution.metadata
        assert execution.metadata[WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID] == test_provider_response_id

    def test_workflow_node_execution_metadata_handles_missing_provider_response_id(self):
        """Test that WorkflowNodeExecution handles missing provider_response_id gracefully."""
        metadata = {
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.002,
            # Note: PROVIDER_RESPONSE_ID is missing
        }

        execution = WorkflowNodeExecution(
            id=str(uuid.uuid4()),
            tenant_id="test-tenant",
            app_id="test-app",
            workflow_id="test-workflow",
            executor_id="test-executor",
            node_id="test-node",
            title="Test Node",
            node_type="llm",
            index=1,
            predecessor_node_id=None,
            inputs={},
            process_data={},
            outputs={},
            metadata=metadata,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=datetime.now(),
        )

        assert execution.metadata is not None
        assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID not in execution.metadata

    def test_provider_response_id_metadata_key_value(self):
        """Test that PROVIDER_RESPONSE_ID enum has the correct string value."""
        assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID == "provider_response_id"

    def test_metadata_key_type_safety(self):
        """Test that metadata keys are properly typed."""
        # This should work without errors
        metadata = {
            WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID: "test-id",
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 50,
        }

        # All keys should be WorkflowNodeExecutionMetadataKey instances
        for key in metadata:
            assert isinstance(key, WorkflowNodeExecutionMetadataKey)

        # All values should be accessible via the enum
        assert metadata[WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID] == "test-id"
        assert metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 50
