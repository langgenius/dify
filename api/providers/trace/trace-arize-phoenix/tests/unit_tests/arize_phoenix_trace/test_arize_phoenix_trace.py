from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, patch

import dify_trace_arize_phoenix.arize_phoenix_trace as arize_phoenix_trace_module
import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import (
    _NODE_TYPE_TO_SPAN_KIND,
    ArizePhoenixDataTrace,
    _build_graph_parent_index,
    _get_node_span_kind,
    _phoenix_parent_span_redis_key,
    _resolve_node_parent,
    _resolve_published_parent_span_context,
    _resolve_structured_parent_execution_id,
    _resolve_workflow_parent_context,
    _resolve_workflow_session_id,
    datetime_to_nanos,
    error_to_string,
    safe_json_dumps,
    set_span_status,
    setup_tracer,
    wrap_span_metadata,
)
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from openinference.semconv.trace import OpenInferenceSpanKindValues, SpanAttributes
from opentelemetry.sdk.trace import Tracer
from opentelemetry.semconv.trace import SpanAttributes as OTELSpanAttributes
from opentelemetry.trace import StatusCode

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowNodeTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.exceptions import PendingTraceParentContextError
from graphon.enums import BUILT_IN_NODE_TYPES, BuiltinNodeTypes

# --- Helpers ---


def _dt():
    return datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)


def _make_workflow_info(**kwargs):
    defaults = {
        "workflow_id": "w1",
        "tenant_id": "t1",
        "workflow_run_id": "r1",
        "workflow_run_elapsed_time": 1.0,
        "workflow_run_status": "succeeded",
        "workflow_run_inputs": {"in": "val"},
        "workflow_run_outputs": {"out": "val"},
        "workflow_run_version": "1.0",
        "total_tokens": 10,
        "file_list": ["f1"],
        "query": "hi",
        "metadata": {"app_id": "app1"},
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
    }
    defaults.update(kwargs)
    return WorkflowTraceInfo(**defaults)


def _make_message_info(**kwargs):
    defaults = {
        "conversation_model": "chat",
        "message_tokens": 5,
        "answer_tokens": 5,
        "total_tokens": 10,
        "conversation_mode": "chat",
        "metadata": {"app_id": "app1"},
        "inputs": {"in": "val"},
        "outputs": "val",
        "start_time": _dt(),
        "end_time": _dt(),
        "message_id": "m1",
    }
    defaults.update(kwargs)
    return MessageTraceInfo(**defaults)


def _get_start_span_call(start_span_mock, *, span_name: str):
    for call in start_span_mock.call_args_list:
        if call.kwargs.get("name") == span_name:
            return call
    raise AssertionError(f"Could not find start_span call with name={span_name!r}")


def _make_node_execution(**kwargs):
    defaults = {
        "node_type": "tool",
        "status": "succeeded",
        "inputs": {},
        "outputs": {},
        "created_at": _dt(),
        "elapsed_time": 1.0,
        "process_data": {},
        "metadata": {},
        "title": "Node",
        "id": "node-execution-1",
        "node_execution_id": "node-execution-1",
        "node_id": "node-1",
        "predecessor_node_id": None,
        "iteration_id": None,
        "loop_id": None,
        "error": None,
    }
    defaults.update(kwargs)
    node_execution = MagicMock()
    for key, value in defaults.items():
        setattr(node_execution, key, value)
    return node_execution


def _make_workflow_trace_info(**kwargs) -> WorkflowTraceInfo:
    defaults = {
        "workflow_id": "workflow-1",
        "tenant_id": "tenant-1",
        "workflow_run_id": "workflow-run-1",
        "workflow_run_elapsed_time": 1.0,
        "workflow_run_status": "succeeded",
        "workflow_run_inputs": {"input": "value"},
        "workflow_run_outputs": {"output": "value"},
        "workflow_run_version": "1.0",
        "total_tokens": 10,
        "file_list": ["file-1"],
        "query": "hello",
        "metadata": {"app_id": "app-1"},
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
    }
    defaults.update(kwargs)
    return WorkflowTraceInfo(**defaults)


def _make_workflow_node_trace_info(**kwargs) -> WorkflowNodeTraceInfo:
    defaults = {
        "workflow_id": "workflow-1",
        "workflow_run_id": "workflow-run-1",
        "tenant_id": "tenant-1",
        "node_execution_id": "node-execution-1",
        "node_id": "node-1",
        "node_type": "tool",
        "title": "Node 1",
        "status": "succeeded",
        "elapsed_time": 1.0,
        "index": 1,
        "metadata": {"app_id": "app-1"},
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
    }
    defaults.update(kwargs)
    return WorkflowNodeTraceInfo(**defaults)


# --- Utility Function Tests ---


def test_datetime_to_nanos():
    dt = _dt()
    expected = int(dt.timestamp() * 1_000_000_000)
    assert datetime_to_nanos(dt) == expected

    with patch("dify_trace_arize_phoenix.arize_phoenix_trace.datetime") as mock_dt:
        mock_now = MagicMock()
        mock_now.timestamp.return_value = 1704110400.0
        mock_dt.now.return_value = mock_now
        assert datetime_to_nanos(None) == 1704110400000000000


def test_error_to_string():
    try:
        raise ValueError("boom")
    except ValueError as e:
        err = e

    res = error_to_string(err)
    assert "ValueError: boom" in res
    assert "traceback" in res.lower() or "line" in res.lower()

    assert error_to_string("str error") == "str error"
    assert error_to_string(None) == "Empty Stack Trace"


