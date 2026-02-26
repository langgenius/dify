"""
Shared fixtures for ObservabilityLayer tests.
"""

from unittest.mock import MagicMock, patch

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import set_tracer_provider

from core.workflow.enums import NodeType


@pytest.fixture
def memory_span_exporter():
    """Provide an in-memory span exporter for testing."""
    return InMemorySpanExporter()


@pytest.fixture
def tracer_provider_with_memory_exporter(memory_span_exporter):
    """Provide a TracerProvider configured with memory exporter."""
    import opentelemetry.trace as trace_api

    trace_api._TRACER_PROVIDER = None
    trace_api._TRACER_PROVIDER_SET_ONCE._done = False

    provider = TracerProvider()
    processor = SimpleSpanProcessor(memory_span_exporter)
    provider.add_span_processor(processor)
    set_tracer_provider(provider)

    yield provider

    provider.force_flush()


@pytest.fixture
def mock_start_node():
    """Create a mock Start Node."""
    node = MagicMock()
    node.id = "test-start-node-id"
    node.title = "Start Node"
    node.execution_id = "test-start-execution-id"
    node.node_type = NodeType.START
    return node


@pytest.fixture
def mock_llm_node():
    """Create a mock LLM Node."""
    node = MagicMock()
    node.id = "test-llm-node-id"
    node.title = "LLM Node"
    node.execution_id = "test-llm-execution-id"
    node.node_type = NodeType.LLM
    return node


@pytest.fixture
def mock_tool_node():
    """Create a mock Tool Node with tool-specific attributes."""
    from core.tools.entities.tool_entities import ToolProviderType
    from core.workflow.nodes.tool.entities import ToolNodeData

    node = MagicMock()
    node.id = "test-tool-node-id"
    node.title = "Test Tool Node"
    node.execution_id = "test-tool-execution-id"
    node.node_type = NodeType.TOOL

    tool_data = ToolNodeData(
        title="Test Tool Node",
        desc=None,
        provider_id="test-provider-id",
        provider_type=ToolProviderType.BUILT_IN,
        provider_name="test-provider",
        tool_name="test-tool",
        tool_label="Test Tool",
        tool_configurations={},
        tool_parameters={},
    )
    node._node_data = tool_data

    return node


@pytest.fixture
def mock_is_instrument_flag_enabled_false():
    """Mock is_instrument_flag_enabled to return False."""
    with patch("core.app.workflow.layers.observability.is_instrument_flag_enabled", return_value=False):
        yield


@pytest.fixture
def mock_is_instrument_flag_enabled_true():
    """Mock is_instrument_flag_enabled to return True."""
    with patch("core.app.workflow.layers.observability.is_instrument_flag_enabled", return_value=True):
        yield


@pytest.fixture
def mock_retrieval_node():
    """Create a mock Knowledge Retrieval Node."""
    node = MagicMock()
    node.id = "test-retrieval-node-id"
    node.title = "Retrieval Node"
    node.execution_id = "test-retrieval-execution-id"
    node.node_type = NodeType.KNOWLEDGE_RETRIEVAL
    return node


@pytest.fixture
def mock_result_event():
    """Create a mock result event with NodeRunResult."""
    from datetime import datetime

    from core.workflow.graph_events.node import NodeRunSucceededEvent
    from core.workflow.node_events.base import NodeRunResult

    node_run_result = NodeRunResult(
        inputs={"query": "test query"},
        outputs={"result": [{"content": "test content", "metadata": {}}]},
        process_data={},
        metadata={},
    )

    return NodeRunSucceededEvent(
        id="test-execution-id",
        node_id="test-node-id",
        node_type=NodeType.LLM,
        start_at=datetime.now(),
        node_run_result=node_run_result,
    )
