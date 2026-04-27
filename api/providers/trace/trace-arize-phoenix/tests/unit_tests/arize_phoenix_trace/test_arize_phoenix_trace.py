from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import (
    ArizePhoenixDataTrace,
    datetime_to_nanos,
    error_to_string,
    safe_json_dumps,
    set_span_status,
    setup_tracer,
    string_to_span_id64,
    string_to_trace_id128,
    wrap_span_metadata,
)
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from opentelemetry import trace
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
    WorkflowTraceInfo,
)

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
    with patch("dify_trace_arize_phoenix.arize_phoenix_trace.setup_tracer") as mock_setup:
        mock_tracer = MagicMock(spec=Tracer)
        mock_processor = MagicMock()
        mock_setup.return_value = (mock_tracer, mock_processor)
        config = ArizeConfig(endpoint="http://a.com", api_key="k", space_id="s", project="p")
        return ArizePhoenixDataTrace(config)


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


def test_workflow_trace_full(trace_instance):
    info = _make_workflow_info()
    workflow_span = MagicMock()
    llm_span = MagicMock()
    trace_instance.tracer.start_span.side_effect = [workflow_span, llm_span]
    trace_instance._get_app_info_from_workflow_run_id = MagicMock(return_value={"app_id": "app1", "app_name": "Demo"})
    trace_instance._get_parent_workflow_context = MagicMock(return_value=None)
    trace_instance._get_workflow_graph = MagicMock(return_value=None)

    node1 = MagicMock()
    node1.node_type = "llm"
    node1.status = "succeeded"
    node1.inputs = '{"q": "hi"}'
    node1.outputs = '{"a": "bye", "usage": {"total_tokens": 5}}'
    node1.created_at = _dt()
    node1.elapsed_time = 1.0
    node1.process_data = '{"prompts":[{"role":"user","content":"hi"}],"model_provider":"openai","model_name":"gpt-4"}'
    node1.execution_metadata = "{}"
    node1.title = "title"
    node1.id = "n1"
    node1.node_id = "n1"
    node1.index = 1
    node1.predecessor_node_id = None
    node1.error = None
    node1.tenant_id = "t1"
    node1.app_id = "app1"

    trace_instance._get_workflow_nodes = MagicMock(return_value=[node1])

    trace_instance.workflow_trace(info)

    assert trace_instance.tracer.start_span.call_count == 2


def test_workflow_trace_uses_parent_tool_span_context_for_child_workflow(trace_instance):
    parent_span_context = MagicMock(trace_id=123, span_id=456)
    parent_tool_span = MagicMock()
    parent_tool_span.get_span_context.return_value = parent_span_context
    workflow_span = MagicMock()
    trace_instance.tracer.start_span.return_value = workflow_span
    trace_instance._get_app_info_from_workflow_run_id = MagicMock(
        return_value={"app_id": "app1", "app_name": "Child App"}
    )
    trace_instance._get_parent_workflow_context = MagicMock(
        return_value={
            "trace_id": 123,
            "parent_span_context": parent_span_context,
            "workflow_tool_name": "Workflow Tool",
        }
    )
    trace_instance._get_workflow_nodes = MagicMock(return_value=[])
    trace_instance._get_workflow_graph = MagicMock(return_value=None)

    trace_instance.workflow_trace(_make_workflow_info(workflow_run_id="child-run"))

    start_call = trace_instance.tracer.start_span.call_args
    current_parent = trace.get_current_span(start_call.kwargs["context"]).get_span_context()
    assert current_parent.trace_id == parent_span_context.trace_id
    assert current_parent.span_id == parent_span_context.span_id


def test_workflow_trace_uses_deterministic_workflow_context_for_root_trace(trace_instance):
    workflow_span = MagicMock()
    trace_instance.tracer.start_span.return_value = workflow_span
    trace_instance._get_app_info_from_workflow_run_id = MagicMock(return_value={"app_id": "app1", "app_name": "Demo"})
    trace_instance._get_parent_workflow_context = MagicMock(return_value=None)
    trace_instance._get_workflow_nodes = MagicMock(return_value=[])
    trace_instance._get_workflow_graph = MagicMock(return_value=None)

    info = _make_workflow_info(workflow_run_id="root-run")
    trace_instance.workflow_trace(info)

    start_call = trace_instance.tracer.start_span.call_args
    current_parent = trace.get_current_span(start_call.kwargs["context"]).get_span_context()
    assert current_parent.trace_id == string_to_trace_id128("root-run")
    assert current_parent.span_id == string_to_span_id64("root-run")


def test_workflow_trace_uses_parent_trace_context_metadata_when_cached_parent_is_missing(trace_instance):
    workflow_span = MagicMock()
    trace_instance.tracer.start_span.return_value = workflow_span
    trace_instance._get_app_info_from_workflow_run_id = MagicMock(
        return_value={"app_id": "app1", "app_name": "Child App"}
    )
    trace_instance._get_workflow_nodes = MagicMock(return_value=[])
    trace_instance._get_workflow_graph = MagicMock(return_value=None)

    info = _make_workflow_info(
        workflow_run_id="child-run",
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "parent-run",
                "parent_node_execution_id": "parent-node-exec",
            },
        },
    )
    trace_instance.workflow_trace(info)

    start_call = trace_instance.tracer.start_span.call_args
    current_parent = trace.get_current_span(start_call.kwargs["context"]).get_span_context()
    assert current_parent.trace_id == string_to_trace_id128("parent-run")
    assert current_parent.span_id == string_to_span_id64("parent-node-exec")


