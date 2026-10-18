"""Unit tests for Langfuse trace translation with real SQLite-backed lookups."""

import collections
import json
import logging
import uuid
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
from dify_trace_langfuse.langfuse_trace import LangFuseDataTrace, _json_str
from langfuse import Langfuse as SdkLangfuse
from langfuse import LangfuseOtelSpanAttributes
from langfuse.api.core.api_error import ApiError
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy.orm import Session

from core.ops.entities.trace_entity import (
    BaseTraceInfo,
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


from tests.unit_tests.core.ops.trace_fixtures import message_trace_info, tool_trace_info, workflow_trace_info


@pytest.fixture
def langfuse_config():
    return LangfuseConfig(public_key="pk-123", secret_key="sk-123", host="https://cloud.langfuse.com")


@pytest.fixture
def trace_instance(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    mock_client = MagicMock()
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", lambda **kwargs: mock_client)
    return LangFuseDataTrace(langfuse_config)


def test_init(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    mock_langfuse = MagicMock()
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", mock_langfuse)
    monkeypatch.setenv("FILES_URL", "http://test.url")

    instance = LangFuseDataTrace(langfuse_config)

    mock_langfuse.assert_called_once()
    kwargs = mock_langfuse.call_args.kwargs
    assert kwargs["public_key"] == langfuse_config.public_key
    assert kwargs["secret_key"] == langfuse_config.secret_key
    assert kwargs["host"] == langfuse_config.host
    assert kwargs["tracer_provider"] is instance._tracer_provider
    assert instance.file_base_url == "http://test.url"


def test_client_init_failure_is_logged_without_secret(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    public_key = f"pk-{uuid.uuid4()}"
    monkeypatch.setattr(
        "dify_trace_langfuse.langfuse_trace.Langfuse",
        MagicMock(side_effect=RuntimeError("client init failed")),
    )

    with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError, match="client init failed"):
        LangFuseDataTrace(
            LangfuseConfig(public_key=public_key, secret_key="secret-value", host="https://tenant.example")
        )

    assert f"host=https://tenant.example public_key={public_key}" in caplog.text
    assert "secret-value" not in caplog.text


def test_instances_with_same_public_key_share_tracer_provider(monkeypatch: pytest.MonkeyPatch):
    clients = [MagicMock(), MagicMock()]
    create_client = MagicMock(side_effect=clients)
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", create_client)
    config = LangfuseConfig(
        public_key=f"shared-{uuid.uuid4()}",
        secret_key="same-secret",
        host="https://tenant.example",
    )

    first = LangFuseDataTrace(config)
    second = LangFuseDataTrace(
        LangfuseConfig(
            public_key=config.public_key,
            secret_key=config.secret_key,
            host=f"{config.host}/",
        )
    )

    assert first.langfuse_client is clients[0]
    assert second.langfuse_client is clients[1]
    assert first._tracer_provider is second._tracer_provider
    assert create_client.call_count == 2
    assert create_client.call_args_list[0].kwargs["host"] == config.host
    assert create_client.call_args_list[1].kwargs["host"] == f"{config.host}/"
    assert all(
        actual_call.kwargs["tracer_provider"] is first._tracer_provider for actual_call in create_client.call_args_list
    )


@pytest.mark.parametrize(
    ("host", "secret_key"),
    [
        ("https://other.example", "secret-a"),
        ("https://tenant.example", "secret-b"),
    ],
)
def test_same_public_key_rejects_different_connection_settings(
    monkeypatch: pytest.MonkeyPatch, host: str, secret_key: str
):
    public_key = f"shared-{uuid.uuid4()}"
    create_client = MagicMock()
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", create_client)
    LangFuseDataTrace(LangfuseConfig(public_key=public_key, secret_key="secret-a", host="https://tenant.example"))

    with pytest.raises(ValueError, match="different connection settings") as error:
        LangFuseDataTrace(LangfuseConfig(public_key=public_key, secret_key=secret_key, host=host))

    create_client.assert_called_once()
    assert "secret-a" not in str(error.value)
    assert "secret-b" not in str(error.value)


def test_close_is_idempotent(langfuse_config, monkeypatch: pytest.MonkeyPatch):
    client = MagicMock()
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", lambda **kwargs: client)

    instance = LangFuseDataTrace(langfuse_config)
    instance.close()
    instance.close()

    client.flush.assert_called_once()


def test_close_remains_open_when_flush_fails(trace_instance):
    trace_instance.langfuse_client.flush.side_effect = RuntimeError("flush failed")

    with pytest.raises(RuntimeError, match="flush failed"):
        trace_instance.close()

    assert trace_instance._closed is False
    trace_instance.langfuse_client.flush.side_effect = None
    trace_instance.close()
    assert trace_instance.langfuse_client.flush.call_count == 2


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
    info = workflow_trace_info()
    trace_instance.trace(info)
    mocks["workflow_trace"].assert_called_once_with(info)

    # MessageTraceInfo
    info = message_trace_info()
    trace_instance.trace(info)
    mocks["message_trace"].assert_called_once_with(info)

    # ModerationTraceInfo
    info = ModerationTraceInfo(metadata={}, flagged=False, action="allow", preset_response="", query="hello")
    trace_instance.trace(info)
    mocks["moderation_trace"].assert_called_once_with(info)

    # SuggestedQuestionTraceInfo
    info = SuggestedQuestionTraceInfo(metadata={}, total_tokens=0, suggested_question=[], level="info")
    trace_instance.trace(info)
    mocks["suggested_question_trace"].assert_called_once_with(info)

    # DatasetRetrievalTraceInfo
    info = DatasetRetrievalTraceInfo(metadata={})
    trace_instance.trace(info)
    mocks["dataset_retrieval_trace"].assert_called_once_with(info)

    # ToolTraceInfo
    info = tool_trace_info()
    trace_instance.trace(info)
    mocks["tool_trace"].assert_called_once_with(info)

    # GenerateNameTraceInfo
    info = GenerateNameTraceInfo(tenant_id="tenant-1", metadata={})
    trace_instance.trace(info)
    mocks["generate_name_trace"].assert_called_once_with(info)


def test_trace_rejects_unsupported_type(trace_instance):
    with pytest.raises(TypeError, match="Unsupported trace info type: BaseTraceInfo"):
        trace_instance.trace(BaseTraceInfo(metadata={}))

    trace_instance.langfuse_client.flush.assert_called_once()


@pytest.mark.parametrize("sqlite3_session", [()], indirect=True)
def test_workflow_trace_with_message_id(
    trace_instance, monkeypatch: pytest.MonkeyPatch, sqlite3_session: Session, caplog: pytest.LogCaptureFixture
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

    repo.get_by_workflow_execution.return_value = [node_llm]
    trace_instance.add_generation.reset_mock()

    def fail_completion_time(*args):
        raise TypeError("invalid usage timing")

    monkeypatch.setattr(trace_instance, "_get_completion_start_time", fail_completion_time)
    with caplog.at_level(logging.ERROR, logger="dify_trace_langfuse.langfuse_trace"):
        trace_instance.workflow_trace(trace_info)

    generation = trace_instance.add_generation.call_args.kwargs["langfuse_generation_data"]
    assert generation.usage is None
    assert "workflow_run_id=run-1 node_execution_id=node-llm" in caplog.text


@pytest.mark.parametrize(
    ("value", "expected_log"),
    [("invalid", "Ignoring invalid"), (-1.0, "Ignoring negative")],
)
def test_invalid_time_to_first_token_is_logged(value, expected_log: str, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.WARNING, logger="dify_trace_langfuse.langfuse_trace"):
        result = LangFuseDataTrace._get_completion_start_time(_dt(), value)

    assert result is None
    assert expected_log in caplog.text


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


def test_message_trace_none_data(trace_instance, caplog: pytest.LogCaptureFixture):
    trace_info = MessageTraceInfo(
        conversation_model="gpt-4",
        message_tokens=0,
        answer_tokens=0,
        total_tokens=0,
        conversation_mode="chat",
        message_id="msg-1",
        message_data=None,
        file_list=[],
        metadata={},
    )
    trace_instance.add_trace = MagicMock()
    with caplog.at_level(logging.DEBUG, logger="dify_trace_langfuse.langfuse_trace"):
        trace_instance.message_trace(trace_info)
    trace_instance.add_trace.assert_not_called()
    assert "Skipping Langfuse message trace" in caplog.text


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


def test_add_trace_success(trace_instance):
    trace_instance.add_trace(LangfuseTrace(id="t1", name="trace"))
    trace_instance.langfuse_client._otel_tracer.start_span.assert_called_once()
    trace_instance.langfuse_client.ingestion.batch.assert_not_called()


def test_add_trace_error(trace_instance, caplog: pytest.LogCaptureFixture):
    trace_instance.langfuse_client._otel_tracer.start_span.side_effect = RuntimeError("error")
    data = LangfuseTrace(id="t1", name="trace")
    with caplog.at_level(logging.ERROR):
        with pytest.raises(RuntimeError, match="error"):
            trace_instance.add_trace(data)

    assert "trace_id=t1" in caplog.text


def test_json_trace_attributes_reject_unsupported_values():
    with pytest.raises(TypeError):
        _json_str({"unsupported": object()})


def test_add_span_success(trace_instance):
    data = LangfuseSpan(id="s1", name="span", trace_id="t1")
    trace_instance.add_span(data)
    trace_instance.langfuse_client._otel_tracer.start_span.assert_called_once()
    trace_instance.langfuse_client.ingestion.batch.assert_not_called()


def test_add_span_error(trace_instance, caplog: pytest.LogCaptureFixture):
    trace_instance.langfuse_client._otel_tracer.start_span.side_effect = RuntimeError("error")
    data = LangfuseSpan(id="s1", name="span", trace_id="t1")
    with caplog.at_level(logging.ERROR):
        with pytest.raises(RuntimeError, match="error"):
            trace_instance.add_span(data)

    assert "trace_id=t1 span_id=s1" in caplog.text


def test_add_generation_success(trace_instance):
    data = LangfuseGeneration(id="g1", name="gen", trace_id="t1")
    trace_instance.add_generation(data)
    trace_instance.langfuse_client._otel_tracer.start_span.assert_called_once()
    trace_instance.langfuse_client.ingestion.batch.assert_not_called()


def test_trace_observations_use_otel_ingestion(trace_instance):
    trace_instance.add_trace(LangfuseTrace(id="trace-1", name="workflow"))
    trace_instance.add_span(LangfuseSpan(id="span-1", trace_id="trace-1", name="node"))
    trace_instance.add_generation(
        LangfuseGeneration(id="generation-1", trace_id="trace-1", name="llm", parent_observation_id="span-1")
    )

    assert trace_instance.langfuse_client._otel_tracer.start_span.call_count == 3
    trace_instance.langfuse_client.ingestion.batch.assert_not_called()


def test_public_writers_export_historical_otel_hierarchy(monkeypatch: pytest.MonkeyPatch):
    exporter = InMemorySpanExporter()
    langfuse_factory = SdkLangfuse
    monkeypatch.setattr(
        "dify_trace_langfuse.langfuse_trace.Langfuse",
        lambda **kwargs: langfuse_factory(**kwargs, span_exporter=exporter),
    )

    trace_id = "1234567890abcdef1234567890abcdef"
    span_id = "1111111111111111"
    generation_id = "2222222222222222"
    start_time = datetime(2024, 1, 1, tzinfo=UTC)
    end_time = start_time + timedelta(seconds=2)
    trace = LangFuseDataTrace(
        LangfuseConfig(
            public_key=f"pk-{uuid.uuid4()}",
            secret_key="secret",
            host="https://langfuse.example",
        )
    )
    try:
        trace.add_trace(
            LangfuseTrace(
                id=trace_id,
                name="workflow",
                input={"question": "hello"},
                output={"answer": "world"},
                metadata={"app_id": "app-1", "nested": {"key": "value"}},
                user_id="user-1",
                session_id="session-1",
                version="v1",
                release="release-1",
                tags=["workflow"],
                public=True,
                start_time=start_time,
                end_time=end_time,
            )
        )
        trace.add_span(
            LangfuseSpan(
                id=span_id,
                trace_id=trace_id,
                name="node",
                input={"prompt": "hello"},
                output={"result": "world"},
                metadata={"node": "llm"},
                level=LevelEnum.ERROR,
                status_message="node failed",
                start_time=start_time,
                end_time=end_time,
            )
        )
        trace.add_generation(
            LangfuseGeneration(
                id=generation_id,
                trace_id=trace_id,
                parent_observation_id=span_id,
                name="generation",
                model="gpt-4",
                model_parameters={"temperature": 0.1},
                input={"prompt": "hello"},
                output={"completion": "world"},
                metadata={"provider": "openai"},
                level=LevelEnum.ERROR,
                status_message="generation failed",
                start_time=start_time,
                completion_start_time=start_time + timedelta(seconds=1),
                end_time=end_time,
                usage=GenerationUsage(
                    input=3,
                    output=4,
                    total=7,
                    unit=UnitEnum.TOKENS,
                    inputCost=0.01,
                    outputCost=0.02,
                    totalCost=0.03,
                ),
            )
        )
        trace.langfuse_client.flush()

        exported = {span.name: span for span in exporter.get_finished_spans()}
        root = exported["workflow"]
        node = exported["node"]
        generation = exported["generation"]
        root_attributes = root.attributes or {}
        node_attributes = node.attributes or {}
        generation_attributes = generation.attributes or {}

        assert root.context is not None
        assert node.context is not None
        assert generation.context is not None
        assert root.context.trace_id == int(trace_id, 16)
        assert root.start_time == int(start_time.timestamp() * 1_000_000_000)
        assert root.end_time == int(end_time.timestamp() * 1_000_000_000)
        assert root_attributes[LangfuseOtelSpanAttributes.TRACE_NAME] == "workflow"
        assert root_attributes[LangfuseOtelSpanAttributes.TRACE_USER_ID] == "user-1"
        assert root_attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID] == "session-1"
        assert root_attributes[LangfuseOtelSpanAttributes.TRACE_TAGS] == ("workflow",)
        assert root_attributes[LangfuseOtelSpanAttributes.TRACE_METADATA + ".app_id"] == "app-1"
        assert json.loads(str(root_attributes[LangfuseOtelSpanAttributes.TRACE_INPUT])) == {"question": "hello"}
        assert json.loads(str(root_attributes[LangfuseOtelSpanAttributes.TRACE_OUTPUT])) == {"answer": "world"}
        assert node.context.trace_id == int(trace_id, 16)
        assert node.context.span_id == int(span_id, 16)
        assert node.parent is not None
        assert node.parent.span_id == root.context.span_id
        assert node.start_time == root.start_time
        assert node.end_time == root.end_time
        assert node_attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL] == "ERROR"
        assert node_attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE] == "node failed"
        assert json.loads(str(node_attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT])) == {"prompt": "hello"}
        assert json.loads(str(node_attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT])) == {"result": "world"}
        assert generation.context.span_id == int(generation_id, 16)
        assert generation.parent is not None
        assert generation.parent.span_id == node.context.span_id
        assert generation_attributes[LangfuseOtelSpanAttributes.OBSERVATION_MODEL] == "gpt-4"
        assert json.loads(str(generation_attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT])) == {
            "prompt": "hello"
        }
        assert json.loads(str(generation_attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT])) == {
            "completion": "world"
        }
        assert json.loads(str(generation_attributes[LangfuseOtelSpanAttributes.OBSERVATION_USAGE_DETAILS])) == {
            "input": 3,
            "output": 4,
            "total": 7,
        }
        assert json.loads(str(generation_attributes[LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS])) == {
            "input": 0.01,
            "output": 0.02,
            "total": 0.03,
        }
        assert generation.start_time == root.start_time
        assert generation.end_time == root.end_time
    finally:
        trace.langfuse_client.shutdown()