def test_set_span_status():
    span = MagicMock()
    # OK
    set_span_status(span, None)
    span.set_status.assert_called()
    assert span.set_status.call_args[0][0].status_code == StatusCode.OK

    # Error Exception
    span.reset_mock()
    set_span_status(span, ValueError("fail"))
    assert span.set_status.call_args[0][0].status_code == StatusCode.ERROR
    span.record_exception.assert_called()

    # Error String
    span.reset_mock()
    set_span_status(span, "fail-str")
    assert span.set_status.call_args[0][0].status_code == StatusCode.ERROR
    span.add_event.assert_called()

    # repr branch
    class SilentError:
        def __str__(self):
            return ""

        def __repr__(self):
            return "SilentErrorRepr"

    span.reset_mock()
    set_span_status(span, cast(Exception | str | None, SilentError()))
    assert span.add_event.call_args[1]["attributes"][OTELSpanAttributes.EXCEPTION_MESSAGE] == "SilentErrorRepr"


def test_safe_json_dumps():
    assert safe_json_dumps({"a": _dt()}) == '{"a": "2024-01-01 00:00:00+00:00"}'


def test_wrap_span_metadata():
    res = wrap_span_metadata({"a": 1}, b=2)
    assert res == {"a": 1, "b": 2, "created_from": "Dify"}


class TestGetNodeSpanKind:
    def test_all_node_types_are_mapped_correctly(self):
        special_mappings = {
            BuiltinNodeTypes.LLM: OpenInferenceSpanKindValues.LLM,
            BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: OpenInferenceSpanKindValues.RETRIEVER,
            BuiltinNodeTypes.TOOL: OpenInferenceSpanKindValues.TOOL,
            BuiltinNodeTypes.AGENT: OpenInferenceSpanKindValues.AGENT,
        }

        for node_type in BUILT_IN_NODE_TYPES:
            expected_span_kind = special_mappings.get(node_type, OpenInferenceSpanKindValues.CHAIN)
            actual_span_kind = _get_node_span_kind(node_type)
            assert actual_span_kind == expected_span_kind, (
                f"Node type {node_type!r} was mapped to {actual_span_kind}, but {expected_span_kind} was expected."
            )

    def test_unknown_string_defaults_to_chain(self):
        assert _get_node_span_kind("some-future-node-type") == OpenInferenceSpanKindValues.CHAIN

    def test_stale_dataset_retrieval_not_in_mapping(self):
        assert "dataset_retrieval" not in _NODE_TYPE_TO_SPAN_KIND


class TestWorkflowSessionResolution:
    def test_prefers_conversation_id(self):
        info = _make_workflow_trace_info(conversation_id="conversation-1")

        assert _resolve_workflow_session_id(info) == "conversation-1"

    def test_nested_workflow_keeps_own_conversation_id_when_parent_context_exists(self):
        info = _make_workflow_trace_info(
            conversation_id="conversation-1",
            metadata={
                "app_id": "app-1",
                "parent_trace_context": {
                    "parent_workflow_run_id": "outer-workflow-run-1",
                    "parent_node_execution_id": "outer-node-execution-1",
                },
            },
        )

        assert _resolve_workflow_session_id(info) == "conversation-1"

    def test_uses_parent_workflow_run_id_for_nested_parent_trace_context(self):
        info = _make_workflow_trace_info(
            conversation_id=None,
            metadata={
                "app_id": "app-1",
                "parent_trace_context": {
                    "parent_workflow_run_id": "outer-workflow-run-1",
                    "parent_node_execution_id": "outer-node-execution-1",
                },
            },
        )

        assert _resolve_workflow_session_id(info) == "outer-workflow-run-1"

    def test_falls_back_to_workflow_run_id(self):
        info = _make_workflow_trace_info(conversation_id=None)

        assert _resolve_workflow_session_id(info) == "workflow-run-1"

    def test_parent_context_helper_delegates_to_resolved_parent_context(self):
        info = MagicMock()
        info.resolved_parent_context = ("outer-workflow-run-1", "outer-node-execution-1")

        assert _resolve_workflow_parent_context(info) == info.resolved_parent_context


class TestPhoenixParentSpanBridgeHelpers:
    def test_parent_span_redis_key_is_stable(self):
        assert _phoenix_parent_span_redis_key("outer-node-execution-1") == (
            "trace:phoenix:parent_span:outer-node-execution-1"
        )

    def test_pending_parent_exception_exposes_execution_id(self):
        error = PendingTraceParentContextError("outer-node-execution-1")

        assert error.parent_node_execution_id == "outer-node-execution-1"
        assert "outer-node-execution-1" in str(error)

    def test_resolve_parent_span_context_rejects_payload_without_traceparent(self, monkeypatch):
        mock_redis = MagicMock()
        mock_redis.get.return_value = '{"tracestate": "vendor=value"}'
        monkeypatch.setattr(arize_phoenix_trace_module, "redis_client", mock_redis)

        with pytest.raises(ValueError, match="traceparent"):
            _resolve_published_parent_span_context("outer-node-execution-1")

    @pytest.mark.parametrize(
        "stored_payload",
        [
            '{"traceparent": ""}',
            '{"traceparent": "not-a-traceparent"}',
            '{"traceparent": "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb"}',
        ],
    )
    def test_resolve_parent_span_context_rejects_malformed_traceparent(self, monkeypatch, stored_payload):
        mock_redis = MagicMock()
        mock_redis.get.return_value = stored_payload
        monkeypatch.setattr(arize_phoenix_trace_module, "redis_client", mock_redis)

        with pytest.raises(ValueError, match="traceparent"):
            _resolve_published_parent_span_context("outer-node-execution-1")


