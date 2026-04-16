from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from opentelemetry.trace import Link, SpanContext, SpanKind, Status, StatusCode, TraceFlags

import core.ops.aliyun_trace.aliyun_trace as aliyun_trace_module
from core.ops.aliyun_trace.aliyun_trace import AliyunDataTrace
from core.ops.aliyun_trace.entities.semconv import (
    GEN_AI_COMPLETION,
    GEN_AI_INPUT_MESSAGE,
    GEN_AI_OUTPUT_MESSAGE,
    GEN_AI_PROMPT,
    GEN_AI_REQUEST_MODEL,
    GEN_AI_RESPONSE_FINISH_REASON,
    GEN_AI_USAGE_TOTAL_TOKENS,
    RETRIEVAL_DOCUMENT,
    RETRIEVAL_QUERY,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_PARAMETERS,
    GenAISpanKind,
)
from core.ops.entities.config_entity import AliyunConfig
from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)


class RecordingTraceClient:
    def __init__(self, service_name: str = "service", endpoint: str = "endpoint"):
        self.service_name = service_name
        self.endpoint = endpoint
        self.added_spans: list[object] = []

    def add_span(self, span) -> None:
        self.added_spans.append(span)

    def api_check(self) -> bool:
        return True

    def get_project_url(self) -> str:
        return "project-url"


def _dt() -> datetime:
    return datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)


def _make_link(trace_id: int = 1, span_id: int = 2) -> Link:
    context = SpanContext(
        trace_id=trace_id,
        span_id=span_id,
        is_remote=False,
        trace_flags=TraceFlags.SAMPLED,
    )
    return Link(context)


def _make_workflow_trace_info(**overrides) -> WorkflowTraceInfo:
    defaults = {
        "workflow_id": "workflow-id",
        "tenant_id": "tenant-id",
        "workflow_run_id": "00000000-0000-0000-0000-000000000001",
        "workflow_run_elapsed_time": 1.0,
        "workflow_run_status": "succeeded",
        "workflow_run_inputs": {"sys.query": "hello"},
        "workflow_run_outputs": {"answer": "world"},
        "workflow_run_version": "v1",
        "total_tokens": 1,
        "file_list": [],
        "query": "hello",
        "metadata": {"conversation_id": "conv", "user_id": "u", "app_id": "app"},
        "message_id": None,
        "start_time": _dt(),
        "end_time": _dt(),
        "trace_id": "550e8400-e29b-41d4-a716-446655440000",
    }
    defaults.update(overrides)
    return WorkflowTraceInfo(**defaults)


def _make_message_trace_info(**overrides) -> MessageTraceInfo:
    defaults = {
        "conversation_model": "chat",
        "message_tokens": 1,
        "answer_tokens": 2,
        "total_tokens": 3,
        "conversation_mode": "chat",
        "metadata": {"conversation_id": "conv", "ls_model_name": "m", "ls_provider": "p"},
        "message_id": "00000000-0000-0000-0000-000000000002",
        "message_data": SimpleNamespace(from_account_id="acc", from_end_user_id=None),
        "inputs": {"prompt": "hi"},
        "outputs": "ok",
        "start_time": _dt(),
        "end_time": _dt(),
        "error": None,
        "trace_id": "550e8400-e29b-41d4-a716-446655440000",
    }
    defaults.update(overrides)
    return MessageTraceInfo(**defaults)


def _make_dataset_retrieval_trace_info(**overrides) -> DatasetRetrievalTraceInfo:
    defaults = {
        "metadata": {"conversation_id": "conv", "user_id": "u"},
        "message_id": "00000000-0000-0000-0000-000000000003",
        "message_data": SimpleNamespace(),
        "inputs": "q",
        "documents": [SimpleNamespace()],
        "start_time": _dt(),
        "end_time": _dt(),
        "trace_id": "550e8400-e29b-41d4-a716-446655440000",
    }
    defaults.update(overrides)
    return DatasetRetrievalTraceInfo(**defaults)


def _make_tool_trace_info(**overrides) -> ToolTraceInfo:
    defaults = {
        "tool_name": "tool",
        "tool_inputs": {"x": 1},
        "tool_outputs": "out",
        "tool_config": {"desc": "d"},
        "tool_parameters": {},
        "time_cost": 0.1,
        "metadata": {"conversation_id": "conv", "user_id": "u"},
        "message_id": "00000000-0000-0000-0000-000000000004",
        "message_data": SimpleNamespace(),
        "inputs": {"i": "v"},
        "outputs": {"o": "v"},
        "start_time": _dt(),
        "end_time": _dt(),
        "error": None,
        "trace_id": "550e8400-e29b-41d4-a716-446655440000",
    }
    defaults.update(overrides)
    return ToolTraceInfo(**defaults)


