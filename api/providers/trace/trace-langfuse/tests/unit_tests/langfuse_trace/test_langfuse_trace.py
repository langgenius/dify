"""Unit tests for Langfuse trace translation with real SQLite-backed lookups."""

import collections
import hashlib
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import override
from unittest.mock import MagicMock

import pytest
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.entities.langfuse_trace_entity import (
    GenerationUsage,
    LangfuseGeneration,
    LangfuseSpan,
    LangfuseTrace,
    LevelEnum,
    UnitEnum,
)
from dify_trace_langfuse.langfuse_trace import (
    LangFuseDataTrace,
    _deterministic_span_id,
    _deterministic_trace_id,
    _root_span_id,
    _to_ns,
)
from opentelemetry import trace as otel_trace_api
from sqlalchemy.orm import Session

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowTraceInfo,
)
from graphon.enums import BuiltinNodeTypes
from models import EndUser
from models.enums import EndUserType, MessageStatus


def _dt() -> datetime:
    return datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture
def langfuse_config():
    return LangfuseConfig(public_key="pk-123", secret_key="sk-123", host="https://cloud.langfuse.com")


@pytest.fixture
def trace_instance(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    # Mock Langfuse client to avoid network calls
    mock_client = MagicMock()
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", lambda **kwargs: mock_client)

    instance = LangFuseDataTrace(langfuse_config)
    return instance


def test_init(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    from opentelemetry.sdk.trace import TracerProvider

    mock_langfuse = MagicMock()
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", mock_langfuse)
    monkeypatch.setenv("FILES_URL", "http://test.url")

    instance = LangFuseDataTrace(langfuse_config)

    mock_langfuse.assert_called_once()
    kwargs = mock_langfuse.call_args.kwargs
    assert kwargs["public_key"] == langfuse_config.public_key
    assert kwargs["secret_key"] == langfuse_config.secret_key
    assert kwargs["host"] == langfuse_config.host
    assert isinstance(kwargs["tracer_provider"], TracerProvider)
    assert kwargs["tracer_provider"] is instance._tracer_provider
    assert instance.file_base_url == "http://test.url"


def test_init_passes_isolated_tracer_provider_to_langfuse(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    """Regression test for the langfuse SDK global-provider side effect.

    Without an explicit ``tracer_provider=`` kwarg, the Langfuse SDK attaches a
    ``LangfuseSpanProcessor`` to the *global* OpenTelemetry TracerProvider —
    siphoning every Flask / Celery / SQLAlchemy span in the process into the
    tenant's Langfuse project. See the langfuse v2 -> v3 upgrade guide and
    GitHub discussion langfuse/langfuse#9136.
    """
    from opentelemetry.sdk.trace import TracerProvider

    captured: dict[str, object] = {}

    def fake_langfuse(**kwargs):
        captured.update(kwargs)
        return MagicMock()

    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", fake_langfuse)

    instance = LangFuseDataTrace(langfuse_config)

    assert "tracer_provider" in captured, (
        "Langfuse() must receive an explicit tracer_provider=; without it the "
        "SDK attaches its SpanProcessor to the global OTEL TracerProvider."
    )

    passed_provider = captured["tracer_provider"]
    assert isinstance(passed_provider, TracerProvider)
    assert passed_provider is instance._tracer_provider

    global_provider = otel_trace_api.get_tracer_provider()
    assert passed_provider is not global_provider


def test_same_public_key_uses_per_instance_clients(monkeypatch: pytest.MonkeyPatch):
    clients = [MagicMock(), MagicMock()]
    create_client = MagicMock(side_effect=clients)
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", create_client)

    first = LangFuseDataTrace(
        LangfuseConfig(public_key="shared", secret_key="secret-a", host="https://tenant-a.example")
    )
    second = LangFuseDataTrace(
        LangfuseConfig(public_key="shared", secret_key="secret-b", host="https://tenant-b.example")
    )

    assert first.langfuse_client is clients[0]
    assert second.langfuse_client is clients[1]
    assert [
        (call.kwargs["host"], call.kwargs["public_key"], call.kwargs["secret_key"])
        for call in create_client.call_args_list
    ] == [
        ("https://tenant-a.example", "shared", "secret-a"),
        ("https://tenant-b.example", "shared", "secret-b"),
    ]


def test_close_flushes_without_shutting_down_shared_provider(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", lambda **kwargs: MagicMock())

    instance = LangFuseDataTrace(langfuse_config)
    provider_force_flush = MagicMock()
    provider_shutdown = MagicMock()
    monkeypatch.setattr(instance._tracer_provider, "force_flush", provider_force_flush)
    monkeypatch.setattr(instance._tracer_provider, "shutdown", provider_shutdown)

    instance.close()
    instance.close()

    assert provider_force_flush.call_count == 2
    provider_shutdown.assert_not_called()
    assert instance._tracer_provider is not None


def test_instances_share_tracer_provider_per_public_key(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", lambda **kwargs: MagicMock())

    first = LangFuseDataTrace(langfuse_config)
    second = LangFuseDataTrace(langfuse_config)

    assert first._tracer_provider is second._tracer_provider


def test_trace_dispatch(trace_instance, monkeypatch: pytest.MonkeyPatch):
    methods = [
        "workflow_trace",
        "message_trace",
        "moderation_trace",
        "suggested_question_trace",
        "dataset_retrieval_trace",
        "tool_trace",
        "generate_name_trace",
    ]
    mocks = {method: MagicMock() for method in methods}
    for method, m in mocks.items():
        monkeypatch.setattr(trace_instance, method, m)

    # WorkflowTraceInfo
    info = MagicMock(spec=WorkflowTraceInfo)
    trace_instance.trace(info)
    mocks["workflow_trace"].assert_called_once_with(info)

    # MessageTraceInfo
    info = MagicMock(spec=MessageTraceInfo)
    trace_instance.trace(info)
    mocks["message_trace"].assert_called_once_with(info)

    # ModerationTraceInfo
    info = MagicMock(spec=ModerationTraceInfo)
    trace_instance.trace(info)
    mocks["moderation_trace"].assert_called_once_with(info)

    # SuggestedQuestionTraceInfo
    info = MagicMock(spec=SuggestedQuestionTraceInfo)
    trace_instance.trace(info)
    mocks["suggested_question_trace"].assert_called_once_with(info)

    # DatasetRetrievalTraceInfo
    info = MagicMock(spec=DatasetRetrievalTraceInfo)
    trace_instance.trace(info)
    mocks["dataset_retrieval_trace"].assert_called_once_with(info)

    # ToolTraceInfo
    info = MagicMock(spec=ToolTraceInfo)
    trace_instance.trace(info)
    mocks["tool_trace"].assert_called_once_with(info)

    # GenerateNameTraceInfo
    info = MagicMock(spec=GenerateNameTraceInfo)
    trace_instance.trace(info)
    mocks["generate_name_trace"].assert_called_once_with(info)


@pytest.mark.parametrize("sqlite3_session", [()], indirect=True)
def test_workflow_trace_with_message_id(
    trace_instance, monkeypatch: pytest.MonkeyPatch, sqlite3_session: Session
) -> None:
    # Setup trace info
    trace_info = WorkflowTraceInfo(
        workflow_id="wf-1",
        tenant_id="tenant-1",
        workflow_run_id="run-1",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={"input": "hi"},
        workflow_run_outputs={"output": "hello"},
        workflow_run_version="1.0",
        message_id="msg-1",
        conversation_id="conv-1",
        total_tokens=100,
        file_list=[],
        query="hi",
        start_time=_dt(),
        end_time=_dt() + timedelta(seconds=1),
        trace_id="trace-1",
        metadata={"app_id": "app-1", "user_id": "user-1"},
        workflow_app_log_id="log-1",
        error="",
    )

    monkeypatch.setattr(
        "dify_trace_langfuse.langfuse_trace.db",
        SimpleNamespace(engine=sqlite3_session.get_bind(), session=sqlite3_session),
    )

    # Mock node executions
    node_llm = MagicMock()
    node_llm.id = "node-llm"
    node_llm.title = "LLM Node"
    node_llm.node_type = BuiltinNodeTypes.LLM
    node_llm.status = "succeeded"
    node_llm.process_data = {
        "model_mode": "chat",
        "model_name": "gpt-4",
        "model_provider": "openai",
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }
    node_llm.inputs = {"prompts": "p"}
    node_llm.outputs = {"text": "t"}
    node_llm.created_at = _dt()
    node_llm.elapsed_time = 0.5
    node_llm.metadata = {"foo": "bar"}

    node_other = MagicMock()
    node_other.id = "node-other"
    node_other.title = "Other Node"
    node_other.node_type = BuiltinNodeTypes.CODE
    node_other.status = "failed"
    node_other.process_data = None
    node_other.inputs = {"code": "print"}
    node_other.outputs = {"result": "ok"}
    node_other.created_at = None  # Trigger datetime.now() branch
    node_other.elapsed_time = 0.2
    node_other.metadata = None

    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = [node_llm, node_other]

    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.DifyCoreRepositoryFactory", mock_factory)

    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    # Track calls to add_trace, add_span, add_generation
    trace_instance.add_trace = MagicMock()
    trace_instance.add_span = MagicMock()
    trace_instance.add_generation = MagicMock()

    trace_instance.workflow_trace(trace_info)

    # Verify add_trace (Workflow Level)
    trace_instance.add_trace.assert_called_once()
    trace_data = trace_instance.add_trace.call_args[1]["langfuse_trace_data"]
    assert trace_data.id == "trace-1"
    assert trace_data.name == TraceTaskName.MESSAGE_TRACE
    assert "message" in trace_data.tags
    assert "workflow" in trace_data.tags

    # Verify add_span (Workflow Run Span)
    assert trace_instance.add_span.call_count >= 1
    # First span should be workflow run span because message_id is present
    workflow_span = trace_instance.add_span.call_args_list[0][1]["langfuse_span_data"]
    assert workflow_span.id == "run-1"
    assert workflow_span.name == TraceTaskName.WORKFLOW_TRACE

    # Verify Generation for LLM node
    trace_instance.add_generation.assert_called_once()
    gen_data = trace_instance.add_generation.call_args[1]["langfuse_generation_data"]
    assert gen_data.id == "node-llm"
    assert gen_data.usage.input == 10
    assert gen_data.usage.output == 20

    # Verify normal span for Other node
    # Second add_span call
    other_span = trace_instance.add_span.call_args_list[1][1]["langfuse_span_data"]
    assert other_span.id == "node-other"
    assert other_span.level == LevelEnum.ERROR


@pytest.mark.parametrize("sqlite3_session", [()], indirect=True)
def test_workflow_trace_no_message_id(
    trace_instance, monkeypatch: pytest.MonkeyPatch, sqlite3_session: Session
) -> None:
    trace_info = WorkflowTraceInfo(
        workflow_id="wf-1",
        tenant_id="tenant-1",
        workflow_run_id="run-1",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1.0",
        total_tokens=0,
        file_list=[],
        query="",
        message_id=None,
        conversation_id="conv-1",
        start_time=_dt(),
        end_time=_dt(),
        trace_id=None,  # Should fallback to workflow_run_id
        metadata={"app_id": "app-1"},
        workflow_app_log_id="log-1",
        error="",
    )

    monkeypatch.setattr(
        "dify_trace_langfuse.langfuse_trace.db",
        SimpleNamespace(engine=sqlite3_session.get_bind(), session=sqlite3_session),
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.DifyCoreRepositoryFactory", mock_factory)
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_trace = MagicMock()
    trace_instance.workflow_trace(trace_info)

    trace_instance.add_trace.assert_called_once()
    trace_data = trace_instance.add_trace.call_args[1]["langfuse_trace_data"]
    assert trace_data.id == "run-1"
    assert trace_data.name == TraceTaskName.WORKFLOW_TRACE


@pytest.mark.parametrize("sqlite3_session", [()], indirect=True)
def test_workflow_trace_missing_app_id(
    trace_instance, monkeypatch: pytest.MonkeyPatch, sqlite3_session: Session
) -> None:
    trace_info = WorkflowTraceInfo(
        workflow_id="wf-1",
        tenant_id="tenant-1",
        workflow_run_id="run-1",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1.0",
        total_tokens=0,
        file_list=[],
        query="",
        message_id=None,
        conversation_id="conv-1",
        start_time=_dt(),
        end_time=_dt(),
        metadata={},  # Missing app_id
        workflow_app_log_id="log-1",
        error="",
    )
    monkeypatch.setattr(
        "dify_trace_langfuse.langfuse_trace.db",
        SimpleNamespace(engine=sqlite3_session.get_bind(), session=sqlite3_session),
    )

    with pytest.raises(ValueError, match="No app_id found in trace_info metadata"):
        trace_instance.workflow_trace(trace_info)


def test_message_trace_basic(trace_instance, monkeypatch: pytest.MonkeyPatch):
    message_data = MagicMock()
    message_data.id = "msg-1"
    message_data.from_account_id = "acc-1"
    message_data.from_end_user_id = None
    message_data.provider_response_latency = 0.5
    message_data.conversation_id = "conv-1"
    message_data.total_price = 0.01
    message_data.model_id = "gpt-4"
    message_data.answer = "hello"
    message_data.status = MessageStatus.NORMAL
    message_data.error = None

    trace_info = MessageTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs={"query": "hi"},
        outputs={"answer": "hello"},
        message_tokens=10,
        answer_tokens=20,
        total_tokens=30,
        start_time=_dt(),
        end_time=_dt() + timedelta(seconds=1),
        trace_id="trace-1",
        metadata={"foo": "bar"},
        conversation_mode="chat",
        conversation_model="gpt-4",
        file_list=[],
        error=None,
    )

    trace_instance.add_trace = MagicMock()
    trace_instance.add_generation = MagicMock()

    trace_instance.message_trace(trace_info)

    trace_instance.add_trace.assert_called_once()
    trace_instance.add_generation.assert_called_once()

    gen_data = trace_instance.add_generation.call_args[0][0]
    assert gen_data.name == "llm"
    assert gen_data.usage.total == 30


@pytest.mark.parametrize("sqlite3_session", [(EndUser,)], indirect=True)
def test_message_trace_with_end_user(trace_instance, monkeypatch: pytest.MonkeyPatch, sqlite3_session: Session) -> None:
    message_data = MagicMock()
    message_data.id = "msg-1"
    message_data.from_account_id = "acc-1"
    message_data.from_end_user_id = "end-user-1"
    message_data.conversation_id = "conv-1"
    message_data.status = MessageStatus.NORMAL
    message_data.model_id = "gpt-4"
    message_data.error = ""
    message_data.answer = "hello"
    message_data.total_price = 0.0
    message_data.provider_response_latency = 0.1

    trace_info = MessageTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs={},
        outputs={},
        message_tokens=0,
        answer_tokens=0,
        total_tokens=0,
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        conversation_mode="chat",
        conversation_model="gpt-4",
        file_list=[],
        error=None,
    )

    end_user = EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.BROWSER,
        session_id="session-id-123",
    )
    engine = sqlite3_session.get_bind()
    with Session(engine) as write_session:
        write_session.add(end_user)
        write_session.commit()

    with Session(engine) as read_session:
        monkeypatch.setattr(
            "dify_trace_langfuse.langfuse_trace.db",
            SimpleNamespace(engine=engine, session=read_session),
        )

        trace_instance.add_trace = MagicMock()
        trace_instance.add_generation = MagicMock()

        trace_instance.message_trace(trace_info)

        trace_data = trace_instance.add_trace.call_args[1]["langfuse_trace_data"]
        assert trace_data.user_id == "session-id-123"
        assert trace_data.metadata["user_id"] == "session-id-123"


def test_message_trace_none_data(trace_instance):
    trace_info = SimpleNamespace(message_data=None, file_list=[], metadata={})
    trace_instance.add_trace = MagicMock()
    trace_instance.message_trace(trace_info)
    trace_instance.add_trace.assert_not_called()


def test_moderation_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()

    trace_info = ModerationTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs={"q": "hi"},
        action="stop",
        flagged=True,
        preset_response="blocked",
        start_time=None,
        end_time=None,
        metadata={"foo": "bar"},
        trace_id="trace-1",
        query="hi",
    )

    trace_instance.add_span = MagicMock()
    trace_instance.moderation_trace(trace_info)

    trace_instance.add_span.assert_called_once()
    span_data = trace_instance.add_span.call_args[1]["langfuse_span_data"]
    assert span_data.name == TraceTaskName.MODERATION_TRACE
    assert span_data.output["flagged"] is True


def test_suggested_question_trace(trace_instance):
    message_data = MagicMock()
    message_data.status = MessageStatus.NORMAL
    message_data.error = None

    trace_info = SuggestedQuestionTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs="hi",
        suggested_question=["q1"],
        total_tokens=10,
        level="info",
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        trace_id="trace-1",
    )

    trace_instance.add_generation = MagicMock()
    trace_instance.suggested_question_trace(trace_info)

    trace_instance.add_generation.assert_called_once()
    gen_data = trace_instance.add_generation.call_args[1]["langfuse_generation_data"]
    assert gen_data.name == TraceTaskName.SUGGESTED_QUESTION_TRACE
    assert gen_data.usage.unit == UnitEnum.CHARACTERS


def test_dataset_retrieval_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()
    message_data.updated_at = _dt()

    trace_info = DatasetRetrievalTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs="query",
        documents=[{"id": "doc1"}],
        start_time=None,
        end_time=None,
        metadata={},
        trace_id="trace-1",
    )

    trace_instance.add_span = MagicMock()
    trace_instance.dataset_retrieval_trace(trace_info)

    trace_instance.add_span.assert_called_once()
    span_data = trace_instance.add_span.call_args[1]["langfuse_span_data"]
    assert span_data.name == TraceTaskName.DATASET_RETRIEVAL_TRACE
    assert span_data.output["documents"] == [{"id": "doc1"}]


