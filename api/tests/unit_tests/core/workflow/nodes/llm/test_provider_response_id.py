import uuid
from unittest import mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.model_entities import AIModelEntity, ModelType
from core.workflow.entities import GraphInitParams
from core.workflow.node_events.node import ModelInvokeCompletedEvent
from core.workflow.nodes.llm.entities import LLMNodeData, ModelConfig
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from models.provider import ProviderType


class TestLLMNodeProviderResponseId:
    """Test cases for LLM node provider_response_id handling."""

    @pytest.fixture
    def mock_llm_node_data(self):
        """Create mock LLM node data."""
        return LLMNodeData(
            title="Test LLM Node",
            model=ModelConfig(provider="openai", name="gpt-4", mode="chat", completion_params={"temperature": 0.7}),
            prompt_template=[{"role": "user", "text": "Hello, {{input}}"}],
            memory=None,
            context=ContextConfig(enabled=False),
            vision=VisionConfig(
                enabled=True,
                configs=VisionConfigOptions(
                    variable_selector=["sys", "files"],
                    detail=ImagePromptMessageContent.DETAIL.HIGH,
                ),
            ),
            reasoning_format="tagged",
        )

    @pytest.fixture
    def mock_model_bundle(self):
        """Create mock model bundle."""
        return ProviderModelBundle(
            configuration=ProviderConfiguration(
                tenant_id="test-tenant",
                provider_type=ProviderType.CUSTOM,
                provider="openai",
                credentials=CustomConfiguration(),
            ),
            model=AIModelEntity(
                model="gpt-4",
                model_type=ModelType.LLM,
                fetch_from=FetchFrom.PREDEFINED_MODEL,
                features=[],
            ),
        )

    @pytest.fixture
    def mock_variable_pool(self):
        """Create mock variable pool."""
        return VariablePool(
            system_variables={},
            user_variables={},
        )

    @pytest.fixture
    def mock_runtime_state(self):
        """Create mock runtime state."""
        import time

        return GraphRuntimeState(
            variable_pool=VariablePool(
                system_variables={},
                user_variables={},
            ),
            start_at=time.time(),
        )

    def test_llm_node_captures_provider_response_id(
        self, mock_llm_node_data, mock_model_bundle, mock_variable_pool, mock_runtime_state
    ):
        """Test that LLM node captures provider_response_id from ModelInvokeCompletedEvent."""
        # Setup
        node_id = str(uuid.uuid4())
        node = LLMNode(
            id=node_id,
            node_data=mock_llm_node_data,
            graph_init_params=GraphInitParams(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                user_id="test-user",
                invoke_from=InvokeFrom.EXPLORE,
            ),
            graph_runtime_state=mock_runtime_state,
            variable_pool=mock_variable_pool,
        )

        # Mock model invoke generator that yields ModelInvokeCompletedEvent with provider_response_id
        test_provider_response_id = "chatcmpl-test-response-123"
        test_usage = LLMUsage(
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
            total_price=0.001,
            currency="USD",
            latency=1.5,
        )

        mock_generator = iter(
            [
                ModelInvokeCompletedEvent(
                    text="Hello! This is a test response.",
                    usage=test_usage,
                    finish_reason="stop",
                    provider_response_id=test_provider_response_id,
                )
            ]
        )

        # Mock the model invocation
        with mock.patch.object(node, "_model_invoke", return_value=mock_generator):
            # Execute the node
            events = list(node.run())

            # Find the StreamCompletedEvent
            stream_completed_event = None
            for event in events:
                if hasattr(event, "node_run_result"):
                    stream_completed_event = event
                    break

            assert stream_completed_event is not None, "StreamCompletedEvent should be yielded"

            # Verify provider_response_id is captured in metadata
            metadata = stream_completed_event.node_run_result.metadata
            assert metadata is not None, "Metadata should not be None"

            from core.workflow.enums import WorkflowNodeExecutionMetadataKey

            assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID in metadata, (
                "PROVIDER_RESPONSE_ID should be in metadata"
            )
            assert metadata[WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID] == test_provider_response_id, (
                "provider_response_id should match the expected value"
            )

    def test_llm_node_handles_missing_provider_response_id(
        self, mock_llm_node_data, mock_model_bundle, mock_variable_pool, mock_runtime_state
    ):
        """Test that LLM node handles missing provider_response_id gracefully."""
        # Setup
        node_id = str(uuid.uuid4())
        node = LLMNode(
            id=node_id,
            node_data=mock_llm_node_data,
            graph_init_params=GraphInitParams(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                user_id="test-user",
                invoke_from=InvokeFrom.EXPLORE,
            ),
            graph_runtime_state=mock_runtime_state,
            variable_pool=mock_variable_pool,
        )

        # Mock model invoke generator that yields ModelInvokeCompletedEvent without provider_response_id
        test_usage = LLMUsage(
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
            total_price=0.001,
            currency="USD",
            latency=1.5,
        )

        mock_generator = iter(
            [
                ModelInvokeCompletedEvent(
                    text="Hello! This is a test response.",
                    usage=test_usage,
                    finish_reason="stop",
                    provider_response_id=None,  # Explicitly None
                )
            ]
        )

        # Mock the model invocation
        with mock.patch.object(node, "_model_invoke", return_value=mock_generator):
            # Execute the node
            events = list(node.run())

            # Find the StreamCompletedEvent
            stream_completed_event = None
            for event in events:
                if hasattr(event, "node_run_result"):
                    stream_completed_event = event
                    break

            assert stream_completed_event is not None, "StreamCompletedEvent should be yielded"

            # Verify provider_response_id is not in metadata when it's None
            metadata = stream_completed_event.node_run_result.metadata
            assert metadata is not None, "Metadata should not be None"

            from core.workflow.enums import WorkflowNodeExecutionMetadataKey

            assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID not in metadata, (
                "PROVIDER_RESPONSE_ID should not be in metadata when it's None"
            )

    def test_llm_node_metadata_structure(
        self, mock_llm_node_data, mock_model_bundle, mock_variable_pool, mock_runtime_state
    ):
        """Test that LLM node metadata has the correct structure."""
        # Setup
        node_id = str(uuid.uuid4())
        node = LLMNode(
            id=node_id,
            node_data=mock_llm_node_data,
            graph_init_params=GraphInitParams(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                user_id="test-user",
                invoke_from=InvokeFrom.EXPLORE,
            ),
            graph_runtime_state=mock_runtime_state,
            variable_pool=mock_variable_pool,
        )

        test_provider_response_id = "chatcmpl-test-response-456"
        test_usage = LLMUsage(
            prompt_tokens=15,
            completion_tokens=25,
            total_tokens=40,
            total_price=0.002,
            currency="USD",
            latency=2.0,
        )

        mock_generator = iter(
            [
                ModelInvokeCompletedEvent(
                    text="Test response with provider response ID",
                    usage=test_usage,
                    finish_reason="stop",
                    provider_response_id=test_provider_response_id,
                )
            ]
        )

        # Mock the model invocation
        with mock.patch.object(node, "_model_invoke", return_value=mock_generator):
            # Execute the node
            events = list(node.run())

            # Find the StreamCompletedEvent
            stream_completed_event = None
            for event in events:
                if hasattr(event, "node_run_result"):
                    stream_completed_event = event
                    break

            assert stream_completed_event is not None, "StreamCompletedEvent should be yielded"

            # Verify metadata structure
            metadata = stream_completed_event.node_run_result.metadata
            from core.workflow.enums import WorkflowNodeExecutionMetadataKey

            # Check required keys
            assert WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS in metadata
            assert WorkflowNodeExecutionMetadataKey.TOTAL_PRICE in metadata
            assert WorkflowNodeExecutionMetadataKey.CURRENCY in metadata
            assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID in metadata

            # Check values
            assert metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == test_usage.total_tokens
            assert metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] == test_usage.total_price
            assert metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] == test_usage.currency
            assert metadata[WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID] == test_provider_response_id

            # Check that all keys are from the enum
            for key in metadata:
                assert isinstance(key, WorkflowNodeExecutionMetadataKey), (
                    f"All metadata keys should be WorkflowNodeExecutionMetadataKey, got {type(key)}"
                )
