"""
Tests for ObservabilityLayer.

Test coverage:
- Initialization and enable/disable logic
- Node span lifecycle (start, end, error handling)
- Parser integration (default, tool, LLM, and retrieval parsers)
- Result event parameter extraction (inputs/outputs)
- Graph lifecycle management
- Disabled mode behavior
"""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor
from opentelemetry.trace import StatusCode, get_current_span

from core.app.workflow.layers.observability import ObservabilityLayer
from extensions.otel.semconv import DifySpanAttributes
from graphon.engine_events import GraphRunAbortedEvent
from graphon.enums import BuiltinNodeTypes


@pytest.fixture(autouse=True)
def _otel_config(config_overrides) -> None:
    config_overrides(ENABLE_OTEL=True)


class TestObservabilityLayerInitialization:
    """Test ObservabilityLayer initialization logic."""

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_initialization_when_otel_enabled(self, tracer_provider_with_memory_exporter):
        """Test that layer initializes correctly when OTel is enabled."""
        layer = ObservabilityLayer()
        assert not layer._is_disabled
        assert layer._tracer is not None
        assert BuiltinNodeTypes.TOOL in layer._parsers
        assert layer._default_parser is not None

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_true")
    def test_initialization_when_instrument_flag_enabled(self, tracer_provider_with_memory_exporter, config_overrides):
        """Test that layer enables when instrument flag is enabled."""
        config_overrides(ENABLE_OTEL=False)
        layer = ObservabilityLayer()
        assert not layer._is_disabled
        assert layer._tracer is not None
        assert BuiltinNodeTypes.TOOL in layer._parsers
        assert layer._default_parser is not None