def test_tool_trace(trace_instance):
    trace_info = ToolTraceInfo(
        message_id="msg-1",
        message_data=MagicMock(),
        inputs={},
        outputs={},
        tool_name="my_tool",
        tool_inputs={"a": 1},
        tool_outputs="result_string",
        time_cost=0.1,
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        trace_id="trace-1",
        tool_config={},
        tool_parameters={},
        error="some error",
    )

    trace_instance.add_span = MagicMock()
    trace_instance.tool_trace(trace_info)

    trace_instance.add_span.assert_called_once()
    span_data = trace_instance.add_span.call_args[1]["langfuse_span_data"]
    assert span_data.name == "my_tool"
    assert span_data.level == LevelEnum.ERROR


def test_generate_name_trace(trace_instance):
    trace_info = GenerateNameTraceInfo(
        inputs={"q": "hi"},
        outputs={"name": "new"},
        tenant_id="tenant-1",
        conversation_id="conv-1",
        start_time=_dt(),
        end_time=_dt(),
        metadata={"m": 1},
    )

    trace_instance.add_trace = MagicMock()
    trace_instance.add_span = MagicMock()

    trace_instance.generate_name_trace(trace_info)

    trace_instance.add_trace.assert_called_once()
    trace_instance.add_span.assert_called_once()

    trace_data = trace_instance.add_trace.call_args[1]["langfuse_trace_data"]
    assert trace_data.name == TraceTaskName.GENERATE_NAME_TRACE
    assert trace_data.user_id == "tenant-1"

    span_data = trace_instance.add_span.call_args[1]["langfuse_span_data"]
    assert span_data.trace_id == "conv-1"


