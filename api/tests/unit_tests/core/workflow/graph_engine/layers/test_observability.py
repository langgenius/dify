"""
Tests for ObservabilityLayer.

Test coverage:
- Initialization and enable/disable logic
- Node span lifecycle (start, end, error handling)
- Parser integration (default and tool-specific)
- Graph lifecycle management
- Disabled mode behavior
"""

from unittest.mock import patch

import pytest
from opentelemetry.trace import StatusCode

from core.workflow.enums import NodeType
from core.workflow.graph_engine.layers.observability import ObservabilityLayer


class TestObservabilityLayerInitialization:
    """Test ObservabilityLayer initialization logic."""

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_initialization_when_otel_enabled(self, tracer_provider_with_memory_exporter):
        """Test that layer initializes correctly when OTel is enabled."""
        layer = ObservabilityLayer()
        assert not layer._is_disabled
        assert layer._tracer is not None
        assert NodeType.TOOL in layer._parsers
        assert layer._default_parser is not None

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", False)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_true")
    def test_initialization_when_instrument_flag_enabled(self, tracer_provider_with_memory_exporter):
        """Test that layer enables when instrument flag is enabled."""
        layer = ObservabilityLayer()
        assert not layer._is_disabled
        assert layer._tracer is not None
        assert NodeType.TOOL in layer._parsers
        assert layer._default_parser is not None


class TestObservabilityLayerNodeSpanLifecycle:
    """Test node span creation and lifecycle management."""

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_node_span_created_and_ended(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Test that span is created on node start and ended on node end."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        layer.on_node_run_start(mock_llm_node)
        layer.on_node_run_end(mock_llm_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == mock_llm_node.title
        assert spans[0].status.status_code == StatusCode.OK

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_node_error_recorded_in_span(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Test that node execution errors are recorded in span."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        error = ValueError("Test error")
        layer.on_node_run_start(mock_llm_node)
        layer.on_node_run_end(mock_llm_node, error)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR
        assert len(spans[0].events) > 0
        assert any("exception" in event.name.lower() for event in spans[0].events)

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_node_end_without_start_handled_gracefully(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Test that ending a node without start doesn't crash."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        layer.on_node_run_end(mock_llm_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 0


class TestObservabilityLayerParserIntegration:
    """Test parser integration for different node types."""

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_default_parser_used_for_regular_node(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_start_node
    ):
        """Test that default parser is used for non-tool nodes."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        layer.on_node_run_start(mock_start_node)
        layer.on_node_run_end(mock_start_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs["node.id"] == mock_start_node.id
        assert attrs["node.execution_id"] == mock_start_node.execution_id
        assert attrs["node.type"] == mock_start_node.node_type.value

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_tool_parser_used_for_tool_node(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_tool_node
    ):
        """Test that tool parser is used for tool nodes."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        layer.on_node_run_start(mock_tool_node)
        layer.on_node_run_end(mock_tool_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs["node.id"] == mock_tool_node.id
        assert attrs["tool.provider.id"] == mock_tool_node._node_data.provider_id
        assert attrs["tool.provider.type"] == mock_tool_node._node_data.provider_type.value
        assert attrs["tool.name"] == mock_tool_node._node_data.tool_name


class TestObservabilityLayerGraphLifecycle:
    """Test graph lifecycle management."""

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_on_graph_start_clears_contexts(self, tracer_provider_with_memory_exporter, mock_llm_node):
        """Test that on_graph_start clears node contexts."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        layer.on_node_run_start(mock_llm_node)
        assert len(layer._node_contexts) == 1

        layer.on_graph_start()
        assert len(layer._node_contexts) == 0

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_on_graph_end_with_no_unfinished_spans(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Test that on_graph_end handles normal completion."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        layer.on_node_run_start(mock_llm_node)
        layer.on_node_run_end(mock_llm_node, None)
        layer.on_graph_end(None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", True)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_on_graph_end_with_unfinished_spans_logs_warning(
        self, tracer_provider_with_memory_exporter, mock_llm_node, caplog
    ):
        """Test that on_graph_end logs warning for unfinished spans."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        layer.on_node_run_start(mock_llm_node)
        assert len(layer._node_contexts) == 1

        layer.on_graph_end(None)

        assert len(layer._node_contexts) == 0
        assert "node spans were not properly ended" in caplog.text


class TestObservabilityLayerDisabledMode:
    """Test behavior when layer is disabled."""

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", False)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_disabled_mode_skips_node_start(self, memory_span_exporter, mock_start_node):
        """Test that disabled layer doesn't create spans on node start."""
        layer = ObservabilityLayer()
        assert layer._is_disabled

        layer.on_graph_start()
        layer.on_node_run_start(mock_start_node)
        layer.on_node_run_end(mock_start_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 0

    @patch("core.workflow.graph_engine.layers.observability.dify_config.ENABLE_OTEL", False)
    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_disabled_mode_skips_node_end(self, memory_span_exporter, mock_llm_node):
        """Test that disabled layer doesn't process node end."""
        layer = ObservabilityLayer()
        assert layer._is_disabled

        layer.on_node_run_end(mock_llm_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 0