class TestWorkflowHierarchyHelpers:
    def test_build_graph_parent_index_uses_predecessor_nodes_without_order_heuristics(self):
        later_node = _make_workflow_node_trace_info(
            node_execution_id="node-execution-3",
            node_id="node-3",
            predecessor_node_id="node-2",
            index=3,
        )
        root_node = _make_workflow_node_trace_info(
            node_execution_id="node-execution-1",
            node_id="node-1",
            predecessor_node_id=None,
            index=1,
        )
        middle_node = _make_workflow_node_trace_info(
            node_execution_id="node-execution-2",
            node_id="node-2",
            predecessor_node_id="node-1",
            index=2,
        )

        graph_parent_index = _build_graph_parent_index([later_node, root_node, middle_node])

        assert graph_parent_index == {
            "node-execution-2": "node-execution-1",
            "node-execution-3": "node-execution-2",
        }

    def test_build_graph_parent_index_drops_ambiguous_parallel_like_predecessors(self):
        first_parallel_node = _make_workflow_node_trace_info(
            node_execution_id="parallel-node-execution-1",
            node_id="parallel-node-1",
            predecessor_node_id=None,
            index=1,
            parallel_id="parallel-1",
        )
        second_parallel_node = _make_workflow_node_trace_info(
            node_execution_id="parallel-node-execution-2",
            node_id="parallel-node-1",
            predecessor_node_id=None,
            index=2,
            parallel_id="parallel-2",
        )
        child_node = _make_workflow_node_trace_info(
            node_execution_id="child-node-execution-1",
            node_id="child-node-1",
            predecessor_node_id="parallel-node-1",
            index=3,
        )

        graph_parent_index = _build_graph_parent_index([child_node, first_parallel_node, second_parallel_node])

        assert graph_parent_index == {}

    def test_resolve_node_parent_prefers_predecessor_span(self):
        workflow_span = MagicMock(name="workflow-span")
        predecessor_span = MagicMock(name="predecessor-span")
        graph_parent_span = MagicMock(name="graph-parent-span")

        parent = _resolve_node_parent(
            execution_id="node-execution-2",
            predecessor_execution_id="node-execution-1",
            structured_parent_execution_id=None,
            span_by_execution_id={
                "node-execution-1": predecessor_span,
                "node-execution-0": graph_parent_span,
            },
            graph_parent_index={
                "node-execution-2": "node-execution-0",
            },
            workflow_span=workflow_span,
        )

        assert parent is predecessor_span

    def test_resolve_node_parent_falls_back_to_graph_parent_span(self):
        workflow_span = MagicMock(name="workflow-span")
        graph_parent_span = MagicMock(name="graph-parent-span")

        parent = _resolve_node_parent(
            execution_id="node-execution-2",
            predecessor_execution_id="missing-predecessor",
            structured_parent_execution_id=None,
            span_by_execution_id={
                "node-execution-0": graph_parent_span,
            },
            graph_parent_index={
                "node-execution-2": "node-execution-0",
            },
            workflow_span=workflow_span,
        )

        assert parent is graph_parent_span

    def test_resolve_node_parent_falls_back_to_workflow_span(self):
        workflow_span = MagicMock(name="workflow-span")

        parent = _resolve_node_parent(
            execution_id="node-execution-2",
            predecessor_execution_id=None,
            structured_parent_execution_id=None,
            span_by_execution_id={},
            graph_parent_index={},
            workflow_span=workflow_span,
        )

        assert parent is workflow_span

    def test_resolve_structured_parent_execution_id_allows_body_nodes_to_use_enclosing_structure(self):
        body_node = _make_workflow_node_trace_info(
            node_execution_id="body-execution-1",
            node_id="body-node-1",
            node_type="tool",
            loop_id="loop-node-1",
        )

        structured_parent_execution_id = _resolve_structured_parent_execution_id(
            body_node,
            execution_id_by_node_id={
                "loop-node-1": "loop-execution-1",
            },
        )

        assert structured_parent_execution_id == "loop-execution-1"

    def test_resolve_structured_parent_execution_id_reads_execution_metadata_dict_for_models(self):
        body_node = SimpleNamespace(
            node_execution_id="body-execution-1",
            node_id="body-node-1",
            execution_metadata_dict={
                "iteration_id": "iteration-node-1",
                "loop_id": "loop-node-1",
            },
        )

        structured_parent_execution_id = _resolve_structured_parent_execution_id(
            body_node,
            execution_id_by_node_id={
                "iteration-node-1": "iteration-execution-1",
                "loop-node-1": "loop-execution-1",
            },
        )

        assert structured_parent_execution_id == "iteration-execution-1"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.GrpcOTLPSpanExporter")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.trace_sdk.TracerProvider")
def test_setup_tracer_arize(mock_provider, mock_exporter):
    config = ArizeConfig(endpoint="http://a.com", api_key="k", space_id="s", project="p")
    setup_tracer(config)
    mock_exporter.assert_called_once()
    assert mock_exporter.call_args[1]["endpoint"] == "http://a.com/v1"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.HttpOTLPSpanExporter")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.trace_sdk.TracerProvider")
def test_setup_tracer_phoenix(mock_provider, mock_exporter):
    config = PhoenixConfig(endpoint="http://p.com", project="p")
    setup_tracer(config)
    mock_exporter.assert_called_once()
    assert mock_exporter.call_args[1]["endpoint"] == "http://p.com/v1/traces"


def test_setup_tracer_exception():
    config = ArizeConfig(endpoint="http://a.com", project="p")
    with patch("dify_trace_arize_phoenix.arize_phoenix_trace.urlparse", side_effect=Exception("boom")):
        with pytest.raises(Exception, match="boom"):
            setup_tracer(config)


# --- ArizePhoenixDataTrace Class Tests ---


@pytest.fixture
def trace_instance():
    with (
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.setup_tracer") as mock_setup,
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.redis_client", new=MagicMock()) as mock_redis,
    ):
        mock_tracer = MagicMock(spec=Tracer)
        mock_processor = MagicMock()
        mock_setup.return_value = (mock_tracer, mock_processor)
        config = ArizeConfig(endpoint="http://a.com", api_key="k", space_id="s", project="p")
        instance = ArizePhoenixDataTrace(config)
        cast(Any, instance)._mock_redis_client = mock_redis
        yield instance