@pytest.fixture
def wrapper_mocks(monkeypatch: pytest.MonkeyPatch):
    span_cls = MagicMock()
    generation_cls = MagicMock()
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.SdkSpan", span_cls)
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.SdkGenerationSpan", generation_cls)
    return SimpleNamespace(span=span_cls, generation=generation_cls)


TRACE_UUID = "7f9c2ba4-e88f-11eb-9a03-0242ac130003"
PARENT_UUID = "550e8400-e29b-41d4-a716-446655440000"


def test_deterministic_id_helpers():
    assert _deterministic_trace_id(TRACE_UUID) == TRACE_UUID.replace("-", "")
    assert _deterministic_trace_id("trace-1") == hashlib.sha256(b"trace-1").digest()[:16].hex()
    assert _deterministic_span_id(PARENT_UUID) == PARENT_UUID.replace("-", "")[:16]
    assert _deterministic_span_id("run-1") == hashlib.sha256(b"run-1").digest()[:8].hex()
    assert len(_root_span_id("a" * 32)) == 16


def test_to_ns_treats_naive_datetimes_as_utc():
    naive = datetime(2024, 1, 1, 0, 0, 0)
    aware = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
    assert _to_ns(naive) == _to_ns(aware)


def test_add_trace_creates_backdated_root_span(trace_instance, wrapper_mocks):
    start = _dt()
    end = _dt() + timedelta(seconds=2)
    data = LangfuseTrace(
        id=TRACE_UUID,
        name="msg",
        user_id="user-1",
        session_id="conv-1",
        tags=["message"],
        metadata={"app_id": "app-1"},
        start_time=start,
        end_time=end,
    )

    trace_instance.add_trace(langfuse_trace_data=data)

    start_span = trace_instance.langfuse_client._otel_tracer.start_span
    start_span.assert_called_once()
    kwargs = start_span.call_args.kwargs
    assert kwargs["name"] == "msg"
    assert kwargs["start_time"] == _to_ns(start)

    otel_span = start_span.return_value
    attribute_keys = {call.args[0] for call in otel_span.set_attribute.call_args_list}
    assert "langfuse.trace.name" in attribute_keys
    assert "user.id" in attribute_keys
    assert "session.id" in attribute_keys
    assert "langfuse.trace.tags" in attribute_keys
    assert "langfuse.trace.metadata.app_id" in attribute_keys

    wrapper_mocks.span.assert_called_once()
    assert wrapper_mocks.span.call_args.kwargs["otel_span"] is otel_span
    wrapper_mocks.span.return_value.end.assert_called_once_with(end_time=_to_ns(end))