def test_langfuse_sdk_reuses_first_host_resources_for_public_key():
    public_key = f"pk-{uuid.uuid4()}"
    first_exporter = InMemorySpanExporter()
    second_exporter = InMemorySpanExporter()
    first_provider = TracerProvider()
    second_provider = TracerProvider()
    first = SdkLangfuse(
        public_key=public_key,
        secret_key="secret-a",
        host="https://first.example",
        tracer_provider=first_provider,
        span_exporter=first_exporter,
    )
    second = SdkLangfuse(
        public_key=public_key,
        secret_key="secret-b",
        host="https://second.example",
        tracer_provider=second_provider,
        span_exporter=second_exporter,
    )
    try:
        assert second._resources is first._resources
        assert second._resources is not None
        assert second._resources.base_url == "https://first.example"
        span = second._otel_tracer.start_span("second-client")
        span.end()
        second.flush()

        assert [span.name for span in first_exporter.get_finished_spans()] == ["second-client"]
        assert second_exporter.get_finished_spans() == ()
    finally:
        first.shutdown()
        second_provider.shutdown()


def test_provider_rejects_sdk_resource_key_collision_before_writing(monkeypatch: pytest.MonkeyPatch):
    exporter = InMemorySpanExporter()
    langfuse_factory = SdkLangfuse
    create_client = MagicMock(side_effect=lambda **kwargs: langfuse_factory(**kwargs, span_exporter=exporter))
    monkeypatch.setattr("dify_trace_langfuse.langfuse_trace.Langfuse", create_client)
    public_key = f"pk-{uuid.uuid4()}"
    first = LangFuseDataTrace(
        LangfuseConfig(public_key=public_key, secret_key="secret-a", host="https://first.example")
    )
    try:
        with pytest.raises(ValueError, match="different connection settings"):
            LangFuseDataTrace(
                LangfuseConfig(public_key=public_key, secret_key="secret-b", host="https://second.example")
            )

        create_client.assert_called_once()
        first.langfuse_client.flush()
        assert exporter.get_finished_spans() == ()
    finally:
        first.langfuse_client.shutdown()