def _make_suggested_question_trace_info(**overrides) -> SuggestedQuestionTraceInfo:
    defaults = {
        "suggested_question": ["q1", "q2"],
        "level": "info",
        "total_tokens": 1,
        "metadata": {"conversation_id": "conv", "user_id": "u", "ls_model_name": "m", "ls_provider": "p"},
        "message_id": "00000000-0000-0000-0000-000000000005",
        "inputs": {"i": 1},
        "start_time": _dt(),
        "end_time": _dt(),
        "error": None,
        "trace_id": "550e8400-e29b-41d4-a716-446655440000",
    }
    defaults.update(overrides)
    return SuggestedQuestionTraceInfo(**defaults)


@pytest.fixture
def trace_instance(monkeypatch: pytest.MonkeyPatch) -> AliyunDataTrace:
    monkeypatch.setattr(aliyun_trace_module, "build_endpoint", lambda base_url, license_key: "built-endpoint")
    monkeypatch.setattr(aliyun_trace_module, "TraceClient", RecordingTraceClient)
    # Mock get_service_account_with_tenant to avoid DB errors
    monkeypatch.setattr(AliyunDataTrace, "get_service_account_with_tenant", lambda self, app_id: MagicMock())

    config = AliyunConfig(app_name="app", license_key="k", endpoint="https://example.com")
    trace = AliyunDataTrace(config)
    return trace


def test_init_builds_endpoint_and_client(monkeypatch: pytest.MonkeyPatch):
    build_endpoint = MagicMock(return_value="built")
    trace_client_cls = MagicMock()
    monkeypatch.setattr(aliyun_trace_module, "build_endpoint", build_endpoint)
    monkeypatch.setattr(aliyun_trace_module, "TraceClient", trace_client_cls)

    config = AliyunConfig(app_name="my-app", license_key="license", endpoint="https://example.com")
    trace = AliyunDataTrace(config)

    build_endpoint.assert_called_once_with("https://example.com", "license")
    trace_client_cls.assert_called_once_with(service_name="my-app", endpoint="built")
    assert trace.trace_config == config