def test_add_trace_seeds_deterministic_trace_and_root_span_ids(trace_instance, wrapper_mocks):
    data = LangfuseTrace(id=TRACE_UUID)

    trace_instance.add_trace(langfuse_trace_data=data)

    trace_id_hex = TRACE_UUID.replace("-", "")
    id_generator = trace_instance._tracer_provider.id_generator
    assert id_generator.generate_trace_id() == int(trace_id_hex, 16)
    assert id_generator.generate_span_id() == int(_root_span_id(trace_id_hex), 16)


def test_add_trace_error(trace_instance, wrapper_mocks):
    trace_instance.langfuse_client._otel_tracer.start_span.side_effect = Exception("error")
    data = LangfuseTrace(id="t1", name="trace")
    with pytest.raises(ValueError, match="LangFuse Failed to create trace: error"):
        trace_instance.add_trace(data)


def test_add_span_links_trace_and_explicit_parent(trace_instance, wrapper_mocks):
    data = LangfuseSpan(id="node-1", name="node", trace_id=TRACE_UUID, parent_observation_id=PARENT_UUID)

    trace_instance.add_span(langfuse_span_data=data)

    start_span = trace_instance.langfuse_client._otel_tracer.start_span
    context = start_span.call_args.kwargs["context"]
    parent_context = otel_trace_api.get_current_span(context).get_span_context()
    assert parent_context.trace_id == int(TRACE_UUID.replace("-", ""), 16)
    assert parent_context.span_id == int(PARENT_UUID.replace("-", "")[:16], 16)