def test_get_parent_workflow_context_uses_cached_parent_span_context(trace_instance):
    parent_span_context = MagicMock(trace_id=321, span_id=654)
    trace_instance.child_workflow_parent_contexts["child-run"] = {
        "trace_id": 321,
        "parent_span_context": parent_span_context,
        "workflow_tool_name": "Workflow Tool",
    }

    context = trace_instance._get_parent_workflow_context(_make_workflow_info(workflow_run_id="child-run"))

    assert context["parent_span_context"] is parent_span_context


def test_get_parent_workflow_context_builds_synthetic_parent_context_from_metadata(trace_instance):
    context = trace_instance._get_parent_workflow_context(
        _make_workflow_info(
            workflow_run_id="child-run",
            metadata={
                "app_id": "app1",
                "parent_trace_context": {
                    "parent_workflow_run_id": "outer-run",
                    "parent_node_execution_id": "outer-node",
                },
            },
        )
    )

    parent_span_context = context["parent_span_context"]
    assert parent_span_context.trace_id == string_to_trace_id128("outer-run")
    assert parent_span_context.span_id == string_to_span_id64("outer-node")


@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
def test_message_trace_success(mock_db, trace_instance):
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
    info.message_data.error = None
    info.error = None

    trace_instance.message_trace(info)
    assert trace_instance.tracer.start_span.call_count >= 1


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
    info.message_data.status = "succeeded"
    trace_instance.moderation_trace(info)
    # root span (1) + moderation span (1) = 2
    assert trace_instance.tracer.start_span.call_count >= 1


def test_suggested_question_trace_ok(trace_instance):
    info = SuggestedQuestionTraceInfo(suggested_question=["?"], total_tokens=1, level="i", metadata={})
    info.message_data = MagicMock()
    info.error = None
    info.message_data.created_at = _dt()
    info.message_data.updated_at = _dt()
    trace_instance.suggested_question_trace(info)
    assert trace_instance.tracer.start_span.call_count >= 1


def test_dataset_retrieval_trace_ok(trace_instance):
    info = DatasetRetrievalTraceInfo(documents=[], metadata={})
    info.message_data = MagicMock()
    info.error = None
    info.message_data.status = "succeeded"
    info.message_data.error = None
    info.message_data.created_at = _dt()
    info.message_data.updated_at = _dt()
    info.message_data.model_provider = "provider"
    info.message_data.model_id = "model"
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
    info.message_data.status = "succeeded"
    info.message_data.conversation_id = "conversation-1"
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


def test_find_logical_parent_span_uses_matching_node_context_keys(trace_instance):
    parent_span = MagicMock()
    child_execution = MagicMock()
    child_execution.id = "exec-child"
    child_execution.node_id = "child-node"
    child_execution.index = 3

    logical_parent = trace_instance._find_logical_parent_span(
        child_execution,
        node_spans={"parent-node": parent_span},
        execution_context={
            "parent-node": {
                "index": 1,
                "node_type": "tool",
                "status": "succeeded",
                "created_at": _dt(),
            }
        },
    )

    assert logical_parent is parent_span


def test_workflow_trace_keeps_same_workflow_nodes_as_flat_siblings(trace_instance):
    workflow_span = MagicMock()
    start_node_span = MagicMock()
    tool_node_span = MagicMock()
    trace_instance.tracer.start_span.side_effect = [workflow_span, start_node_span, tool_node_span]
    trace_instance._get_app_info_from_workflow_run_id = MagicMock(return_value={"app_id": "app1", "app_name": "Demo"})
    trace_instance._get_parent_workflow_context = MagicMock(return_value=None)
    trace_instance._get_workflow_graph = MagicMock(
        return_value={
            "nodes": [{"id": "start-node"}, {"id": "tool-node"}],
            "edges": [{"source": "start-node", "target": "tool-node"}],
        }
    )

    start_node = MagicMock()
    start_node.node_type = "start"
    start_node.status = "succeeded"
    start_node.inputs = "{}"
    start_node.outputs = "{}"
    start_node.created_at = _dt()
    start_node.elapsed_time = 0.1
    start_node.process_data = "{}"
    start_node.execution_metadata = "{}"
    start_node.title = "Start"
    start_node.id = "exec-start"
    start_node.node_id = "start-node"
    start_node.index = 1
    start_node.predecessor_node_id = None
    start_node.error = None
    start_node.tenant_id = "t1"
    start_node.app_id = "app1"

    tool_node = MagicMock()
    tool_node.node_type = "tool"
    tool_node.status = "succeeded"
    tool_node.inputs = "{}"
    tool_node.outputs = "{}"
    tool_node.created_at = _dt()
    tool_node.elapsed_time = 0.2
    tool_node.process_data = "{}"
    tool_node.execution_metadata = "{}"
    tool_node.title = "Tool"
    tool_node.id = "exec-tool"
    tool_node.node_id = "tool-node"
    tool_node.index = 2
    tool_node.predecessor_node_id = "start-node"
    tool_node.error = None
    tool_node.tenant_id = "t1"
    tool_node.app_id = "app1"

    trace_instance._get_workflow_nodes = MagicMock(return_value=[start_node, tool_node])

    trace_instance.workflow_trace(_make_workflow_info(workflow_run_id="root-run"))

    start_call = trace_instance.tracer.start_span.call_args_list[1]
    tool_call = trace_instance.tracer.start_span.call_args_list[2]
    assert start_call.kwargs["context"] == tool_call.kwargs["context"]