def test_trace_dispatches_to_correct_methods(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    workflow_trace = MagicMock()
    message_trace = MagicMock()
    suggested_question_trace = MagicMock()
    dataset_retrieval_trace = MagicMock()
    tool_trace = MagicMock()
    monkeypatch.setattr(trace_instance, "workflow_trace", workflow_trace)
    monkeypatch.setattr(trace_instance, "message_trace", message_trace)
    monkeypatch.setattr(trace_instance, "suggested_question_trace", suggested_question_trace)
    monkeypatch.setattr(trace_instance, "dataset_retrieval_trace", dataset_retrieval_trace)
    monkeypatch.setattr(trace_instance, "tool_trace", tool_trace)

    trace_instance.trace(_make_workflow_trace_info())
    workflow_trace.assert_called_once()

    trace_instance.trace(_make_message_trace_info())
    message_trace.assert_called_once()

    trace_instance.trace(_make_suggested_question_trace_info())
    suggested_question_trace.assert_called_once()

    trace_instance.trace(_make_dataset_retrieval_trace_info())
    dataset_retrieval_trace.assert_called_once()

    trace_instance.trace(_make_tool_trace_info())
    tool_trace.assert_called_once()

    # Branches that do nothing but should be covered
    trace_instance.trace(ModerationTraceInfo(flagged=False, action="allow", preset_response="", query="", metadata={}))
    trace_instance.trace(GenerateNameTraceInfo(tenant_id="t", metadata={}))


def test_api_check_delegates(trace_instance: AliyunDataTrace):
    trace_instance.trace_client.api_check = MagicMock(return_value=False)
    assert trace_instance.api_check() is False


def test_get_project_url_success(trace_instance: AliyunDataTrace):
    assert trace_instance.get_project_url() == "project-url"


def test_get_project_url_error(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(trace_instance.trace_client, "get_project_url", MagicMock(side_effect=Exception("boom")))
    logger_mock = MagicMock()
    monkeypatch.setattr(aliyun_trace_module, "logger", logger_mock)

    with pytest.raises(ValueError, match=r"Aliyun get project url failed: boom"):
        trace_instance.get_project_url()
    logger_mock.info.assert_called()


def test_workflow_trace_adds_workflow_and_node_spans(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_trace_id", lambda _: 111)
    monkeypatch.setattr(
        aliyun_trace_module, "convert_to_span_id", lambda _, span_type: {"workflow": 222}.get(span_type, 0)
    )
    monkeypatch.setattr(aliyun_trace_module, "create_links_from_trace_id", lambda _: [])

    add_workflow_span = MagicMock()
    get_workflow_node_executions = MagicMock(return_value=[MagicMock(), MagicMock()])
    build_workflow_node_span = MagicMock(side_effect=["span-1", "span-2"])
    monkeypatch.setattr(trace_instance, "add_workflow_span", add_workflow_span)
    monkeypatch.setattr(trace_instance, "get_workflow_node_executions", get_workflow_node_executions)
    monkeypatch.setattr(trace_instance, "build_workflow_node_span", build_workflow_node_span)

    trace_info = _make_workflow_trace_info(
        trace_id="abcd", metadata={"conversation_id": "c", "user_id": "u", "app_id": "app"}
    )
    trace_instance.workflow_trace(trace_info)

    add_workflow_span.assert_called_once()
    passed_trace_metadata = add_workflow_span.call_args.args[1]
    assert passed_trace_metadata.trace_id == 111
    assert passed_trace_metadata.workflow_span_id == 222
    assert passed_trace_metadata.session_id == "c"
    assert passed_trace_metadata.user_id == "u"
    assert passed_trace_metadata.links == []

    assert trace_instance.trace_client.added_spans == ["span-1", "span-2"]


def test_message_trace_returns_early_if_no_message_data(trace_instance: AliyunDataTrace):
    trace_info = _make_message_trace_info(message_data=None)
    trace_instance.message_trace(trace_info)
    assert trace_instance.trace_client.added_spans == []


def test_message_trace_creates_message_and_llm_spans(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_trace_id", lambda _: 10)
    monkeypatch.setattr(
        aliyun_trace_module,
        "convert_to_span_id",
        lambda _, span_type: {"message": 20, "llm": 30}.get(span_type, 0),
    )
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    monkeypatch.setattr(aliyun_trace_module, "get_user_id_from_message_data", lambda _: "user")
    monkeypatch.setattr(aliyun_trace_module, "create_links_from_trace_id", lambda _: [])

    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "create_status_from_error", lambda _: status)

    trace_info = _make_message_trace_info(
        metadata={"conversation_id": "conv", "ls_model_name": "model", "ls_provider": "provider"},
        message_tokens=7,
        answer_tokens=11,
        total_tokens=18,
        outputs="completion",
    )
    trace_instance.message_trace(trace_info)

    assert len(trace_instance.trace_client.added_spans) == 2
    message_span, llm_span = trace_instance.trace_client.added_spans

    assert message_span.name == "message"
    assert message_span.trace_id == 10
    assert message_span.parent_span_id is None
    assert message_span.span_id == 20
    assert message_span.span_kind == SpanKind.SERVER
    assert message_span.status == status
    assert message_span.attributes["gen_ai.span.kind"] == GenAISpanKind.CHAIN

    assert llm_span.name == "llm"
    assert llm_span.parent_span_id == 20
    assert llm_span.span_id == 30
    assert llm_span.status == status
    assert llm_span.attributes[GEN_AI_REQUEST_MODEL] == "model"
    assert llm_span.attributes[GEN_AI_USAGE_TOTAL_TOKENS] == "18"


def test_dataset_retrieval_trace_returns_early_if_no_message_data(trace_instance: AliyunDataTrace):
    trace_info = _make_dataset_retrieval_trace_info(message_data=None)
    trace_instance.dataset_retrieval_trace(trace_info)
    assert trace_instance.trace_client.added_spans == []


def test_dataset_retrieval_trace_creates_span(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_trace_id", lambda _: 1)
    monkeypatch.setattr(
        aliyun_trace_module, "convert_to_span_id", lambda _, span_type: {"message": 2}.get(span_type, 0)
    )
    monkeypatch.setattr(aliyun_trace_module, "generate_span_id", lambda: 3)
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    monkeypatch.setattr(aliyun_trace_module, "create_links_from_trace_id", lambda _: [])
    monkeypatch.setattr(aliyun_trace_module, "extract_retrieval_documents", lambda _: [{"doc": "d"}])

    trace_instance.dataset_retrieval_trace(_make_dataset_retrieval_trace_info(inputs="query"))
    assert len(trace_instance.trace_client.added_spans) == 1
    span = trace_instance.trace_client.added_spans[0]
    assert span.name == "dataset_retrieval"
    assert span.attributes[RETRIEVAL_QUERY] == "query"
    assert span.attributes[RETRIEVAL_DOCUMENT] == '[{"doc": "d"}]'


def test_tool_trace_returns_early_if_no_message_data(trace_instance: AliyunDataTrace):
    trace_info = _make_tool_trace_info(message_data=None)
    trace_instance.tool_trace(trace_info)
    assert trace_instance.trace_client.added_spans == []


def test_tool_trace_creates_span(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_trace_id", lambda _: 10)
    monkeypatch.setattr(
        aliyun_trace_module, "convert_to_span_id", lambda _, span_type: {"message": 20}.get(span_type, 0)
    )
    monkeypatch.setattr(aliyun_trace_module, "generate_span_id", lambda: 30)
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    monkeypatch.setattr(aliyun_trace_module, "create_links_from_trace_id", lambda _: [])
    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "create_status_from_error", lambda _: status)

    trace_instance.tool_trace(
        _make_tool_trace_info(
            tool_name="my-tool",
            tool_inputs={"a": 1},
            tool_config={"description": "x"},
            inputs={"i": 1},
        )
    )

    assert len(trace_instance.trace_client.added_spans) == 1
    span = trace_instance.trace_client.added_spans[0]
    assert span.name == "my-tool"
    assert span.status == status
    assert span.attributes[TOOL_NAME] == "my-tool"
    assert span.attributes[TOOL_DESCRIPTION] == '{"description": "x"}'


def test_get_workflow_node_executions_requires_app_id(trace_instance: AliyunDataTrace):
    trace_info = _make_workflow_trace_info(metadata={"conversation_id": "c"})
    with pytest.raises(ValueError, match="No app_id found in trace_info metadata"):
        trace_instance.get_workflow_node_executions(trace_info)


def test_get_workflow_node_executions_builds_repo_and_fetches(
    trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch
):
    trace_info = _make_workflow_trace_info(metadata={"app_id": "app", "conversation_id": "c", "user_id": "u"})

    account = object()
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", MagicMock(return_value=account))
    monkeypatch.setattr(aliyun_trace_module, "sessionmaker", MagicMock())
    monkeypatch.setattr(aliyun_trace_module, "db", SimpleNamespace(engine="engine"))

    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = ["node1"]
    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr(aliyun_trace_module, "DifyCoreRepositoryFactory", mock_factory)

    result = trace_instance.get_workflow_node_executions(trace_info)
    assert result == ["node1"]
    repo.get_by_workflow_execution.assert_called_once_with(workflow_execution_id=trace_info.workflow_run_id)


def test_build_workflow_node_span_routes_llm_type(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    trace_info = _make_workflow_trace_info()
    trace_metadata = MagicMock()

    monkeypatch.setattr(trace_instance, "build_workflow_llm_span", MagicMock(return_value="llm"))

    node_execution.node_type = BuiltinNodeTypes.LLM
    assert trace_instance.build_workflow_node_span(node_execution, trace_info, trace_metadata) == "llm"


def test_build_workflow_node_span_routes_knowledge_retrieval_type(
    trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch
):
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    trace_info = _make_workflow_trace_info()
    trace_metadata = MagicMock()

    monkeypatch.setattr(trace_instance, "build_workflow_retrieval_span", MagicMock(return_value="retrieval"))

    node_execution.node_type = BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL
    assert trace_instance.build_workflow_node_span(node_execution, trace_info, trace_metadata) == "retrieval"


def test_build_workflow_node_span_routes_tool_type(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    trace_info = _make_workflow_trace_info()
    trace_metadata = MagicMock()

    monkeypatch.setattr(trace_instance, "build_workflow_tool_span", MagicMock(return_value="tool"))

    node_execution.node_type = BuiltinNodeTypes.TOOL
    assert trace_instance.build_workflow_node_span(node_execution, trace_info, trace_metadata) == "tool"


def test_build_workflow_node_span_routes_code_type(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    trace_info = _make_workflow_trace_info()
    trace_metadata = MagicMock()

    monkeypatch.setattr(trace_instance, "build_workflow_task_span", MagicMock(return_value="task"))

    node_execution.node_type = BuiltinNodeTypes.CODE
    assert trace_instance.build_workflow_node_span(node_execution, trace_info, trace_metadata) == "task"


def test_build_workflow_node_span_handles_errors(
    trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    trace_info = _make_workflow_trace_info()
    trace_metadata = MagicMock()

    monkeypatch.setattr(trace_instance, "build_workflow_task_span", MagicMock(side_effect=RuntimeError("boom")))
    node_execution.node_type = BuiltinNodeTypes.CODE

    assert trace_instance.build_workflow_node_span(node_execution, trace_info, trace_metadata) is None
    assert "Error occurred in build_workflow_node_span" in caplog.text


def test_build_workflow_task_span(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_span_id", lambda _, __: 9)
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "get_workflow_node_status", lambda _: status)

    trace_metadata = SimpleNamespace(trace_id=1, workflow_span_id=2, session_id="s", user_id="u", links=[])
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    node_execution.id = "node-id"
    node_execution.title = "title"
    node_execution.inputs = {"a": 1}
    node_execution.outputs = {"b": 2}
    node_execution.created_at = _dt()
    node_execution.finished_at = _dt()

    span = trace_instance.build_workflow_task_span(_make_workflow_trace_info(), node_execution, trace_metadata)
    assert span.trace_id == 1
    assert span.span_id == 9
    assert span.status.status_code == StatusCode.OK
    assert span.attributes["gen_ai.span.kind"] == GenAISpanKind.TASK


def test_build_workflow_tool_span(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_span_id", lambda _, __: 9)
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "get_workflow_node_status", lambda _: status)

    trace_metadata = SimpleNamespace(trace_id=1, workflow_span_id=2, session_id="s", user_id="u", links=[_make_link()])
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    node_execution.id = "node-id"
    node_execution.title = "my-tool"
    node_execution.inputs = {"a": 1}
    node_execution.outputs = {"b": 2}
    node_execution.created_at = _dt()
    node_execution.finished_at = _dt()
    node_execution.metadata = {WorkflowNodeExecutionMetadataKey.TOOL_INFO: {"k": "v"}}

    span = trace_instance.build_workflow_tool_span(_make_workflow_trace_info(), node_execution, trace_metadata)
    assert span.attributes[TOOL_NAME] == "my-tool"
    assert span.attributes[TOOL_DESCRIPTION] == '{"k": "v"}'
    assert span.attributes[TOOL_PARAMETERS] == '{"a": 1}'
    assert span.status.status_code == StatusCode.OK

    # Cover metadata is None and inputs is None
    node_execution.metadata = None
    node_execution.inputs = None
    span2 = trace_instance.build_workflow_tool_span(_make_workflow_trace_info(), node_execution, trace_metadata)
    assert span2.attributes[TOOL_DESCRIPTION] == "{}"
    assert span2.attributes[TOOL_PARAMETERS] == "{}"


def test_build_workflow_retrieval_span(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_span_id", lambda _, __: 9)
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "get_workflow_node_status", lambda _: status)
    monkeypatch.setattr(
        aliyun_trace_module, "format_retrieval_documents", lambda docs: [{"formatted": True}] if docs else []
    )

    trace_metadata = SimpleNamespace(trace_id=1, workflow_span_id=2, session_id="s", user_id="u", links=[])
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    node_execution.id = "node-id"
    node_execution.title = "retrieval"
    node_execution.inputs = {"query": "q"}
    node_execution.outputs = {"result": [{"doc": "d"}]}
    node_execution.created_at = _dt()
    node_execution.finished_at = _dt()

    span = trace_instance.build_workflow_retrieval_span(_make_workflow_trace_info(), node_execution, trace_metadata)
    assert span.attributes[RETRIEVAL_QUERY] == "q"
    assert span.attributes[RETRIEVAL_DOCUMENT] == '[{"formatted": true}]'

    # Cover empty inputs/outputs
    node_execution.inputs = None
    node_execution.outputs = None
    span2 = trace_instance.build_workflow_retrieval_span(_make_workflow_trace_info(), node_execution, trace_metadata)
    assert span2.attributes[RETRIEVAL_QUERY] == ""
    assert span2.attributes[RETRIEVAL_DOCUMENT] == "[]"


def test_build_workflow_llm_span(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_span_id", lambda _, __: 9)
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "get_workflow_node_status", lambda _: status)
    monkeypatch.setattr(aliyun_trace_module, "format_input_messages", lambda _: "in")
    monkeypatch.setattr(aliyun_trace_module, "format_output_messages", lambda _: "out")

    trace_metadata = SimpleNamespace(trace_id=1, workflow_span_id=2, session_id="s", user_id="u", links=[])
    node_execution = MagicMock(spec=WorkflowNodeExecution)
    node_execution.id = "node-id"
    node_execution.title = "llm"
    node_execution.process_data = {
        "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        "prompts": ["p"],
        "model_name": "m",
        "model_provider": "p1",
    }
    node_execution.outputs = {"text": "t", "finish_reason": "stop"}
    node_execution.created_at = _dt()
    node_execution.finished_at = _dt()

    span = trace_instance.build_workflow_llm_span(_make_workflow_trace_info(), node_execution, trace_metadata)
    assert span.attributes[GEN_AI_USAGE_TOTAL_TOKENS] == "3"
    assert span.attributes[GEN_AI_REQUEST_MODEL] == "m"
    assert span.attributes[GEN_AI_PROMPT] == '["p"]'
    assert span.attributes[GEN_AI_COMPLETION] == "t"
    assert span.attributes[GEN_AI_RESPONSE_FINISH_REASON] == "stop"
    assert span.attributes[GEN_AI_INPUT_MESSAGE] == "in"
    assert span.attributes[GEN_AI_OUTPUT_MESSAGE] == "out"

    # Cover usage from outputs if not in process_data
    node_execution.process_data = {"prompts": []}
    node_execution.outputs = {"usage": {"total_tokens": 10}, "text": ""}
    span2 = trace_instance.build_workflow_llm_span(_make_workflow_trace_info(), node_execution, trace_metadata)
    assert span2.attributes[GEN_AI_USAGE_TOTAL_TOKENS] == "10"


def test_add_workflow_span(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        aliyun_trace_module, "convert_to_span_id", lambda _, span_type: {"message": 20}.get(span_type, 0)
    )
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "create_status_from_error", lambda _: status)

    trace_metadata = SimpleNamespace(trace_id=1, workflow_span_id=2, session_id="s", user_id="u", links=[])

    # CASE 1: With message_id
    trace_info = _make_workflow_trace_info(
        message_id="msg-1", workflow_run_inputs={"sys.query": "hi"}, workflow_run_outputs={"ans": "ok"}
    )
    trace_instance.add_workflow_span(trace_info, trace_metadata)

    assert len(trace_instance.trace_client.added_spans) == 2
    message_span = trace_instance.trace_client.added_spans[0]
    workflow_span = trace_instance.trace_client.added_spans[1]

    assert message_span.name == "message"
    assert message_span.span_kind == SpanKind.SERVER
    assert message_span.parent_span_id is None

    assert workflow_span.name == "workflow"
    assert workflow_span.span_kind == SpanKind.INTERNAL
    assert workflow_span.parent_span_id == 20

    trace_instance.trace_client.added_spans.clear()

    # CASE 2: Without message_id
    trace_info_no_msg = _make_workflow_trace_info(message_id=None)
    trace_instance.add_workflow_span(trace_info_no_msg, trace_metadata)
    assert len(trace_instance.trace_client.added_spans) == 1
    span = trace_instance.trace_client.added_spans[0]
    assert span.name == "workflow"
    assert span.span_kind == SpanKind.SERVER
    assert span.parent_span_id is None


def test_suggested_question_trace(trace_instance: AliyunDataTrace, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(aliyun_trace_module, "convert_to_trace_id", lambda _: 10)
    monkeypatch.setattr(
        aliyun_trace_module,
        "convert_to_span_id",
        lambda _, span_type: {"message": 20, "suggested_question": 21}.get(span_type, 0),
    )
    monkeypatch.setattr(aliyun_trace_module, "convert_datetime_to_nanoseconds", lambda _: 123)
    monkeypatch.setattr(aliyun_trace_module, "create_links_from_trace_id", lambda _: [])
    status = Status(StatusCode.OK)
    monkeypatch.setattr(aliyun_trace_module, "create_status_from_error", lambda _: status)

    trace_info = _make_suggested_question_trace_info(suggested_question=["how?"])
    trace_instance.suggested_question_trace(trace_info)

    assert len(trace_instance.trace_client.added_spans) == 1
    span = trace_instance.trace_client.added_spans[0]
    assert span.name == "suggested_question"
    assert span.attributes[GEN_AI_COMPLETION] == '["how?"]'