def test_add_span_defaults_parent_to_trace_root(trace_instance, wrapper_mocks):
    data = LangfuseSpan(id="s1", name="span", trace_id="trace-1")

    trace_instance.add_span(langfuse_span_data=data)

    trace_id_hex = _deterministic_trace_id("trace-1")
    start_span = trace_instance.langfuse_client._otel_tracer.start_span
    context = start_span.call_args.kwargs["context"]
    parent_context = otel_trace_api.get_current_span(context).get_span_context()
    assert parent_context.trace_id == int(trace_id_hex, 16)
    assert parent_context.span_id == int(_root_span_id(trace_id_hex), 16)


def test_add_span_backdates_and_ends_wrapper(trace_instance, wrapper_mocks):
    start = _dt()
    end = _dt() + timedelta(seconds=1)
    data = LangfuseSpan(
        id="s1",
        name="span",
        trace_id="t1",
        start_time=start,
        end_time=end,
        level=LevelEnum.ERROR,
        status_message="boom",
    )

    trace_instance.add_span(langfuse_span_data=data)

    start_span = trace_instance.langfuse_client._otel_tracer.start_span
    assert start_span.call_args.kwargs["start_time"] == _to_ns(start)
    span_kwargs = wrapper_mocks.span.call_args.kwargs
    assert span_kwargs["level"] == "ERROR"
    assert span_kwargs["status_message"] == "boom"
    wrapper_mocks.span.return_value.end.assert_called_once_with(end_time=_to_ns(end))


