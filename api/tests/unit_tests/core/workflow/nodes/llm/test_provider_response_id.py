import uuid
from decimal import Decimal
from unittest import mock
from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelType
from core.workflow.entities import GraphInitParams
from core.workflow.node_events.node import ModelInvokeCompletedEvent
from core.workflow.nodes.llm.entities import ContextConfig, LLMNodeData, ModelConfig, VisionConfig, VisionConfigOptions
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.runtime import GraphRuntimeState, VariablePool


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
        """Create mock model bundle using MagicMock to avoid complex validation."""
        mock_bundle = MagicMock()
        mock_bundle.configuration.tenant_id = "test-tenant"
        mock_bundle.model.model = "gpt-4"
        mock_bundle.model.model_type = ModelType.LLM
        return mock_bundle

    @pytest.fixture
    def mock_variable_pool(self):
        """Create mock variable pool."""
        return VariablePool(
            system_variables={},
        )

    @pytest.fixture
    def mock_runtime_state(self):
        """Create mock runtime state."""
        import time

        return GraphRuntimeState(
            variable_pool=VariablePool(
                system_variables={},
            ),
            start_at=time.time(),
        )

    def test_llm_node_captures_provider_response_id(
        self, mock_llm_node_data, mock_model_bundle, mock_variable_pool, mock_runtime_state
    ):
        """Test that LLM node captures provider_response_id from ModelInvokeCompletedEvent."""
        # Setup
        node_id = str(uuid.uuid4())
        # Create node data manually to avoid mock issues
        node_data = {
            "id": node_id,
            "data": {
                "title": "Test LLM Node",
                "model": {
                    "provider": "openai",
                    "name": "gpt-4",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.7},
                },
                "prompt_template": [{"role": "user", "text": "Hello, {{input}}"}],
                "context": {"enabled": False},
            },
        }

        node = LLMNode(
            id=node_id,
            config=node_data,
            graph_init_params=GraphInitParams(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                user_id="test-user",
                invoke_from=InvokeFrom.EXPLORE,
                graph_config={},
                user_from="account",
                call_depth=0,
            ),
            graph_runtime_state=mock_runtime_state,
        )

        # Mock model invoke generator that yields ModelInvokeCompletedEvent with provider_response_id
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
        with (
            mock.patch("core.workflow.nodes.llm.node.LLMNode.invoke_llm", return_value=mock_generator),
            mock.patch(
                "core.workflow.nodes.llm.node.LLMNode._fetch_model_config",
                return_value=(
                    MagicMock(),
                    mock.MagicMock(mode="chat", provider="openai", model="gpt-4", parameters={}, stop=None),
                ),
            ),
            mock.patch("core.workflow.nodes.llm.node.LLMNode._fetch_inputs", return_value={}),
            mock.patch(
                "core.workflow.nodes.llm.node.LLMNode.fetch_prompt_messages",
                return_value=([UserPromptMessage(content=[TextPromptMessageContent(data="hello")])], None),
            ),
            mock.patch("core.workflow.nodes.llm.llm_utils.deduct_llm_quota", return_value=None),
        ):
            # Execute the node
            events = list(node.run())

            # Debug: print event types and any error
            print("EVENT TYPES:", [type(e).__name__ for e in events])
            for e in events:
                if hasattr(e, "node_run_result"):
                    r = e.node_run_result
                    print("RESULT STATUS:", getattr(r, "status", None))
                    print("RESULT ERROR:", getattr(r, "error", None))
                    print("RESULT METADATA:", getattr(r, "metadata", None))

            # Find the StreamCompletedEvent
            stream_completed_event = None
            for event in events:
                if hasattr(event, "node_run_result"):
                    stream_completed_event = event  # take the last one (should be completion)

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
        # Create node data manually to avoid mock issues
        node_data = {
            "id": node_id,
            "data": {
                "title": "Test LLM Node",
                "model": {
                    "provider": "openai",
                    "name": "gpt-4",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.7},
                },
                "prompt_template": [{"role": "user", "text": "Hello, {{input}}"}],
                "context": {"enabled": False},
            },
        }

        node = LLMNode(
            id=node_id,
            config=node_data,
            graph_init_params=GraphInitParams(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                user_id="test-user",
                invoke_from=InvokeFrom.EXPLORE,
                graph_config={},
                user_from="account",
                call_depth=0,
            ),
            graph_runtime_state=mock_runtime_state,
        )

        # Mock model invoke generator that yields ModelInvokeCompletedEvent without provider_response_id
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
        with (
            mock.patch("core.workflow.nodes.llm.node.LLMNode.invoke_llm", return_value=mock_generator),
            mock.patch("core.workflow.nodes.llm.node.LLMNode._fetch_inputs", return_value={}),
        ):
            # Execute the node
            events = list(node.run())

            # Find the StreamCompletedEvent
            stream_completed_event = None
            for event in events:
                if hasattr(event, "node_run_result"):
                    stream_completed_event = event  # take the last one (should be completion)

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
        # Create node data manually to avoid mock issues
        node_data = {
            "id": node_id,
            "data": {
                "title": "Test LLM Node",
                "model": {
                    "provider": "openai",
                    "name": "gpt-4",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.7},
                },
                "prompt_template": [{"role": "user", "text": "Hello, {{input}}"}],
                "context": {"enabled": False},
            },
        }

        node = LLMNode(
            id=node_id,
            config=node_data,
            graph_init_params=GraphInitParams(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                user_id="test-user",
                invoke_from=InvokeFrom.EXPLORE,
                graph_config={},
                user_from="account",
                call_depth=0,
            ),
            graph_runtime_state=mock_runtime_state,
        )

        test_provider_response_id = "chatcmpl-test-response-456"
        test_usage = LLMUsage(
            prompt_tokens=15,
            prompt_unit_price=Decimal("0.00001"),
            prompt_price_unit=Decimal("0.00015"),
            prompt_price=Decimal("0.00015"),
            completion_tokens=25,
            completion_unit_price=Decimal("0.00002"),
            completion_price_unit=Decimal("0.0005"),
            completion_price=Decimal("0.0005"),
            total_tokens=40,
            total_price=Decimal("0.00065"),
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
        with (
            mock.patch("core.workflow.nodes.llm.node.LLMNode.invoke_llm", return_value=mock_generator),
            mock.patch(
                "core.workflow.nodes.llm.node.LLMNode._fetch_model_config",
                return_value=(
                    MagicMock(),
                    mock.MagicMock(mode="chat", provider="openai", model="gpt-4", parameters={}, stop=None),
                ),
            ),
            mock.patch("core.workflow.nodes.llm.node.LLMNode._fetch_inputs", return_value={}),
            mock.patch(
                "core.workflow.nodes.llm.node.LLMNode.fetch_prompt_messages",
                return_value=([UserPromptMessage(content=[TextPromptMessageContent(data="hello")])], None),
            ),
            mock.patch("core.workflow.nodes.llm.llm_utils.deduct_llm_quota", return_value=None),
        ):
            # Execute the node
            events = list(node.run())

            # Find the StreamCompletedEvent
            stream_completed_event = None
            for event in events:
                if hasattr(event, "node_run_result"):
                    stream_completed_event = event  # take the last one (should be completion)

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