class TestObservabilityLayerNodeSpanLifecycle:
    """Test node span creation and lifecycle management."""

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_node_span_created_and_ended(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Test that span is created on node start and ended on node end."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_llm_node):
            layer.on_node_run_end(mock_llm_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == mock_llm_node.title
        assert spans[0].status.status_code == StatusCode.OK

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_node_error_recorded_in_span(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Test that node execution errors are recorded in span."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        error = ValueError("Test error")
        with layer.node_run_context(mock_llm_node):
            layer.on_node_run_end(mock_llm_node, error)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR
        assert len(spans[0].events) > 0
        assert any("exception" in event.name.lower() for event in spans[0].events)

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

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_suspension_deactivates_span_until_resume(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_tool_node
    ):
        layer = ObservabilityLayer()
        parent = get_current_span()

        with layer.node_run_context(mock_tool_node):
            tool_span = get_current_span()
            assert tool_span.is_recording()

        assert get_current_span() is parent
        assert memory_span_exporter.get_finished_spans() == ()

        with layer.node_run_context(mock_tool_node):
            assert get_current_span() is tool_span
            layer.on_node_run_end(mock_tool_node, None)

        assert get_current_span() is parent
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].context == tool_span.get_span_context()

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_activation_does_not_swallow_node_errors(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        layer = ObservabilityLayer()
        parent = get_current_span()
        error = ValueError("node failed")

        with pytest.raises(ValueError, match="node failed"):
            with layer.node_run_context(mock_llm_node):
                raise error

        assert get_current_span() is parent
        layer.on_node_run_end(mock_llm_node, error)
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_parser_failure_still_ends_span(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_start_node, monkeypatch, caplog
    ):
        layer = ObservabilityLayer()

        def fail_parse(**_kwargs):
            raise ValueError("invalid node attributes")

        monkeypatch.setattr(layer._default_parser, "parse", fail_parse)

        with layer.node_run_context(mock_start_node):
            layer.on_node_run_end(mock_start_node, None)

        assert len(memory_span_exporter.get_finished_spans()) == 1
        assert "invalid node attributes" in caplog.text


class TestObservabilityLayerParserIntegration:
    """Test parser integration for different node types."""

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_default_parser_used_for_regular_node(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_start_node
    ):
        """Test that default parser is used for non-tool nodes."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_start_node):
            layer.on_node_run_end(mock_start_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs["node.id"] == mock_start_node.id
        assert attrs["node.execution_id"] == mock_start_node.execution_id
        assert attrs["node.type"] == mock_start_node.node_type

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_tool_parser_used_for_tool_node(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_tool_node
    ):
        """Test that tool parser is used for tool nodes."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_tool_node):
            layer.on_node_run_end(mock_tool_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs["node.id"] == mock_tool_node.id
        assert attrs["gen_ai.tool.name"] == mock_tool_node.title
        assert attrs["gen_ai.tool.type"] == mock_tool_node._node_data.provider_type.value

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_llm_parser_used_for_llm_node(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node, mock_result_event
    ):
        """Test that LLM parser is used for LLM nodes and extracts LLM-specific attributes."""
        from graphon.node_events import NodeRunResult

        mock_result_event.node_run_result = NodeRunResult(
            inputs={},
            outputs={"text": "test completion", "finish_reason": "stop"},
            process_data={
                "model_name": "gpt-4",
                "model_provider": "openai",
                "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
                "prompts": [{"role": "user", "text": "test prompt"}],
            },
            metadata={},
        )

        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_llm_node):
            layer.on_node_run_end(mock_llm_node, None, mock_result_event)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs["node.id"] == mock_llm_node.id
        assert attrs["gen_ai.request.model"] == "gpt-4"
        assert attrs["gen_ai.provider.name"] == "openai"
        assert attrs["gen_ai.usage.input_tokens"] == 10
        assert attrs["gen_ai.usage.output_tokens"] == 20
        assert attrs["gen_ai.usage.total_tokens"] == 30
        assert attrs["gen_ai.completion"] == "test completion"
        assert attrs["gen_ai.response.finish_reason"] == "stop"

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_retrieval_parser_used_for_retrieval_node(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_retrieval_node, mock_result_event
    ):
        """Test that retrieval parser is used for retrieval nodes and extracts retrieval-specific attributes."""
        from graphon.node_events import NodeRunResult

        mock_result_event.node_run_result = NodeRunResult(
            inputs={"query": "test query"},
            outputs={"result": [{"content": "test content", "metadata": {"score": 0.9, "document_id": "doc1"}}]},
            process_data={},
            metadata={},
        )

        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_retrieval_node):
            layer.on_node_run_end(mock_retrieval_node, None, mock_result_event)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs["node.id"] == mock_retrieval_node.id
        assert attrs["retrieval.query"] == "test query"
        assert "retrieval.document" in attrs

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_result_event_extracts_inputs_and_outputs(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_start_node, mock_result_event
    ):
        """Test that result_event parameter allows parsers to extract inputs and outputs."""
        from graphon.node_events import NodeRunResult

        mock_result_event.node_run_result = NodeRunResult(
            inputs={"input_key": "input_value"},
            outputs={"output_key": "output_value"},
            process_data={},
            metadata={},
        )

        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_start_node):
            layer.on_node_run_end(mock_start_node, None, mock_result_event)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert "input.value" in attrs
        assert "output.value" in attrs


class TestObservabilityLayerGraphLifecycle:
    """Test graph lifecycle management."""

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_on_graph_start_ends_leftover_spans(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """A new graph attempt must not leak or reuse an unfinished span."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_llm_node):
            first_span = get_current_span()

        layer.on_graph_start()
        assert not first_span.is_recording()

        with layer.node_run_context(mock_llm_node):
            assert get_current_span() is not first_span
            layer.on_node_run_end(mock_llm_node, None)

        assert len(memory_span_exporter.get_finished_spans()) == 2

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_on_graph_end_with_no_unfinished_spans(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Test that on_graph_end handles normal completion."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_llm_node):
            layer.on_node_run_end(mock_llm_node, None)
        layer.on_graph_end(None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_on_graph_end_ends_suspended_spans(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node
    ):
        """Pause and abort cleanup must export spans that never reached node end."""
        layer = ObservabilityLayer()
        layer.on_graph_start()

        with layer.node_run_context(mock_llm_node):
            span = get_current_span()

        layer.on_graph_end(None)
        layer.on_graph_end(None)

        assert not span.is_recording()
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == mock_llm_node.title

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_graph_end_and_late_worker_each_end_spans_once(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_start_node, mock_llm_node, caplog
    ):
        """An aborted graph can finish while a worker still owns another span."""
        graph_ending = Event()
        worker_finished = Event()

        class EndBarrier(SpanProcessor):
            def on_end(self, span: ReadableSpan) -> None:
                if span.name == mock_start_node.title:
                    graph_ending.set()
                    assert worker_finished.wait(5)

        tracer_provider_with_memory_exporter.add_span_processor(EndBarrier())
        layer = ObservabilityLayer()
        for node in (mock_start_node, mock_llm_node):
            with layer.node_run_context(node):
                pass

        def finish_worker() -> None:
            assert graph_ending.wait(5)
            try:
                layer.on_node_run_end(mock_llm_node, None)
            finally:
                worker_finished.set()

        with ThreadPoolExecutor(max_workers=1) as executor:
            worker = executor.submit(finish_worker)
            try:
                layer.on_graph_end(None)
            finally:
                worker.result(timeout=5)

        layer.on_graph_end(None)
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 2
        assert {span.name for span in spans} == {mock_start_node.title, mock_llm_node.title}
        assert "Calling end() on an ended span" not in caplog.text

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_graph_aborted_event_records_reason_on_current_span(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_start_node
    ):
        layer = ObservabilityLayer()
        layer.on_graph_start()
        with layer.node_run_context(mock_start_node):
            layer.on_event(GraphRunAbortedEvent(reason="worker shutdown", outputs={}))
            layer.on_node_run_end(mock_start_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].attributes[DifySpanAttributes.WORKFLOW_ABORT_REASON] == "worker shutdown"
        assert any(
            event.name == "dify.workflow.aborted"
            and event.attributes[DifySpanAttributes.WORKFLOW_ABORT_REASON] == "worker shutdown"
            for event in spans[0].events
        )


class TestObservabilityLayerDisabledMode:
    """Test behavior when layer is disabled."""

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_disabled_mode_skips_node_start(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_start_node, config_overrides
    ):
        """Test that disabled layer doesn't create spans on node start."""
        config_overrides(ENABLE_OTEL=False)
        layer = ObservabilityLayer()
        assert layer._is_disabled

        layer.on_graph_start()
        with layer.node_run_context(mock_start_node):
            layer.on_node_run_end(mock_start_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 0

    @pytest.mark.usefixtures("mock_is_instrument_flag_enabled_false")
    def test_disabled_mode_skips_node_end(
        self, tracer_provider_with_memory_exporter, memory_span_exporter, mock_llm_node, config_overrides
    ):
        """Test that disabled layer doesn't process node end."""
        config_overrides(ENABLE_OTEL=False)
        layer = ObservabilityLayer()
        assert layer._is_disabled

        layer.on_node_run_end(mock_llm_node, None)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 0