def test_trace_flush_does_not_mask_trace_failure(
    trace_instance, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(trace_instance, "message_trace", MagicMock(side_effect=ValueError("trace failed")))
    trace_instance.langfuse_client.flush.side_effect = RuntimeError("export failed")

    with caplog.at_level(logging.ERROR):
        with pytest.raises(ValueError, match="trace failed"):
            trace_instance.trace(message_trace_info())

    assert "operation=trace_error trace_type=MessageTraceInfo" in caplog.text
    assert "export failed" in caplog.text


def test_trace_flush_failure_logs_trace_context(
    trace_instance, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(trace_instance, "message_trace", MagicMock())
    trace_instance.langfuse_client.flush.side_effect = RuntimeError("export failed")

    with caplog.at_level(logging.ERROR):
        with pytest.raises(RuntimeError, match="export failed"):
            trace_instance.trace(message_trace_info())

    assert "operation=trace trace_type=MessageTraceInfo" in caplog.text


def test_add_generation_error(trace_instance, caplog: pytest.LogCaptureFixture):
    trace_instance.langfuse_client._otel_tracer.start_span.side_effect = RuntimeError("error")
    data = LangfuseGeneration(id="g1", name="gen", trace_id="t1")
    with caplog.at_level(logging.ERROR):
        with pytest.raises(RuntimeError, match="error"):
            trace_instance.add_generation(data)

    assert "trace_id=t1 generation_id=g1" in caplog.text


def test_api_check_success(trace_instance):
    trace_instance.langfuse_client.api.projects.get.return_value = MagicMock(data=[MagicMock()])
    assert trace_instance.api_check() is True


def test_api_check_rejects_empty_project_list(trace_instance):
    trace_instance.langfuse_client.api.projects.get.return_value = MagicMock(data=[])
    with pytest.raises(ValueError, match="no project found for the provided credentials"):
        trace_instance.api_check()


def test_api_check_error(trace_instance):
    trace_instance.langfuse_client.api.projects.get.side_effect = ApiError(status_code=500)
    with pytest.raises(ValueError, match="verify the configured host and credentials") as error:
        trace_instance.api_check()

    assert isinstance(error.value.__cause__, ApiError)


def test_get_project_key_success(trace_instance):
    mock_data = MagicMock()
    mock_data.id = "proj-1"
    trace_instance.langfuse_client.api.projects.get.return_value = MagicMock(data=[mock_data])
    assert trace_instance.get_project_key() == "proj-1"


def test_get_project_key_error(trace_instance):
    trace_instance.langfuse_client.api.projects.get.side_effect = ApiError(status_code=500)
    with pytest.raises(ValueError, match="verify the configured host and credentials") as error:
        trace_instance.get_project_key()

    assert isinstance(error.value.__cause__, ApiError)


def test_moderation_trace_none(trace_instance, caplog: pytest.LogCaptureFixture):
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
    with caplog.at_level(logging.DEBUG, logger="dify_trace_langfuse.langfuse_trace"):
        trace_instance.moderation_trace(trace_info)
    trace_instance.add_span.assert_not_called()
    assert "Skipping Langfuse moderation trace" in caplog.text


def test_suggested_question_trace_none(trace_instance, caplog: pytest.LogCaptureFixture):
    trace_info = SuggestedQuestionTraceInfo(
        message_id="m", message_data=None, inputs={}, suggested_question=[], total_tokens=0, level="i", metadata={}
    )
    trace_instance.add_generation = MagicMock()
    with caplog.at_level(logging.DEBUG, logger="dify_trace_langfuse.langfuse_trace"):
        trace_instance.suggested_question_trace(trace_info)
    trace_instance.add_generation.assert_not_called()
    assert "Skipping Langfuse suggested-question trace" in caplog.text


def test_dataset_retrieval_trace_none(trace_instance, caplog: pytest.LogCaptureFixture):
    trace_info = DatasetRetrievalTraceInfo(message_id="m", message_data=None, inputs={}, documents=[], metadata={})
    trace_instance.add_span = MagicMock()
    with caplog.at_level(logging.DEBUG, logger="dify_trace_langfuse.langfuse_trace"):
        trace_instance.dataset_retrieval_trace(trace_info)
    trace_instance.add_span.assert_not_called()
    assert "Skipping Langfuse dataset-retrieval trace" in caplog.text


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
                raise TypeError("Usage extraction failed")
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
    generation = trace_instance.add_generation.call_args.kwargs["langfuse_generation_data"]
    assert generation.usage is None