def test_trace_dispatch(trace_instance):
    with (
        patch.object(trace_instance, "workflow_trace") as m1,
        patch.object(trace_instance, "message_trace") as m2,
        patch.object(trace_instance, "moderation_trace") as m3,
        patch.object(trace_instance, "suggested_question_trace") as m4,
        patch.object(trace_instance, "dataset_retrieval_trace") as m5,
        patch.object(trace_instance, "tool_trace") as m6,
        patch.object(trace_instance, "generate_name_trace") as m7,
    ):
        trace_instance.trace(_make_workflow_info())
        m1.assert_called()

        trace_instance.trace(_make_message_info())
        m2.assert_called()

        trace_instance.trace(ModerationTraceInfo(flagged=True, action="a", preset_response="p", query="q", metadata={}))
        m3.assert_called()

        trace_instance.trace(SuggestedQuestionTraceInfo(suggested_question=[], total_tokens=0, level="i", metadata={}))
        m4.assert_called()

        trace_instance.trace(DatasetRetrievalTraceInfo(metadata={}))
        m5.assert_called()

        trace_instance.trace(
            ToolTraceInfo(
                tool_name="t",
                tool_inputs={},
                tool_outputs="o",
                metadata={},
                tool_config={},
                time_cost=1,
                tool_parameters={},
            )
        )
        m6.assert_called()

        trace_instance.trace(GenerateNameTraceInfo(tenant_id="t", metadata={}))
        m7.assert_called()


