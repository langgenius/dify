from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from opentelemetry.sdk.trace import Tracer
from opentelemetry.semconv.trace import SpanAttributes as OTELSpanAttributes
from opentelemetry.trace import StatusCode

from core.ops.arize_phoenix_trace.arize_phoenix_trace import (
    ArizePhoenixDataTrace,
    datetime_to_nanos,
    error_to_string,
    safe_json_dumps,
    set_span_status,
    setup_tracer,
    wrap_span_metadata,
)
from core.ops.entities.config_entity import ArizeConfig, PhoenixConfig
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

    with patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.datetime") as mock_dt:
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
    set_span_status(span, SilentError())
    assert span.add_event.call_args[1]["attributes"][OTELSpanAttributes.EXCEPTION_MESSAGE] == "SilentErrorRepr"


def test_safe_json_dumps():
    assert safe_json_dumps({"a": _dt()}) == '{"a": "2024-01-01 00:00:00+00:00"}'


def test_wrap_span_metadata():
    res = wrap_span_metadata({"a": 1}, b=2)
    assert res == {"a": 1, "b": 2, "created_from": "Dify"}


@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.GrpcOTLPSpanExporter")
@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.trace_sdk.TracerProvider")
def test_setup_tracer_arize(mock_provider, mock_exporter):
    config = ArizeConfig(endpoint="http://a.com", api_key="k", space_id="s", project="p")
    setup_tracer(config)
    mock_exporter.assert_called_once()
    assert mock_exporter.call_args[1]["endpoint"] == "http://a.com/v1"


@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.HttpOTLPSpanExporter")
@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.trace_sdk.TracerProvider")
def test_setup_tracer_phoenix(mock_provider, mock_exporter):
    config = PhoenixConfig(endpoint="http://p.com", project="p")
    setup_tracer(config)
    mock_exporter.assert_called_once()
    assert mock_exporter.call_args[1]["endpoint"] == "http://p.com/v1/traces"


def test_setup_tracer_exception():
    config = ArizeConfig(endpoint="http://a.com", project="p")
    with patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.urlparse", side_effect=Exception("boom")):
        with pytest.raises(Exception, match="boom"):
            setup_tracer(config)


# --- ArizePhoenixDataTrace Class Tests ---


@pytest.fixture
def trace_instance():
    with patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.setup_tracer") as mock_setup:
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


@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.sessionmaker")
@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.db")
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


@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.db")
def test_workflow_trace_no_app_id(mock_db, trace_instance):
    mock_db.engine = MagicMock()
    info = _make_workflow_info()
    info.metadata = {}
    with pytest.raises(ValueError, match="No app_id found in trace_info metadata"):
        trace_instance.workflow_trace(info)


@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.db")
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


@patch("core.ops.arize_phoenix_trace.arize_phoenix_trace.db")
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