def test_add_span_error(trace_instance, wrapper_mocks):
    trace_instance.langfuse_client._otel_tracer.start_span.side_effect = Exception("error")
    data = LangfuseSpan(id="s1", name="span", trace_id="t1")
    with pytest.raises(ValueError, match="LangFuse Failed to create span: error"):
        trace_instance.add_span(data)


def test_add_generation_maps_generation_fields(trace_instance, wrapper_mocks):
    start = _dt()
    end = _dt() + timedelta(seconds=1)
    completion_start = start + timedelta(milliseconds=100)
    data = LangfuseGeneration(
        id="g1",
        name="llm",
        trace_id="t1",
        model="gpt-4",
        start_time=start,
        end_time=end,
        completion_start_time=completion_start,
        usage=GenerationUsage(input=10, output=20, total=30, totalCost=0.5),
    )

    trace_instance.add_generation(langfuse_generation_data=data)

    generation_kwargs = wrapper_mocks.generation.call_args.kwargs
    assert generation_kwargs["model"] == "gpt-4"
    assert generation_kwargs["usage_details"] == {"input": 10, "output": 20, "total": 30}
    assert generation_kwargs["cost_details"] == {"total": 0.5}
    assert generation_kwargs["completion_start_time"] == completion_start
    wrapper_mocks.generation.return_value.end.assert_called_once_with(end_time=_to_ns(end))