def test_trace_exception(trace_instance):
    with patch.object(trace_instance, "workflow_trace", side_effect=RuntimeError("fail")):
        with pytest.raises(RuntimeError):
            trace_instance.trace(_make_workflow_info())


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
def test_workflow_trace_full(mock_db, mock_repo_factory, mock_sessionmaker, trace_instance):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    node1 = MagicMock()
    node1.node_type = "llm"
    node1.status = "succeeded"
    node1.inputs = {"q": "hi"}
    node1.outputs = {"a": "bye", "usage": {"total_tokens": 5}}
    node1.created_at = _dt()
    node1.elapsed_time = 1.0
    node1.process_data = {
        "prompts": [{"role": "user", "content": "hi"}],
        "model_provider": "openai",
        "model_name": "gpt-4",
    }
    node1.metadata = {"k": "v"}
    node1.title = "title"
    node1.id = "n1"
    node1.error = None

    repo.get_by_workflow_execution.return_value = [node1]

    with patch.object(trace_instance, "get_service_account_with_tenant"):
        trace_instance.workflow_trace(info)

    assert trace_instance.tracer.start_span.call_count >= 2


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
def test_workflow_trace_no_app_id(mock_db, trace_instance):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    info.metadata = {}
    with pytest.raises(ValueError, match="No app_id found in trace_info metadata"):
        trace_instance.workflow_trace(info)


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_uses_canonical_root_context_for_top_level_workflow(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(message_id="message-1", workflow_run_id="workflow-run-1")
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    root_carrier = {}
    root_context = object()

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value=root_carrier) as mock_ensure_root_span,
        patch.object(trace_instance.propagator, "extract", return_value=root_context) as mock_extract,
    ):
        trace_instance.workflow_trace(info)

    mock_ensure_root_span.assert_called_once_with(
        info.resolved_trace_id,
        root_span_name="workflow-run-1",
        root_span_attributes={
            SpanAttributes.INPUT_VALUE: safe_json_dumps(info.workflow_run_inputs),
            SpanAttributes.INPUT_MIME_TYPE: "application/json",
            SpanAttributes.OUTPUT_VALUE: safe_json_dumps(info.workflow_run_outputs),
            SpanAttributes.OUTPUT_MIME_TYPE: "application/json",
        },
    )
    mock_extract.assert_called_once_with(carrier=root_carrier)
    workflow_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="workflow_workflow-run-1")
    assert workflow_span_call.kwargs["context"] is root_context


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_uses_workflow_run_id_for_root_span_and_populates_root_inputs_outputs(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        workflow_run_inputs={"prompt": "hello"},
        workflow_run_outputs={"result": "world"},
        metadata={
            "app_id": "app1",
            "app_name": "Workflow Name",
        },
        workflow_run_id="workflow-run-xyz",
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    with patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()):
        trace_instance.workflow_trace(info)

    root_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="workflow-run-xyz")
    assert root_span_call.kwargs["attributes"][SpanAttributes.INPUT_VALUE] == safe_json_dumps(info.workflow_run_inputs)
    assert root_span_call.kwargs["attributes"][SpanAttributes.OUTPUT_VALUE] == safe_json_dumps(
        info.workflow_run_outputs
    )
    assert root_span_call.kwargs["attributes"][SpanAttributes.INPUT_MIME_TYPE] == "application/json"
    assert root_span_call.kwargs["attributes"][SpanAttributes.OUTPUT_MIME_TYPE] == "application/json"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_falls_back_to_dify_name_when_workflow_run_id_is_blank(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        metadata={
            "app_id": "app1",
            "app_name": "",
        },
        workflow_run_id="",
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    with patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()):
        trace_instance.workflow_trace(info)

    root_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="Dify")
    assert root_span_call.kwargs["attributes"]["dify_trace_id"] == ""


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_reuses_upstream_parent_workflow_context_when_no_parent_node_execution_id_is_available(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        message_id="message-1",
        workflow_run_id="workflow-run-1",
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
            },
        },
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    parent_carrier = {}
    parent_context = object()

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value=parent_carrier) as mock_ensure_root_span,
        patch.object(trace_instance.propagator, "extract", return_value=parent_context) as mock_extract,
    ):
        trace_instance.workflow_trace(info)

    mock_ensure_root_span.assert_called_once_with(
        "outer-workflow-run-1",
        root_span_name="workflow-run-1",
        root_span_attributes={
            SpanAttributes.INPUT_VALUE: safe_json_dumps(info.workflow_run_inputs),
            SpanAttributes.INPUT_MIME_TYPE: "application/json",
            SpanAttributes.OUTPUT_VALUE: safe_json_dumps(info.workflow_run_outputs),
            SpanAttributes.OUTPUT_MIME_TYPE: "application/json",
        },
    )
    mock_extract.assert_called_once_with(carrier=parent_carrier)
    workflow_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="workflow_workflow-run-1")
    assert workflow_span_call.kwargs["context"] is parent_context


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_uses_published_parent_node_context_for_nested_workflow(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        message_id="message-1",
        workflow_run_id="workflow-run-1",
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
                "parent_node_execution_id": "outer-node-execution-1",
            },
        },
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo
    stored_carrier = '{"traceparent":"00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"}'
    trace_instance._mock_redis_client.get.return_value = stored_carrier
    parent_context = object()

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span") as mock_ensure_root_span,
        patch.object(trace_instance.propagator, "extract", return_value=parent_context) as mock_extract,
    ):
        trace_instance.workflow_trace(info)

    trace_instance._mock_redis_client.get.assert_called_once_with(
        _phoenix_parent_span_redis_key("outer-node-execution-1")
    )
    mock_ensure_root_span.assert_not_called()
    mock_extract.assert_called_once_with(
        carrier={"traceparent": "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"}
    )
    workflow_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="workflow_workflow-run-1")
    assert workflow_span_call.kwargs["context"] is parent_context


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_raises_pending_parent_error_when_parent_node_context_is_missing(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        message_id="message-1",
        workflow_run_id="workflow-run-1",
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
                "parent_node_execution_id": "outer-node-execution-1",
            },
        },
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo
    trace_instance._mock_redis_client.get.return_value = None

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span") as mock_ensure_root_span,
        pytest.raises(PendingTraceParentContextError) as exc_info,
    ):
        trace_instance.workflow_trace(info)

    assert exc_info.value.parent_node_execution_id == "outer-node-execution-1"
    trace_instance._mock_redis_client.get.assert_called_once_with(
        _phoenix_parent_span_redis_key("outer-node-execution-1")
    )
    mock_ensure_root_span.assert_not_called()


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_uses_parent_workflow_run_id_for_workflow_and_nodes_when_nested_context_is_present(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        conversation_id=None,
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
            },
        },
    )
    repo = MagicMock()
    node_execution = MagicMock()
    node_execution.node_type = "tool"
    node_execution.status = "succeeded"
    node_execution.inputs = {"tool_input": "value"}
    node_execution.outputs = {"tool_output": "value"}
    node_execution.created_at = _dt()
    node_execution.elapsed_time = 1.0
    node_execution.process_data = {}
    node_execution.metadata = {}
    node_execution.title = "Tool node"
    node_execution.id = "node-1"
    node_execution.error = None
    repo.get_by_workflow_execution.return_value = [node_execution]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    with patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()):
        trace_instance.workflow_trace(info)

    workflow_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="workflow_r1")
    node_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="tool_Tool node")

    assert workflow_span_call.kwargs["attributes"][SpanAttributes.SESSION_ID] == "outer-workflow-run-1"
    assert node_span_call.kwargs["attributes"][SpanAttributes.SESSION_ID] == "outer-workflow-run-1"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_falls_back_to_node_type_when_node_title_is_blank(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    node_execution = _make_node_execution(
        id="node-execution-1",
        node_execution_id="node-execution-1",
        node_id="node-1",
        node_type="tool",
        title=" ",
    )
    repo.get_by_workflow_execution.return_value = [node_execution]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    with patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()):
        trace_instance.workflow_trace(info)

    node_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="tool")
    assert node_span_call.kwargs["attributes"][SpanAttributes.SESSION_ID] == "r1"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_prefers_workflow_graph_node_title_over_execution_title(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        workflow_data={
            "graph": {
                "nodes": [
                    {
                        "id": "nested-tool-node",
                        "data": {
                            "type": "tool",
                            "title": "nested workflow tool",
                        },
                    }
                ]
            }
        }
    )
    repo = MagicMock()
    node_execution = _make_node_execution(
        id="node-execution-1",
        node_execution_id="node-execution-1",
        node_id="nested-tool-node",
        node_type="tool",
        title="2",
    )
    repo.get_by_workflow_execution.return_value = [node_execution]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    with patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()):
        trace_instance.workflow_trace(info)

    node_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="tool_nested workflow tool")
    assert node_span_call.kwargs["attributes"][SpanAttributes.SESSION_ID] == "r1"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_keeps_nested_conversation_session_while_reusing_parent_root_context(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        conversation_id="conversation-1",
        message_id="message-1",
        workflow_run_id="workflow-run-1",
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
            },
        },
    )
    repo = MagicMock()
    node_execution = _make_node_execution(
        id="node-execution-1",
        node_execution_id="node-execution-1",
        node_id="node-1",
        node_type="tool",
    )
    repo.get_by_workflow_execution.return_value = [node_execution]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    parent_carrier = {}
    parent_context = object()

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value=parent_carrier) as mock_ensure_root_span,
        patch.object(trace_instance.propagator, "extract", return_value=parent_context) as mock_extract,
    ):
        trace_instance.workflow_trace(info)

    mock_ensure_root_span.assert_called_once_with(
        "outer-workflow-run-1",
        root_span_name="workflow-run-1",
        root_span_attributes={
            SpanAttributes.INPUT_VALUE: safe_json_dumps(info.workflow_run_inputs),
            SpanAttributes.INPUT_MIME_TYPE: "application/json",
            SpanAttributes.OUTPUT_VALUE: safe_json_dumps(info.workflow_run_outputs),
            SpanAttributes.OUTPUT_MIME_TYPE: "application/json",
        },
    )
    mock_extract.assert_called_once_with(carrier=parent_carrier)
    workflow_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="workflow_workflow-run-1")
    node_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="tool_Node")
    assert workflow_span_call.kwargs["context"] is parent_context
    assert workflow_span_call.kwargs["attributes"][SpanAttributes.SESSION_ID] == "conversation-1"
    assert node_span_call.kwargs["attributes"][SpanAttributes.SESSION_ID] == "conversation-1"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_publishes_tool_node_parent_span_context_to_redis(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    node_execution = _make_node_execution(
        id="tool-execution-1",
        node_execution_id="tool-execution-1",
        node_id="tool-node-1",
        node_type="tool",
    )
    repo.get_by_workflow_execution.return_value = [node_execution]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    workflow_span = MagicMock(name="workflow-span")
    workflow_span._context_label = "workflow"
    tool_span = MagicMock(name="tool-span")
    tool_span._context_label = "tool"
    trace_instance.tracer.start_span.side_effect = [workflow_span, tool_span]

    def inject_side_effect(carrier):
        carrier["traceparent"] = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value={}),
        patch.object(trace_instance.propagator, "extract", return_value="root-context"),
        patch.object(trace_instance.propagator, "inject", side_effect=inject_side_effect) as mock_inject,
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace.set_span_in_context",
            side_effect=lambda span: f"context:{span._context_label}",
        ),
    ):
        trace_instance.workflow_trace(info)

    mock_inject.assert_called_once()
    trace_instance._mock_redis_client.setex.assert_called_once_with(
        _phoenix_parent_span_redis_key("tool-execution-1"),
        300,
        '{"traceparent": "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"}',
    )