def test_find_parent_workflow_tool_rejects_timing_only_match(trace_instance):
    workflow_tool = MagicMock()
    workflow_tool.name = "Workflow Tool"
    workflow_tool.app_id = "app-child"
    child_run = MagicMock(created_at=_dt(), workflow_id="wf-child", tenant_id="tenant-1", app_id="app-child")
    unrelated_tool = MagicMock(
        id="tool-1",
        workflow_run_id="parent-run",
        created_at=_dt() - timedelta(seconds=2),
        inputs="{}",
        outputs='{"status": "started"}',
        process_data='{"tool_provider": "workflow"}',
        tenant_id="tenant-1",
    )

    trace_instance._get_workflow_app_id = MagicMock(return_value="app-child")
    trace_instance._get_app_info_from_workflow_run_id = MagicMock(return_value={"app_name": "Parent App"})

    child_run_result = MagicMock()
    child_run_result.scalars.return_value.first.return_value = child_run
    workflow_tool_result = MagicMock()
    workflow_tool_result.scalars.return_value.first.return_value = workflow_tool
    candidate_result = MagicMock()
    candidate_result.scalars.return_value.all.return_value = [unrelated_tool]

    with patch(
        "dify_trace_arize_phoenix.arize_phoenix_trace.db.session.execute",
        side_effect=[child_run_result, workflow_tool_result, candidate_result],
    ):
        result = trace_instance._find_parent_workflow_tool("child-run")

    assert result is None


def test_find_parent_workflow_tool_accepts_verified_lineage(trace_instance):
    workflow_tool = MagicMock()
    workflow_tool.name = "Workflow Tool"
    workflow_tool.app_id = "app-child"
    child_run = MagicMock(created_at=_dt(), workflow_id="wf-child", tenant_id="tenant-1", app_id="app-child")
    tool_node = MagicMock(
        id="tool-1",
        workflow_run_id="parent-run",
        created_at=_dt() - timedelta(seconds=1),
        inputs='{"app_id": "app-child"}',
        outputs='{"workflow_run_id": "child-run"}',
        process_data='{"tool_name": "Workflow Tool"}',
        tenant_id="tenant-1",
    )
    trace_instance._get_workflow_app_id = MagicMock(return_value="app-child")
    trace_instance._get_app_info_from_workflow_run_id = MagicMock(return_value={"app_name": "Parent App"})

    child_run_result = MagicMock()
    child_run_result.scalars.return_value.first.return_value = child_run
    workflow_tool_result = MagicMock()
    workflow_tool_result.scalars.return_value.first.return_value = workflow_tool
    candidate_result = MagicMock()
    candidate_result.scalars.return_value.all.return_value = [tool_node]

    with patch(
        "dify_trace_arize_phoenix.arize_phoenix_trace.db.session.execute",
        side_effect=[child_run_result, workflow_tool_result, candidate_result],
    ):
        result = trace_instance._find_parent_workflow_tool("child-run")

    assert result is not None
    assert result["parent_workflow_run_id"] == "parent-run"


def test_find_child_workflow_by_timing_does_not_claim_unverified_candidate(trace_instance):
    tool_node = MagicMock(
        id="tool-1",
        workflow_run_id="parent-run",
        created_at=_dt(),
        outputs="{}",
        process_data='{"app_id": "app-child"}',
        inputs="{}",
        tenant_id="tenant-1",
    )
    unrelated_child = MagicMock(id="child-a", created_at=_dt() + timedelta(seconds=1), app_id="app-child")
    related_child = MagicMock(id="child-b", created_at=_dt() + timedelta(seconds=2), app_id="app-child")

    first_result = MagicMock()
    first_result.scalars.return_value.all.return_value = [unrelated_child, related_child]
    second_result = MagicMock()
    second_result.scalars.return_value.all.return_value = []

    with patch(
        "dify_trace_arize_phoenix.arize_phoenix_trace.db.session.execute", side_effect=[first_result, second_result]
    ):
        with patch.object(
            trace_instance,
            "_workflow_run_matches_tool_lineage",
            side_effect=[False, True],
        ):
            result = trace_instance._find_child_workflow_by_timing(tool_node)

    assert result == "child-b"