def test_add_generation_error(trace_instance, wrapper_mocks):
    trace_instance.langfuse_client._otel_tracer.start_span.side_effect = Exception("error")
    data = LangfuseGeneration(id="g1", name="gen", trace_id="t1")
    with pytest.raises(ValueError, match="LangFuse Failed to create generation: error"):
        trace_instance.add_generation(data)


def test_trace_dispatch_flushes_client(trace_instance, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(trace_instance, "message_trace", MagicMock())

    trace_instance.trace(MagicMock(spec=MessageTraceInfo))

    trace_instance.langfuse_client.flush.assert_called_once()


def test_api_check_success(trace_instance):
    trace_instance.langfuse_client.api.projects.get.return_value = MagicMock(data=[MagicMock()])
    assert trace_instance.api_check() is True


def test_api_check_rejects_empty_project_list(trace_instance):
    trace_instance.langfuse_client.api.projects.get.return_value = MagicMock(data=[])
    with pytest.raises(ValueError, match="no project found for the provided credentials"):
        trace_instance.api_check()


def test_api_check_error(trace_instance):
    trace_instance.langfuse_client.api.projects.get.side_effect = Exception("fail")
    with pytest.raises(ValueError, match="LangFuse API check failed: fail"):
        trace_instance.api_check()


def test_get_project_key_success(trace_instance):
    mock_data = MagicMock()
    mock_data.id = "proj-1"
    trace_instance.langfuse_client.api.projects.get.return_value = MagicMock(data=[mock_data])
    assert trace_instance.get_project_key() == "proj-1"


def test_get_project_key_error(trace_instance):
    trace_instance.langfuse_client.api.projects.get.side_effect = Exception("fail")
    with pytest.raises(ValueError, match="LangFuse get project key failed: fail"):
        trace_instance.get_project_key()


def test_moderation_trace_none(trace_instance):
    trace_info = ModerationTraceInfo(
        message_id="m",
        message_data=None,
        inputs={},
        action="s",
        flagged=False,
        preset_response="",
        query="",
        metadata={},
    )
    trace_instance.add_span = MagicMock()
    trace_instance.moderation_trace(trace_info)
    trace_instance.add_span.assert_not_called()


def test_suggested_question_trace_none(trace_instance):
    trace_info = SuggestedQuestionTraceInfo(
        message_id="m", message_data=None, inputs={}, suggested_question=[], total_tokens=0, level="i", metadata={}
    )
    trace_instance.add_generation = MagicMock()
    trace_instance.suggested_question_trace(trace_info)
    trace_instance.add_generation.assert_not_called()


def test_dataset_retrieval_trace_none(trace_instance):
    trace_info = DatasetRetrievalTraceInfo(message_id="m", message_data=None, inputs={}, documents=[], metadata={})
    trace_instance.add_span = MagicMock()
    trace_instance.dataset_retrieval_trace(trace_info)
    trace_instance.add_span.assert_not_called()


def test_langfuse_trace_entity_with_list_dict_input():
    # To cover lines 29-31 in langfuse_trace_entity.py
    # We need to mock replace_text_with_content or just check if it works
    # Actually replace_text_with_content is imported from core.ops.utils
    data = LangfuseTrace(id="t1", name="n", input=[{"text": "hello"}])
    assert isinstance(data.input, list)
    assert data.input[0]["content"] == "hello"


@pytest.mark.parametrize("sqlite3_session", [()], indirect=True)
def test_workflow_trace_handles_usage_extraction_error(
    trace_instance,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite3_session: Session,
):
    # Setup trace info to trigger LLM node usage extraction
    trace_info = WorkflowTraceInfo(
        workflow_id="wf-1",
        tenant_id="t",
        workflow_run_id="r",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="s",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        total_tokens=0,
        file_list=[],
        query="",
        message_id=None,
        conversation_id="c",
        start_time=_dt(),
        end_time=_dt(),
        metadata={"app_id": "app-1"},
        workflow_app_log_id="l",
        error="",
    )

    node = MagicMock()
    node.id = "n1"
    node.title = "LLM Node"
    node.node_type = BuiltinNodeTypes.LLM
    node.status = "succeeded"

    class BadDict(collections.UserDict):
        @override
        def get(self, key, default=None):
            if key == "usage":
                raise Exception("Usage extraction failed")
            return super().get(key, default)

    node.process_data = BadDict({"model_mode": "chat", "model_name": "gpt-4", "usage": True, "prompts": ["p"]})
    node.created_at = _dt()
    node.elapsed_time = 0.1
    node.metadata = {}
    node.outputs = {}

    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = [node]
    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.DifyCoreRepositoryFactory", mock_factory)
    monkeypatch.setattr(
        "dify_trace_langfuse.langfuse_trace.db",
        SimpleNamespace(engine=sqlite3_session.get_bind(), session=sqlite3_session),
    )
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_trace = MagicMock()
    trace_instance.add_generation = MagicMock()

    with caplog.at_level(logging.ERROR):
        trace_instance.workflow_trace(trace_info)

    assert "Failed to extract usage" in caplog.text
    trace_instance.add_generation.assert_called_once()