@pytest.mark.parametrize(
    ("failing_step", "expected_message"),
    [
        ("inject", "inject failed"),
        ("publish", "publish failed"),
    ],
)
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_cleans_up_tool_span_when_parent_context_publish_fails(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
    failing_step,
    expected_message,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    node_execution = _make_node_execution(
        id="tool-execution-1",
        node_execution_id="tool-execution-1",
        node_id="tool-node-1",
        node_type="tool",
    )
    repo.get_by_workflow_execution.return_value = [node_execution]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    workflow_span = MagicMock(name="workflow-span")
    workflow_span._context_label = "workflow"
    tool_span = MagicMock(name="tool-span")
    tool_span._context_label = "tool"
    trace_instance.tracer.start_span.side_effect = [workflow_span, tool_span]

    inject_side_effect = None
    if failing_step == "inject":
        inject_side_effect = RuntimeError(expected_message)
    else:
        trace_instance._mock_redis_client.setex.side_effect = RuntimeError(expected_message)

        def inject_side_effect(carrier):
            carrier["traceparent"] = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value={}),
        patch.object(trace_instance.propagator, "extract", return_value="root-context"),
        patch.object(trace_instance.propagator, "inject", side_effect=inject_side_effect),
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace.set_span_in_context",
            side_effect=lambda span: f"context:{span._context_label}",
        ),
        pytest.raises(RuntimeError, match=expected_message),
    ):
        trace_instance.workflow_trace(info)

    tool_span.end.assert_called_once()
    workflow_span.end.assert_called_once()


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_parents_serial_nodes_to_resolved_predecessor_span(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    second_node = _make_node_execution(
        id="node-execution-2",
        node_execution_id="node-execution-2",
        node_id="node-2",
        node_type="llm",
        predecessor_node_id="node-1",
        process_data={
            "prompts": [{"role": "user", "content": "hi"}],
            "model_provider": "openai",
            "model_name": "gpt-4",
        },
    )
    first_node = _make_node_execution(
        id="node-execution-1",
        node_execution_id="node-execution-1",
        node_id="node-1",
        node_type="tool",
    )
    repo.get_by_workflow_execution.return_value = [second_node, first_node]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    workflow_span = MagicMock(name="workflow-span")
    workflow_span._context_label = "workflow"
    first_node_span = MagicMock(name="first-node-span")
    first_node_span._context_label = "node-1"
    second_node_span = MagicMock(name="second-node-span")
    second_node_span._context_label = "node-2"
    trace_instance.tracer.start_span.side_effect = [workflow_span, first_node_span, second_node_span]

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value={}),
        patch.object(trace_instance.propagator, "extract", return_value="root-context"),
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace.set_span_in_context",
            side_effect=lambda span: f"context:{span._context_label}",
        ),
    ):
        trace_instance.workflow_trace(info)

    first_node_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="tool_Node")
    second_node_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="llm_Node")
    assert first_node_call.kwargs["context"] == "context:workflow"
    assert second_node_call.kwargs["context"] == "context:node-1"


@pytest.mark.parametrize(
    ("enclosing_node_type", "structured_field"),
    [
        ("loop", "loop_id"),
        ("iteration", "iteration_id"),
    ],
)
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_parents_structured_start_nodes_to_enclosing_structure_span(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
    enclosing_node_type,
    structured_field,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    enclosing_node = _make_node_execution(
        id=f"{enclosing_node_type}-execution-1",
        node_execution_id=f"{enclosing_node_type}-execution-1",
        node_id=f"{enclosing_node_type}-node-1",
        node_type=enclosing_node_type,
    )
    structured_kwargs = {structured_field: f"{enclosing_node_type}-node-1"}
    start_node = _make_node_execution(
        id="start-execution-1",
        node_execution_id="start-execution-1",
        node_id="start-node-1",
        node_type="start",
        **structured_kwargs,
    )
    repo.get_by_workflow_execution.return_value = [start_node, enclosing_node]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    workflow_span = MagicMock(name="workflow-span")
    workflow_span._context_label = "workflow"
    enclosing_node_span = MagicMock(name="enclosing-node-span")
    enclosing_node_span._context_label = enclosing_node_type
    start_node_span = MagicMock(name="start-node-span")
    start_node_span._context_label = "start"
    trace_instance.tracer.start_span.side_effect = [workflow_span, enclosing_node_span, start_node_span]

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value={}),
        patch.object(trace_instance.propagator, "extract", return_value="root-context"),
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace.set_span_in_context",
            side_effect=lambda span: f"context:{span._context_label}",
        ),
    ):
        trace_instance.workflow_trace(info)

    start_node_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="start_Node")
    assert start_node_call.kwargs["context"] == f"context:{enclosing_node_type}"


@pytest.mark.parametrize(
    ("enclosing_node_type", "structured_field"),
    [
        ("loop", "loop_id"),
        ("iteration", "iteration_id"),
    ],
)
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_keeps_duplicate_body_node_children_under_enclosing_structure(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
    enclosing_node_type,
    structured_field,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    enclosing_node = _make_node_execution(
        id=f"{enclosing_node_type}-execution-1",
        node_execution_id=f"{enclosing_node_type}-execution-1",
        node_id=f"{enclosing_node_type}-node-1",
        node_type=enclosing_node_type,
    )
    structured_kwargs = {structured_field: f"{enclosing_node_type}-node-1"}
    repeated_body_node_1 = _make_node_execution(
        id="body-execution-1",
        node_execution_id="body-execution-1",
        node_id="body-node-1",
        node_type="tool",
        **structured_kwargs,
    )
    repeated_body_node_2 = _make_node_execution(
        id="body-execution-2",
        node_execution_id="body-execution-2",
        node_id="body-node-1",
        node_type="tool",
        **structured_kwargs,
    )
    child_node = _make_node_execution(
        id="child-execution-1",
        node_execution_id="child-execution-1",
        node_id="child-node-1",
        node_type="llm",
        predecessor_node_id="body-node-1",
        process_data={
            "prompts": [{"role": "user", "content": "hi"}],
            "model_provider": "openai",
            "model_name": "gpt-4",
        },
        **structured_kwargs,
    )
    repo.get_by_workflow_execution.return_value = [
        child_node,
        repeated_body_node_1,
        repeated_body_node_2,
        enclosing_node,
    ]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    workflow_span = MagicMock(name="workflow-span")
    workflow_span._context_label = "workflow"
    enclosing_node_span = MagicMock(name="enclosing-node-span")
    enclosing_node_span._context_label = enclosing_node_type
    child_node_span = MagicMock(name="child-node-span")
    child_node_span._context_label = "child"
    repeated_body_node_1_span = MagicMock(name="repeated-body-node-1-span")
    repeated_body_node_1_span._context_label = "body-1"
    repeated_body_node_2_span = MagicMock(name="repeated-body-node-2-span")
    repeated_body_node_2_span._context_label = "body-2"
    trace_instance.tracer.start_span.side_effect = [
        workflow_span,
        enclosing_node_span,
        child_node_span,
        repeated_body_node_1_span,
        repeated_body_node_2_span,
    ]

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value={}),
        patch.object(trace_instance.propagator, "extract", return_value="root-context"),
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace.set_span_in_context",
            side_effect=lambda span: f"context:{span._context_label}",
        ),
    ):
        trace_instance.workflow_trace(info)

    child_node_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="llm_Node")
    assert child_node_call.kwargs["context"] == f"context:{enclosing_node_type}"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_falls_back_to_workflow_span_for_parallel_like_ambiguous_predecessors(
    mock_sessionmaker, mock_repo_factory, mock_db, trace_instance
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    repo = MagicMock()
    child_node = _make_node_execution(
        id="child-execution-1",
        node_execution_id="child-execution-1",
        node_id="child-node-1",
        node_type="llm",
        predecessor_node_id="parallel-node-1",
        process_data={
            "prompts": [{"role": "user", "content": "hi"}],
            "model_provider": "openai",
            "model_name": "gpt-4",
        },
    )
    first_parallel_node = _make_node_execution(
        id="parallel-execution-1",
        node_execution_id="parallel-execution-1",
        node_id="parallel-node-1",
        node_type="tool",
        parallel_id="parallel-1",
    )
    second_parallel_node = _make_node_execution(
        id="parallel-execution-2",
        node_execution_id="parallel-execution-2",
        node_id="parallel-node-1",
        node_type="tool",
        parallel_id="parallel-2",
    )
    repo.get_by_workflow_execution.return_value = [child_node, first_parallel_node, second_parallel_node]
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo

    workflow_span = MagicMock(name="workflow-span")
    workflow_span._context_label = "workflow"
    child_node_span = MagicMock(name="child-node-span")
    child_node_span._context_label = "child"
    first_parallel_node_span = MagicMock(name="first-parallel-node-span")
    first_parallel_node_span._context_label = "parallel-1"
    second_parallel_node_span = MagicMock(name="second-parallel-node-span")
    second_parallel_node_span._context_label = "parallel-2"
    trace_instance.tracer.start_span.side_effect = [
        workflow_span,
        child_node_span,
        first_parallel_node_span,
        second_parallel_node_span,
    ]

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch.object(trace_instance, "ensure_root_span", return_value={}),
        patch.object(trace_instance.propagator, "extract", return_value="root-context"),
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace.set_span_in_context",
            side_effect=lambda span: f"context:{span._context_label}",
        ),
    ):
        trace_instance.workflow_trace(info)

    child_node_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="llm_Node")
    assert child_node_call.kwargs["context"] == "context:workflow"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
def test_message_trace_keeps_conversation_id_as_session(mock_db, trace_instance):
    mock_db.engine = MagicMock()
    info = _make_message_info()
    info.message_data = MagicMock()
    info.message_data.conversation_id = "conversation-2"
    info.message_data.from_account_id = "acc2"
    info.message_data.from_end_user_id = None
    info.message_data.query = "q2"
    info.message_data.answer = "a2"
    info.message_data.status = "s2"
    info.message_data.model_id = "m2"
    info.message_data.model_provider = "p2"
    info.message_data.message_metadata = "{}"
    info.message_data.error = None
    info.error = None

    root_span = MagicMock()
    message_span = MagicMock()
    llm_span = MagicMock()
    trace_instance.tracer.start_span.side_effect = [root_span, message_span, llm_span]

    trace_instance.message_trace(info)

    message_span_call = _get_start_span_call(
        trace_instance.tracer.start_span, span_name=TraceTaskName.MESSAGE_TRACE.value
    )
    assert message_span_call.kwargs["attributes"][SpanAttributes.SESSION_ID] == "conversation-2"


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
def test_message_trace_with_error(mock_db, trace_instance):
    mock_db.engine = MagicMock()
    info = _make_message_info()
    info.message_data = MagicMock()
    info.message_data.from_account_id = "acc1"
    info.message_data.from_end_user_id = None
    info.message_data.query = "q"
    info.message_data.answer = "a"
    info.message_data.status = "s"
    info.message_data.model_id = "m"
    info.message_data.model_provider = "p"
    info.message_data.message_metadata = "{}"
    info.message_data.error = "processing failed"
    info.error = "message error"

    trace_instance.message_trace(info)
    assert trace_instance.tracer.start_span.call_count >= 1


def test_trace_methods_return_early_with_no_message_data(trace_instance):
    info = MagicMock()
    info.message_data = None

    trace_instance.moderation_trace(info)
    trace_instance.suggested_question_trace(info)
    trace_instance.dataset_retrieval_trace(info)
    trace_instance.tool_trace(info)
    trace_instance.generate_name_trace(info)

    assert trace_instance.tracer.start_span.call_count == 0


def test_moderation_trace_ok(trace_instance):
    info = ModerationTraceInfo(flagged=True, action="a", preset_response="p", query="q", metadata={})
    info.message_data = MagicMock()
    info.message_data.error = None
    trace_instance.moderation_trace(info)
    # root span (1) + moderation span (1) = 2
    assert trace_instance.tracer.start_span.call_count >= 1


def test_suggested_question_trace_ok(trace_instance):
    info = SuggestedQuestionTraceInfo(suggested_question=["?"], total_tokens=1, level="i", metadata={})
    info.message_data = MagicMock()
    info.error = None
    trace_instance.suggested_question_trace(info)
    assert trace_instance.tracer.start_span.call_count >= 1


def test_dataset_retrieval_trace_ok(trace_instance):
    info = DatasetRetrievalTraceInfo(documents=[], metadata={})
    info.message_data = MagicMock()
    info.error = None
    trace_instance.dataset_retrieval_trace(info)
    assert trace_instance.tracer.start_span.call_count >= 1


def test_tool_trace_ok(trace_instance):
    info = ToolTraceInfo(
        tool_name="t", tool_inputs={}, tool_outputs="o", metadata={}, tool_config={}, time_cost=1, tool_parameters={}
    )
    info.message_data = MagicMock()
    info.error = None
    trace_instance.tool_trace(info)
    assert trace_instance.tracer.start_span.call_count >= 1


def test_generate_name_trace_ok(trace_instance):
    info = GenerateNameTraceInfo(tenant_id="t", metadata={})
    info.message_data = MagicMock()
    info.message_data.error = None
    trace_instance.generate_name_trace(info)
    assert trace_instance.tracer.start_span.call_count >= 1


def test_get_project_url_phoenix(trace_instance):
    trace_instance.arize_phoenix_config = PhoenixConfig(endpoint="http://p.com", project="p")
    assert "p.com/projects/" in trace_instance.get_project_url()


def test_set_attribute_none_logic(trace_instance):
    # Test role can be None
    attrs = trace_instance._construct_llm_attributes([{"role": None, "content": "hi"}])
    assert "llm.input_messages.0.message.role" not in attrs

    # Test tool call id can be None
    tool_call_none_id = {"id": None, "function": {"name": "f1"}}
    attrs = trace_instance._construct_llm_attributes([{"role": "assistant", "tool_calls": [tool_call_none_id]}])
    assert "llm.input_messages.0.message.tool_calls.0.tool_call.id" not in attrs


def test_construct_llm_attributes_dict_branch(trace_instance):
    attrs = trace_instance._construct_llm_attributes({"prompt": "hi"})
    assert '"prompt": "hi"' in attrs["llm.input_messages.0.message.content"]
    assert attrs["llm.input_messages.0.message.role"] == "user"


def test_api_check_success(trace_instance):
    assert trace_instance.api_check() is True


def test_ensure_root_span_basic(trace_instance):
    trace_instance.ensure_root_span("tid")
    assert "tid" in trace_instance.dify_trace_ids


def test_ensure_root_span_uses_custom_name_and_attributes(trace_instance):
    root_attributes = {
        SpanAttributes.INPUT_VALUE: '{"input":"value"}',
        SpanAttributes.OUTPUT_VALUE: '{"output":"value"}',
    }

    trace_instance.ensure_root_span("tid", root_span_name="Workflow Name", root_span_attributes=root_attributes)

    trace_instance.tracer.start_span.assert_called_once_with(
        name="Workflow Name",
        attributes={
            SpanAttributes.OPENINFERENCE_SPAN_KIND: "CHAIN",
            "dify_project_name": "p",
            "dify_trace_id": "tid",
            SpanAttributes.INPUT_VALUE: '{"input":"value"}',
            SpanAttributes.OUTPUT_VALUE: '{"output":"value"}',
        },
    )


def test_ensure_root_span_falls_back_to_dify_name_when_custom_name_is_blank(trace_instance):
    trace_instance.ensure_root_span("tid", root_span_name=" ")

    trace_instance.tracer.start_span.assert_called_once()
    assert trace_instance.tracer.start_span.call_args.kwargs["name"] == "Dify"
