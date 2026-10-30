from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable, Generator, Mapping
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, create_autospec

import pytest
from pydantic import BaseModel
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import (
    PauseStateLayerConfig,
    WorkflowResumptionContext,
    _AdvancedChatAppGenerateEntityWrapper,
    _WorkflowGenerateEntityWrapper,
)
from core.app.layers.trigger_post_layer import TriggerPostLayer
from enums.creator import CreatorUserRole
from graphon.engine.filter import ResponseStreamFilter
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import RuntimeState, VariablePool
from models.account import Account
from models.enums import (
    AppTriggerType,
    ConversationFromSource,
    WorkflowRunTriggeredFrom,
    WorkflowTriggerStatus,
)
from models.model import App, AppMode, Conversation, Message
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow, WorkflowPause, WorkflowRun, WorkflowType
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    _WorkflowRunError,
)
from services.knowledge.retrieval.retrieval import KnowledgeRetriever
from services.workflow.queue_dispatcher import QueuePriority
from tasks.app_generate import workflow_execute_task as workflow_execute_task_module
from tasks.app_generate.workflow_execute_task import (
    AppExecutionParams,
    _AppRunner,
    _get_trigger_resume_layers,
    _publish_streaming_response,
    _resume_advanced_chat,
    _resume_app_execution,
    _resume_workflow,
)


class _StreamEventModel(BaseModel):
    event: object | None = None
    task_id: object | None = None
    message: object | None = None


@dataclass(frozen=True, slots=True)
class _KnowledgeServicesStub:
    retrieval: KnowledgeRetriever


@dataclass(frozen=True, slots=True)
class _ApplicationServicesStub:
    knowledge: _KnowledgeServicesStub


@dataclass(frozen=True, slots=True)
class _DatabaseStub:
    engine: Engine


@pytest.fixture(autouse=True)
def knowledge_retrieval(monkeypatch: pytest.MonkeyPatch) -> KnowledgeRetriever:
    retriever = create_autospec(KnowledgeRetriever, instance=True, spec_set=True)
    services = _ApplicationServicesStub(knowledge=_KnowledgeServicesStub(retrieval=retriever))
    monkeypatch.setattr("extensions.ext_application_services.application_services", lambda: services)
    return retriever


def _build_advanced_chat_generate_entity(conversation_id: str | None) -> AdvancedChatAppGenerateEntity:
    return AdvancedChatAppGenerateEntity(
        task_id="task-id",
        inputs={},
        files=[],
        user_id="user-id",
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
        query="query",
        conversation_id=conversation_id,
    )


def _build_workflow_generate_entity(stream: bool) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity(
        task_id="task-id",
        inputs={},
        files=[],
        user_id="user-id",
        stream=stream,
        invoke_from=InvokeFrom.WEB_APP,
        workflow_execution_id="workflow-run-id",
    )


def _single_event_generator(payload):
    yield payload


def _decode_published_payload(payload: bytes) -> dict[str, object] | str:
    return json.loads(payload.decode())


def _published_payloads(topic: MagicMock) -> list[dict[str, object] | str]:
    return [_decode_published_payload(call.args[0]) for call in topic.publish.call_args_list]


def _make_account(*, account_id: str = "account-id") -> Account:
    account = Account(name="Workflow Runner", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_app(*, app_id: str = "app-id", tenant_id: str = "resource-tenant-id") -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Test App",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=True,
        enable_api=True,
    )


def _make_workflow(*, workflow_id: str = "workflow-id", app_id: str = "app-id") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="resource-tenant-id",
        app_id=app_id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="workflow-owner",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _make_conversation(*, conversation_id: str = "conversation-id", app_id: str = "app-id") -> Conversation:
    return Conversation(
        id=conversation_id,
        app_id=app_id,
        mode=AppMode.ADVANCED_CHAT,
        name="Test Conversation",
        inputs={},
        from_source=ConversationFromSource.API,
    )


def _make_message(*, conversation_id: str = "conversation-id", workflow_run_id: str = "workflow-run-id") -> Message:
    return Message(
        id="message-id",
        app_id="app-id",
        conversation_id=conversation_id,
        inputs={},
        query="query",
        message={"role": "user", "content": "query"},
        answer="answer",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        workflow_run_id=workflow_run_id,
    )


def _make_workflow_run(
    *,
    workflow_run_id: str = "workflow-run-id",
    workflow_id: str = "workflow-id",
    created_by: str = "account-id",
    tenant_id: str = "resource-tenant-id",
) -> WorkflowRun:
    return WorkflowRun(
        id=workflow_run_id,
        tenant_id=tenant_id,
        app_id="app-id",
        workflow_id=workflow_id,
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
    )


def _persist_app_and_workflow(session_factory: sessionmaker[Session]) -> None:
    app = App(
        id="app-id",
        tenant_id="tenant-id",
        name="Test App",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=True,
        enable_api=True,
    )
    workflow = Workflow(
        id="workflow-id",
        tenant_id="tenant-id",
        app_id=app.id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="workflow-owner",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    with session_factory.begin() as session:
        session.add_all([app, workflow])


def _persist_resumption_models(
    session_factory: sessionmaker[Session],
    *,
    workflow_run_id: str,
    conversation_id: str | None = None,
) -> None:
    app = App(
        id="app-id",
        tenant_id="tenant-id",
        name="Test App",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=True,
        enable_api=True,
    )
    workflow = Workflow(
        id="wf-id",
        tenant_id="tenant-id",
        app_id=app.id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="workflow-owner",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow_run = WorkflowRun(
        id=workflow_run_id,
        task_id="task-id",
        tenant_id="tenant-id",
        app_id=app.id,
        workflow_id=workflow.id,
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version=workflow.version,
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-id",
    )

    with session_factory.begin() as session:
        session.add_all([app, workflow, workflow_run])
        if conversation_id is None:
            return

        conversation = Conversation(
            id=conversation_id,
            app_id=app.id,
            mode=AppMode.ADVANCED_CHAT,
            name="Test Conversation",
            inputs={},
            from_source=ConversationFromSource.API,
        )
        messages = [
            Message(
                id="older-message-id",
                app_id=app.id,
                conversation_id=conversation.id,
                inputs={},
                query="older matching message",
                message={"role": "user", "content": "older"},
                answer="older",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
                workflow_run_id=workflow_run_id,
                created_at=datetime(2025, 1, 1),
            ),
            Message(
                id="expected-message-id",
                app_id=app.id,
                conversation_id=conversation.id,
                inputs={},
                query="newer matching message",
                message={"role": "user", "content": "expected"},
                answer="expected",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
                workflow_run_id=workflow_run_id,
                created_at=datetime(2025, 1, 2),
            ),
            Message(
                id="other-run-message-id",
                app_id=app.id,
                conversation_id=conversation.id,
                inputs={},
                query="newest message from another run",
                message={"role": "user", "content": "other run"},
                answer="other run",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
                workflow_run_id="other-run-id",
                created_at=datetime(2025, 1, 3),
            ),
        ]
        session.add(conversation)
        session.add_all(messages)


@pytest.mark.parametrize(
    ("app_mode", "generator_class", "generator_name"),
    [
        (AppMode.ADVANCED_CHAT, AdvancedChatAppGenerator, "AdvancedChatAppGenerator"),
        (AppMode.WORKFLOW, WorkflowAppGenerator, "WorkflowAppGenerator"),
    ],
)
def test_app_runner_forwards_knowledge_retrieval_to_generator(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
    app_mode: AppMode,
    generator_class: type[AdvancedChatAppGenerator] | type[WorkflowAppGenerator],
    generator_name: str,
) -> None:
    exec_params = AppExecutionParams(
        app_id="app-id",
        workflow_id="workflow-id",
        tenant_id="tenant-id",
        app_mode=app_mode,
        user={"TYPE": "account", "user_id": "user-id"},
        args={"inputs": {}, "query": "test"},
        invoke_from=InvokeFrom.EXPLORE,
        streaming=False,
        workflow_run_id="workflow-run-id",
    )
    runner = _AppRunner(
        session_factory=sqlite_session_factory,
        exec_params=exec_params,
        knowledge_retrieval=knowledge_retrieval,
    )
    generator = create_autospec(generator_class, spec_set=True)
    generator.return_value.generate.return_value = {"result": "ok"}
    monkeypatch.setattr(workflow_execute_task_module, generator_name, generator)

    result = runner._run_app(
        app=_make_app(),
        workflow=_make_workflow(),
        user=_make_account(),
        pause_state_config=create_autospec(PauseStateLayerConfig, instance=True, spec_set=True),
        session=create_autospec(Session, instance=True, spec_set=True),
    )

    assert result == {"result": "ok"}
    assert generator.call_args.kwargs["knowledge_retrieval"] is knowledge_retrieval


def test_workflow_execution_task_forwards_knowledge_retrieval(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    knowledge_retrieval: KnowledgeRetriever,
) -> None:
    exec_params = AppExecutionParams(
        app_id="app-id",
        workflow_id="workflow-id",
        tenant_id="tenant-id",
        app_mode=AppMode.WORKFLOW,
        user={"TYPE": "account", "user_id": "user-id"},
        args={"inputs": {}},
        invoke_from=InvokeFrom.EXPLORE,
        streaming=False,
        workflow_run_id="workflow-run-id",
    )
    runner = create_autospec(_AppRunner, spec_set=True)
    monkeypatch.setattr(workflow_execute_task_module, "_AppRunner", runner)
    monkeypatch.setattr(workflow_execute_task_module, "db", _DatabaseStub(engine=sqlite_engine))

    workflow_execute_task_module.workflow_based_app_execution_task.run(exec_params.model_dump_json())

    assert runner.call_args.kwargs["knowledge_retrieval"] is knowledge_retrieval
    runner.return_value.run.assert_called_once_with()


def test_resume_execution_task_forwards_knowledge_retrieval(
    monkeypatch: pytest.MonkeyPatch,
    knowledge_retrieval: KnowledgeRetriever,
) -> None:
    resume = create_autospec(_resume_app_execution, spec_set=True)
    monkeypatch.setattr(workflow_execute_task_module, "_resume_app_execution", resume)
    payload = {"workflow_run_id": "workflow-run-id"}

    workflow_execute_task_module.resume_app_execution.run(payload)

    resume.assert_called_once_with(payload, knowledge_retrieval=knowledge_retrieval, reconcile_only=False)


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        ({"event": "workflow_started"}, "workflow_started"),
        ({"event": 123}, "123"),
        (_StreamEventModel(event="workflow_started"), "workflow_started"),
        (_StreamEventModel(event=123), "123"),
        ({}, None),
        (_StreamEventModel(), None),
        ("workflow_started", None),
    ],
)
def test_get_event_name(event: object, expected: str | None):
    assert workflow_execute_task_module._get_event_name(event) == expected


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        ({"task_id": "task-id"}, "task-id"),
        (_StreamEventModel(task_id="task-id"), "task-id"),
        ({"task_id": 123}, None),
        (_StreamEventModel(task_id=123), None),
        ({"task_id": ""}, None),
        (_StreamEventModel(), None),
        ("task-id", None),
    ],
)
def test_get_task_id(event: object, expected: str | None):
    assert workflow_execute_task_module._get_task_id(event) == expected


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        ({"message": "workflow error"}, "workflow error"),
        (_StreamEventModel(message="workflow error"), "workflow error"),
        ({"message": ""}, None),
        ({"message": 123}, None),
        ({}, None),
        ("workflow error", None),
    ],
)
def test_get_error_message(event: str | Mapping[str, object] | BaseModel, expected: str | None):
    assert workflow_execute_task_module._get_error_message(event) == expected


@pytest.fixture
def mock_topic(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    topic = MagicMock()
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.MessageBasedAppGenerator.get_response_topic",
        lambda *_args, **_kwargs: topic,
    )
    return topic


def test_publish_streaming_response_with_uuid(mock_topic: MagicMock):
    workflow_run_id = uuid.uuid4()
    response_stream = iter(
        [
            {"event": "workflow_started", "task_id": "task-id"},
            {"event": "workflow_finished", "task_id": "task-id", "data": {"status": "succeeded"}},
        ]
    )

    _publish_streaming_response(
        response_stream,
        workflow_run_id,
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-id",
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )

    payloads = _published_payloads(mock_topic)
    assert [payload["event"] for payload in payloads] == ["workflow_started", "workflow_finished"]


def test_publish_streaming_response_coerces_string_uuid(mock_topic: MagicMock):
    workflow_run_id = uuid.uuid4()
    response_stream = iter([{"event": "workflow_paused", "task_id": "task-id"}])

    _publish_streaming_response(
        response_stream,
        str(workflow_run_id),
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-id",
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )

    payloads = _published_payloads(mock_topic)
    assert [payload["event"] for payload in payloads] == ["workflow_paused"]


def test_publish_streaming_response_publishes_started_then_failed_terminal_when_iteration_raises(
    mock_topic: MagicMock,
):
    def _response_stream():
        if False:
            yield None
        raise RuntimeError("stream exploded")

    with pytest.raises(RuntimeError, match="stream exploded"):
        _publish_streaming_response(
            _response_stream(),
            "workflow-run-id",
            app_mode=AppMode.ADVANCED_CHAT,
            workflow_id="workflow-id",
            inputs={"foo": "bar"},
            started_reason=WorkflowStartReason.INITIAL,
        )

    payloads = _published_payloads(mock_topic)
    assert [payload["event"] for payload in payloads] == ["workflow_started", "workflow_finished"]
    assert payloads[0]["data"]["workflow_id"] == "workflow-id"
    assert payloads[0]["data"]["inputs"] == {"foo": "bar"}
    assert payloads[1]["data"]["status"] == WorkflowExecutionStatus.FAILED
    assert payloads[1]["data"]["error"] == "stream exploded"


def test_publish_streaming_response_recovers_when_workflow_started_publish_fails_first(
    mock_topic: MagicMock,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.ERROR, logger="tasks.app_generate.workflow_execute_task")
    response_stream = iter([{"event": "workflow_started", "task_id": "task-id"}])
    successful_payloads: list[dict[str, object] | str] = []
    started_publish_attempts = 0

    def _publish(payload: bytes) -> None:
        nonlocal started_publish_attempts

        decoded = _decode_published_payload(payload)
        if isinstance(decoded, dict) and decoded.get("event") == "workflow_started":
            started_publish_attempts += 1
            if started_publish_attempts == 1:
                raise RuntimeError("started publish failed")
        successful_payloads.append(decoded)

    mock_topic.publish.side_effect = _publish

    with pytest.raises(RuntimeError, match="started publish failed"):
        _publish_streaming_response(
            response_stream,
            "workflow-run-id",
            app_mode=AppMode.ADVANCED_CHAT,
            workflow_id="workflow-id",
            inputs={"file": object()},
            started_reason=WorkflowStartReason.INITIAL,
        )

    assert [payload["event"] for payload in successful_payloads] == ["workflow_started", "workflow_finished"]
    assert successful_payloads[0]["task_id"] == "task-id"
    assert isinstance(successful_payloads[0]["data"]["inputs"]["file"], str)
    assert successful_payloads[1]["task_id"] == "task-id"
    assert successful_payloads[1]["data"]["status"] == WorkflowExecutionStatus.FAILED
    assert successful_payloads[1]["data"]["error"] == "started publish failed"
    assert "workflow-run-id" in caplog.text
    assert "publishing fallback terminal event" in caplog.text


def test_publish_streaming_response_publishes_failed_terminal_without_duplicate_started_on_publish_error(
    mock_topic: MagicMock,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.ERROR, logger="tasks.app_generate.workflow_execute_task")
    response_stream = iter(
        [
            {
                "event": "workflow_started",
                "task_id": "task-id",
                "workflow_run_id": "workflow-run-id",
                "data": {"id": "workflow-run-id", "workflow_id": "workflow-id", "inputs": {}, "created_at": 1},
            },
            {"event": "node_started", "task_id": "task-id"},
        ]
    )
    successful_payloads: list[dict[str, object] | str] = []

    def _publish(payload: bytes) -> None:
        decoded = _decode_published_payload(payload)
        if isinstance(decoded, dict) and decoded.get("event") == "node_started":
            raise RuntimeError("broker write failed")
        successful_payloads.append(decoded)

    mock_topic.publish.side_effect = _publish

    with pytest.raises(RuntimeError, match="broker write failed"):
        _publish_streaming_response(
            response_stream,
            "workflow-run-id",
            app_mode=AppMode.ADVANCED_CHAT,
            workflow_id="workflow-id",
            inputs={},
            started_reason=WorkflowStartReason.INITIAL,
        )

    assert [payload["event"] for payload in successful_payloads] == ["workflow_started", "workflow_finished"]
    assert successful_payloads[1]["task_id"] == "task-id"
    assert successful_payloads[1]["data"]["status"] == WorkflowExecutionStatus.FAILED
    assert successful_payloads[1]["data"]["error"] == "broker write failed"
    assert "workflow-run-id" in caplog.text
    assert "publishing fallback terminal event" in caplog.text


def test_publish_streaming_response_recovers_when_workflow_finished_publish_fails_first(
    mock_topic: MagicMock,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.ERROR, logger="tasks.app_generate.workflow_execute_task")
    response_stream = iter(
        [
            {"event": "workflow_started", "task_id": "task-id"},
            {"event": "workflow_finished", "task_id": "task-id", "data": {"status": "succeeded"}},
        ]
    )
    successful_payloads: list[dict[str, object] | str] = []
    finished_publish_attempts = 0

    def _publish(payload: bytes) -> None:
        nonlocal finished_publish_attempts

        decoded = _decode_published_payload(payload)
        if isinstance(decoded, dict) and decoded.get("event") == "workflow_finished":
            finished_publish_attempts += 1
            if finished_publish_attempts == 1:
                raise RuntimeError("finished publish failed")
        successful_payloads.append(decoded)

    mock_topic.publish.side_effect = _publish

    with pytest.raises(RuntimeError, match="finished publish failed"):
        _publish_streaming_response(
            response_stream,
            "workflow-run-id",
            app_mode=AppMode.ADVANCED_CHAT,
            workflow_id="workflow-id",
            inputs={},
            started_reason=WorkflowStartReason.INITIAL,
        )

    assert [payload["event"] for payload in successful_payloads] == ["workflow_started", "workflow_finished"]
    assert successful_payloads[1]["task_id"] == "task-id"
    assert successful_payloads[1]["data"]["status"] == WorkflowExecutionStatus.FAILED
    assert successful_payloads[1]["data"]["error"] == "finished publish failed"
    assert "workflow-run-id" in caplog.text
    assert "publishing fallback terminal event" in caplog.text


def test_publish_streaming_response_publishes_failed_terminal_on_exhaustion_without_terminal_event(
    mock_topic: MagicMock,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.WARNING, logger="tasks.app_generate.workflow_execute_task")
    response_stream = iter(
        [
            {
                "event": "workflow_started",
                "task_id": "task-id",
                "workflow_run_id": "workflow-run-id",
                "data": {"id": "workflow-run-id", "workflow_id": "workflow-id", "inputs": {}, "created_at": 1},
            }
        ]
    )

    _publish_streaming_response(
        response_stream,
        "workflow-run-id",
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-id",
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )

    payloads = _published_payloads(mock_topic)
    assert [payload["event"] for payload in payloads] == ["workflow_started", "workflow_finished"]
    assert payloads[1]["task_id"] == "task-id"
    assert payloads[1]["data"]["status"] == WorkflowExecutionStatus.FAILED
    assert payloads[1]["data"]["error"] == "Workflow stream ended without a terminal event"
    assert "workflow-run-id" in caplog.text
    assert "ended without a terminal event" in caplog.text


def test_publish_streaming_response_uses_error_message_for_failed_terminal(mock_topic: MagicMock):
    def response_stream() -> Generator[str | Mapping[str, object] | BaseModel]:
        yield {
            "event": "error",
            "workflow_run_id": "workflow-run-id",
            "code": "invalid_param",
            "message": "LLM provider and model are required.",
            "status": 400,
        }

    _publish_streaming_response(
        response_stream(),
        "workflow-run-id",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-id",
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )

    payloads = _published_payloads(mock_topic)
    error_payload = payloads[0]
    finished_payload = payloads[-1]
    assert isinstance(error_payload, dict)
    assert isinstance(finished_payload, dict)
    assert error_payload["status"] == 400
    assert error_payload["message"] == "LLM provider and model are required."
    finished_data = finished_payload["data"]
    assert isinstance(finished_data, dict)
    assert finished_data["status"] == WorkflowExecutionStatus.FAILED
    assert finished_data["error"] == "LLM provider and model are required."


def test_publish_streaming_response_does_not_publish_synthetic_failure_after_terminal_event(mock_topic: MagicMock):
    response_stream = iter(
        [
            {
                "event": "workflow_started",
                "task_id": "task-id",
                "workflow_run_id": "workflow-run-id",
                "data": {"id": "workflow-run-id", "workflow_id": "workflow-id", "inputs": {}, "created_at": 1},
            },
            {
                "event": "workflow_finished",
                "task_id": "task-id",
                "workflow_run_id": "workflow-run-id",
                "data": {
                    "id": "workflow-run-id",
                    "workflow_id": "workflow-id",
                    "status": WorkflowExecutionStatus.SUCCEEDED,
                    "outputs": {},
                    "error": None,
                    "elapsed_time": 0.1,
                    "total_tokens": 1,
                    "total_steps": 1,
                    "created_by": {},
                    "created_at": 1,
                    "finished_at": 2,
                    "exceptions_count": 0,
                    "files": [],
                },
            },
        ]
    )

    _publish_streaming_response(
        response_stream,
        "workflow-run-id",
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-id",
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )

    payloads = _published_payloads(mock_topic)
    assert [payload["event"] for payload in payloads] == ["workflow_started", "workflow_finished"]


def test_app_runner_streaming_failure_publishes_started_then_failed_workflow_finished(
    mock_topic: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    exec_params = AppExecutionParams(
        app_id="app-id",
        workflow_id="workflow-id",
        tenant_id="tenant-id",
        app_mode=AppMode.ADVANCED_CHAT,
        user={"TYPE": "account", "user_id": "user-id"},
        args={"inputs": {}, "query": "test"},
        invoke_from=InvokeFrom.EXPLORE,
        streaming=True,
        workflow_run_id="workflow-run-id",
    )
    _persist_app_and_workflow(sqlite_session_factory)
    runner = _AppRunner(
        session_factory=sqlite_session_factory,
        exec_params=exec_params,
        knowledge_retrieval=knowledge_retrieval,
    )

    monkeypatch.setattr(runner, "_resolve_user", _make_account)
    monkeypatch.setattr(runner, "_setup_flask_context", lambda _user: nullcontext())
    monkeypatch.setattr(runner, "_run_app", lambda **_kwargs: (_ for _ in ()).throw(ValueError("Invalid upload file")))

    with pytest.raises(ValueError, match="Invalid upload file"):
        runner.run()

    assert mock_topic.publish.call_count == 2
    started_payload = json.loads(mock_topic.publish.call_args_list[0].args[0].decode())
    assert started_payload["event"] == "workflow_started"
    assert started_payload["workflow_run_id"] == "workflow-run-id"
    assert started_payload["task_id"] == "workflow-run-id"
    assert started_payload["data"]["id"] == "workflow-run-id"
    assert started_payload["data"]["workflow_id"] == "workflow-id"
    assert started_payload["data"]["reason"] == "initial"

    finished_payload = json.loads(mock_topic.publish.call_args_list[1].args[0].decode())
    assert finished_payload["event"] == "workflow_finished"
    assert finished_payload["workflow_run_id"] == "workflow-run-id"
    assert finished_payload["task_id"] == "workflow-run-id"
    assert finished_payload["data"]["id"] == "workflow-run-id"
    assert finished_payload["data"]["workflow_id"] == "workflow-id"
    assert finished_payload["data"]["status"] == WorkflowExecutionStatus.FAILED
    assert finished_payload["data"]["error"] == "Invalid upload file"
    assert finished_payload["data"]["outputs"] is None
    assert finished_payload["data"]["total_tokens"] == 0
    assert finished_payload["data"]["total_steps"] == 0
    assert finished_payload["data"]["exceptions_count"] == 1
    assert finished_payload["data"]["created_by"] == {}
    assert finished_payload["data"]["created_at"] == finished_payload["data"]["finished_at"]
    assert finished_payload["data"]["files"] == []


def test_app_runner_resolves_account_without_switching_tenant(
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    account_id = str(uuid.uuid4())
    exec_params = AppExecutionParams(
        app_id="app-id",
        workflow_id="workflow-id",
        tenant_id="resource-tenant-id",
        app_mode=AppMode.WORKFLOW,
        user={"TYPE": "account", "user_id": account_id},
        args={"inputs": {}},
        invoke_from=InvokeFrom.EXPLORE,
        streaming=True,
        workflow_run_id="workflow-run-id",
    )
    with sqlite_session_factory() as session:
        account = Account(name="Runner Account", email="runner@example.com")
        account.id = account_id
        session.add(account)
        session.commit()
    runner = _AppRunner(
        session_factory=sqlite_session_factory,
        exec_params=exec_params,
        knowledge_retrieval=knowledge_retrieval,
    )

    resolved_user = runner._resolve_user()

    assert resolved_user.id == account_id
    assert resolved_user.current_tenant is None


def test_resolve_account_for_run_without_switching_tenant(sqlite_session: Session):
    account_id = str(uuid.uuid4())
    account = Account(name="Run Account", email="run@example.com")
    account.id = account_id
    sqlite_session.add(account)
    sqlite_session.commit()
    workflow_run = _make_workflow_run(created_by=account_id)

    resolved_user = workflow_execute_task_module._resolve_user_for_run(sqlite_session, workflow_run)

    assert resolved_user is account
    assert account.current_tenant is None


def test_app_runner_streaming_failure_keeps_existing_pre_runtime_helper_behavior(
    mock_topic: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    exec_params = AppExecutionParams(
        app_id="app-id",
        workflow_id="workflow-id",
        tenant_id="tenant-id",
        app_mode=AppMode.ADVANCED_CHAT,
        user={"TYPE": "account", "user_id": "user-id"},
        args={"inputs": {}, "query": "test"},
        invoke_from=InvokeFrom.EXPLORE,
        streaming=True,
        workflow_run_id="workflow-run-id",
    )
    _persist_app_and_workflow(sqlite_session_factory)
    runner = _AppRunner(
        session_factory=sqlite_session_factory,
        exec_params=exec_params,
        knowledge_retrieval=knowledge_retrieval,
    )

    monkeypatch.setattr(runner, "_resolve_user", _make_account)
    monkeypatch.setattr(runner, "_setup_flask_context", lambda _user: nullcontext())
    monkeypatch.setattr(runner, "_run_app", lambda **_kwargs: (_ for _ in ()).throw(ValueError("Invalid upload file")))
    monkeypatch.setattr(
        "core.workflow.workflow_entry.WorkflowEntry.handle_special_values",
        lambda value: (_ for _ in ()).throw(AssertionError("pre-runtime helper should not normalize inputs")),
    )

    with pytest.raises(ValueError, match="Invalid upload file"):
        runner.run()

    payloads = _published_payloads(mock_topic)
    assert payloads[0]["data"]["inputs"] == {}
    assert payloads[0]["data"]["reason"] == WorkflowStartReason.INITIAL


def test_app_runner_streaming_success_calls_publish_streaming_response_with_full_signature(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    exec_params = AppExecutionParams(
        app_id="app-id",
        workflow_id="workflow-id",
        tenant_id="tenant-id",
        app_mode=AppMode.ADVANCED_CHAT,
        user={"TYPE": "account", "user_id": "user-id"},
        args={"inputs": {"foo": "bar"}, "query": "test"},
        invoke_from=InvokeFrom.EXPLORE,
        streaming=True,
        workflow_run_id="workflow-run-id",
    )
    _persist_app_and_workflow(sqlite_session_factory)
    runner = _AppRunner(
        session_factory=sqlite_session_factory,
        exec_params=exec_params,
        knowledge_retrieval=knowledge_retrieval,
    )
    response_stream = _single_event_generator({"event": "message"})
    publish_streaming_response = MagicMock()

    monkeypatch.setattr(runner, "_resolve_user", _make_account)
    monkeypatch.setattr(runner, "_setup_flask_context", lambda _user: nullcontext())
    monkeypatch.setattr(runner, "_run_app", lambda **_kwargs: response_stream)
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._publish_streaming_response",
        publish_streaming_response,
    )

    runner.run()

    publish_streaming_response.assert_called_once_with(
        response_stream,
        exec_params.workflow_run_id,
        exec_params.app_mode,
        exec_params.workflow_id,
        exec_params.args.get("inputs", {}),
        WorkflowStartReason.INITIAL,
    )


def test_resume_app_execution_queries_message_by_conversation_and_workflow_run(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    workflow_run_id = "run-id"
    conversation_id = "conversation-id"
    _persist_resumption_models(
        sqlite_session_factory,
        workflow_run_id=workflow_run_id,
        conversation_id=conversation_id,
    )

    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=sqlite_engine))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_api_workflow_run_repository",
        lambda *_args, **_kwargs: workflow_run_repo,
    )

    generate_entity = _build_advanced_chat_generate_entity(conversation_id)
    resumption_context = MagicMock()
    resumption_context.serialized_graph_runtime_state = "{}"
    resumption_context.get_generate_entity.return_value = generate_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowResumptionContext.loads",
        lambda *_args, **_kwargs: resumption_context,
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.RuntimeState.from_snapshot",
        lambda *_args, **_kwargs: MagicMock(),
    )

    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._resolve_user_for_run", lambda *_args, **_kwargs: _make_account()
    )
    resume_advanced_chat = MagicMock()
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_advanced_chat", resume_advanced_chat)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_workflow", MagicMock())

    _resume_app_execution({"workflow_run_id": workflow_run_id}, knowledge_retrieval=knowledge_retrieval)

    workflow_run_repo.resume_workflow_pause.assert_called_once_with(workflow_run_id, pause_entity, before_resume=ANY)
    resume_advanced_chat.assert_called_once()
    assert resume_advanced_chat.call_args.kwargs["conversation"].id == conversation_id
    assert resume_advanced_chat.call_args.kwargs["message"].id == "expected-message-id"
    assert resume_advanced_chat.call_args.kwargs["knowledge_retrieval"] is knowledge_retrieval


def test_resume_app_execution_propagates_pause_state_load_failure(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
) -> None:
    workflow_run_id = "run-id"
    _persist_resumption_models(sqlite_session_factory, workflow_run_id=workflow_run_id)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=sqlite_engine))

    pause_entity = MagicMock()
    pause_entity.get_state.side_effect = OSError("pause storage unavailable")
    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_api_workflow_run_repository",
        lambda *_args, **_kwargs: workflow_run_repo,
    )

    with pytest.raises(OSError, match="pause storage unavailable"):
        _resume_app_execution({"workflow_run_id": workflow_run_id}, knowledge_retrieval=knowledge_retrieval)


def test_resume_app_execution_returns_early_when_advanced_chat_missing_conversation_id(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    workflow_run_id = "run-id"
    _persist_resumption_models(sqlite_session_factory, workflow_run_id=workflow_run_id)

    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=sqlite_engine))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_api_workflow_run_repository",
        lambda *_args, **_kwargs: workflow_run_repo,
    )

    generate_entity = _build_advanced_chat_generate_entity(conversation_id=None)
    resumption_context = MagicMock()
    resumption_context.serialized_graph_runtime_state = "{}"
    resumption_context.get_generate_entity.return_value = generate_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowResumptionContext.loads",
        lambda *_args, **_kwargs: resumption_context,
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.RuntimeState.from_snapshot",
        lambda *_args, **_kwargs: MagicMock(),
    )

    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._resolve_user_for_run", lambda *_args, **_kwargs: _make_account()
    )
    resume_advanced_chat = MagicMock()
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_advanced_chat", resume_advanced_chat)

    _resume_app_execution({"workflow_run_id": workflow_run_id}, knowledge_retrieval=knowledge_retrieval)

    workflow_run_repo.resume_workflow_pause.assert_not_called()
    resume_advanced_chat.assert_not_called()


def test_resume_app_execution_clears_stale_cancellation_signals_before_resuming(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    """A resumed run reuses the paused task ID, so it must not inherit its cancellation signals.

    Regression test for #40878: a stop flag or queued AbortCommand left over from
    an earlier attempt of the same task aborted the resumed run, which then
    finished as "Stopped by user".
    """
    workflow_run_id = "run-id"
    _persist_resumption_models(sqlite_session_factory, workflow_run_id=workflow_run_id)

    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=sqlite_engine))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_api_workflow_run_repository",
        lambda *_args, **_kwargs: workflow_run_repo,
    )

    generate_entity = _build_workflow_generate_entity(stream=False)
    resumption_context = MagicMock()
    resumption_context.serialized_graph_runtime_state = "{}"
    resumption_context.get_generate_entity.return_value = generate_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowResumptionContext.loads",
        lambda *_args, **_kwargs: resumption_context,
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.RuntimeState.from_snapshot",
        lambda *_args, **_kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._resolve_user_for_run", lambda *_args, **_kwargs: MagicMock()
    )

    calls: list[str] = []
    clear_signals = MagicMock(side_effect=lambda task_id: calls.append(f"clear:{task_id}"))
    workflow_run_repo.resume_workflow_pause.side_effect = lambda *_, before_resume: before_resume()
    resume_workflow = MagicMock(side_effect=lambda **_kwargs: calls.append("resume"))
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.clear_app_task_cancellation_signals", clear_signals)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_workflow", resume_workflow)

    _resume_app_execution({"workflow_run_id": workflow_run_id}, knowledge_retrieval=knowledge_retrieval)

    clear_signals.assert_called_once_with(generate_entity.task_id)
    assert resume_workflow.call_args.kwargs["knowledge_retrieval"] is knowledge_retrieval
    # Clearing after the engine started would let it observe the stale abort first.
    assert calls == [f"clear:{generate_entity.task_id}", "resume"]


def test_resume_app_execution_keeps_cancellation_signals_when_resume_is_abandoned(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    """No attempt is starting, so nothing may clear the signals guarding this task."""
    workflow_run_id = "run-id"
    _persist_resumption_models(sqlite_session_factory, workflow_run_id=workflow_run_id)

    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.db", _DatabaseStub(engine=sqlite_engine))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_api_workflow_run_repository",
        lambda *_args, **_kwargs: workflow_run_repo,
    )

    # Missing conversation id makes the advanced-chat resume bail out before running.
    generate_entity = _build_advanced_chat_generate_entity(conversation_id=None)
    resumption_context = MagicMock()
    resumption_context.serialized_graph_runtime_state = "{}"
    resumption_context.get_generate_entity.return_value = generate_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowResumptionContext.loads",
        lambda *_args, **_kwargs: resumption_context,
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.RuntimeState.from_snapshot",
        lambda *_args, **_kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._resolve_user_for_run", lambda *_args, **_kwargs: MagicMock()
    )

    clear_signals = MagicMock()
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.clear_app_task_cancellation_signals", clear_signals)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_advanced_chat", MagicMock())

    _resume_app_execution({"workflow_run_id": workflow_run_id}, knowledge_retrieval=knowledge_retrieval)

    clear_signals.assert_not_called()


@pytest.mark.parametrize("entry_point", ["workflow", "chat"])
@pytest.mark.parametrize(
    "scenario",
    [
        "valid",
        "canonical-task",
        "already-indexed-uppercase",
        "concurrent-index",
        "concurrent-stop",
        "task_id",
        "run_id",
        "tenant_id",
        "app_id",
        "user_id",
    ],
)
def test_resume_recovers_legacy_task_before_claiming_pause(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
    entry_point: str,
    scenario: str,
) -> None:
    workflow_run_id = str(uuid.uuid4())
    task_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    app_mode = AppMode.ADVANCED_CHAT if entry_point == "chat" else AppMode.WORKFLOW
    _persist_resumption_models(
        sqlite_session_factory,
        workflow_run_id=workflow_run_id,
        conversation_id="conversation-id" if entry_point == "chat" else None,
    )
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, workflow_run_id)
        assert run is not None
        run.task_id = task_id if scenario == "already-indexed-uppercase" else None
        run.status = WorkflowExecutionStatus.PAUSED
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="legacy-pause")
        session.add(pause)

    config = WorkflowUIBasedAppConfig(tenant_id="tenant-id", app_id="app-id", app_mode=app_mode, workflow_id="wf-id")
    if entry_point == "chat":
        generate_entity = _build_advanced_chat_generate_entity("conversation-id")
        generate_entity.workflow_run_id = workflow_run_id
    else:
        generate_entity = _build_workflow_generate_entity(stream=False)
        generate_entity.workflow_execution_id = workflow_run_id
    generate_entity.app_config = config
    generate_entity.task_id = task_id
    generate_entity.user_id = "account-id"
    generate_entity.invoke_from = InvokeFrom.DEBUGGER
    wrapper = (
        _AdvancedChatAppGenerateEntityWrapper(entity=generate_entity)
        if isinstance(generate_entity, AdvancedChatAppGenerateEntity)
        else _WorkflowGenerateEntityWrapper(entity=generate_entity)
    )
    runtime_state = RuntimeState(workflow_id="wf-id", variable_pool=VariablePool(), start_at=0.0)
    context = WorkflowResumptionContext(generate_entity=wrapper, serialized_graph_runtime_state=runtime_state.dumps())
    state = json.loads(context.dumps())
    saved_entity = state["generate_entity"]["entity"]
    if scenario in {"canonical-task", "already-indexed-uppercase"}:
        saved_entity["task_id"] = task_id.upper()
    elif scenario in {"tenant_id", "app_id"}:
        saved_entity["app_config"][scenario] = "other-owner"
    elif scenario == "run_id":
        saved_entity["workflow_run_id" if entry_point == "chat" else "workflow_execution_id"] = str(uuid.uuid4())
    elif scenario in {"task_id", "user_id"}:
        saved_entity[scenario] = "invalid-task-or-owner"
    monkeypatch.setattr(
        "repositories.sqlalchemy_api_workflow_run_repository.storage.load", lambda _: json.dumps(state).encode()
    )
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.delete", lambda _: None)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    module = workflow_execute_task_module
    monkeypatch.setattr(type(module.db), "engine", property(lambda _: sqlite_engine))
    monkeypatch.setattr(
        module.WorkflowRepositoryFactory, "create_api_workflow_run_repository", lambda *_args, **_kwargs: repository
    )
    monkeypatch.setattr(module, "_resolve_user_for_run", lambda *_args: _make_account())
    resumed_entities: list[AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity] = []

    def record_app_resume(
        *, generate_entity: AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity, **_kwargs: object
    ) -> None:
        resumed_entities.append(generate_entity)

    monkeypatch.setattr(module, "clear_app_task_cancellation_signals", lambda _: None)
    monkeypatch.setattr(
        module, "_resume_advanced_chat" if entry_point == "chat" else "_resume_workflow", record_app_resume
    )

    if scenario in {"concurrent-index", "concurrent-stop"}:
        index_pause = repository.backfill_workflow_pause_task_id

        def concurrent_index(**kwargs: str) -> bool:
            assert index_pause(**kwargs)
            if scenario == "concurrent-stop":
                with sqlite_session_factory.begin() as session:
                    run = session.get(WorkflowRun, workflow_run_id)
                    assert run is not None
                    run.status = WorkflowExecutionStatus.STOPPED
                    run.stop_requested_at = datetime(2026, 10, 19)
            return index_pause(**kwargs)

        monkeypatch.setattr(repository, "backfill_workflow_pause_task_id", concurrent_index)

    resume_pause = repository.resume_workflow_pause
    resumed_pause_runs: list[str] = []

    def record_resume_pause(
        workflow_run_id: str, pause_entity: WorkflowPauseEntity, *, before_resume: Callable[[], None] | None = None
    ) -> WorkflowPauseEntity:
        resumed_pause_runs.append(workflow_run_id)
        return resume_pause(workflow_run_id, pause_entity, before_resume=before_resume)

    monkeypatch.setattr(repository, "resume_workflow_pause", record_resume_pause)

    _resume_app_execution({"workflow_run_id": workflow_run_id}, knowledge_retrieval=knowledge_retrieval)

    with sqlite_session_factory() as session:
        persisted = session.get(WorkflowRun, workflow_run_id)
        assert persisted is not None
        if scenario in {"valid", "canonical-task", "already-indexed-uppercase", "concurrent-index"}:
            assert persisted.task_id == task_id
            assert persisted.status == WorkflowExecutionStatus.RUNNING
            assert resumed_pause_runs == [workflow_run_id]
            assert len(resumed_entities) == 1
            assert resumed_entities[0].task_id == task_id
        elif scenario == "concurrent-stop":
            assert persisted.task_id == task_id
            assert persisted.status == WorkflowExecutionStatus.STOPPED
            assert resumed_pause_runs == [workflow_run_id]
            assert resumed_entities == []
        else:
            assert persisted.task_id is None
            assert persisted.status == WorkflowExecutionStatus.PAUSED
            persisted_pause = session.get(WorkflowPause, pause.id)
            assert persisted_pause is not None
            assert persisted_pause.resumed_at is None
            assert resumed_pause_runs == []
            assert resumed_entities == []


def test_triggered_workflow_resume_accepts_community_edition_logical_team_queue(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        trigger_log = WorkflowTriggerLog(
            tenant_id="tenant-id",
            app_id="app-id",
            workflow_id="workflow-id",
            workflow_run_id="workflow-run-id",
            root_node_id="root-node-id",
            trigger_metadata="{}",
            trigger_type=AppTriggerType.UNKNOWN,
            trigger_data="{}",
            inputs="{}",
            outputs=None,
            status=WorkflowTriggerStatus.PAUSED,
            error=None,
            queue_name=QueuePriority.TEAM,
            celery_task_id="celery-task-id",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-id",
        )
        trigger_log.id = "trigger-log-id"
        session.add(trigger_log)

    layers = _get_trigger_resume_layers(sqlite_session_factory, "workflow-run-id")

    assert len(layers) == 1
    assert isinstance(layers[0], TriggerPostLayer)
    assert layers[0].trigger_log_id == "trigger-log-id"
    with sqlite_session_factory() as session:
        resumed_trigger = session.get(WorkflowTriggerLog, "trigger-log-id")
        assert resumed_trigger is not None
        assert resumed_trigger.status == WorkflowTriggerStatus.PAUSED


def test_resume_advanced_chat_publishes_events_for_originally_blocking_runs(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    generate_entity = _build_advanced_chat_generate_entity(conversation_id="conversation-id")
    generate_entity.stream = False
    workflow = _make_workflow()

    generator_instance = MagicMock()
    response_stream = _single_event_generator({"event": "message"})
    generator_instance.resume.return_value = response_stream
    generator = create_autospec(AdvancedChatAppGenerator, spec_set=True, return_value=generator_instance)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.AdvancedChatAppGenerator", generator)

    publish_streaming_response = MagicMock()
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._publish_streaming_response", publish_streaming_response
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_workflow_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_workflow_node_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    _resume_advanced_chat(
        knowledge_retrieval=knowledge_retrieval,
        app_model=_make_app(),
        workflow=workflow,
        user=_make_account(),
        conversation=_make_conversation(),
        message=_make_message(),
        generate_entity=generate_entity,
        graph_runtime_state=MagicMock(),
        response_stream_filter=MagicMock(),
        session_factory=sqlite_session_factory,
        pause_state_config=MagicMock(),
        workflow_run_id="workflow-run-id",
        workflow_run=_make_workflow_run(),
        session=sqlite_session,
    )

    resumed_entity = generator_instance.resume.call_args.kwargs["application_generate_entity"]
    assert resumed_entity.stream is True
    assert generator_instance.resume.call_args.kwargs["session"] is sqlite_session
    assert generator.call_args.kwargs["knowledge_retrieval"] is knowledge_retrieval
    publish_streaming_response.assert_called_once_with(
        response_stream,
        "workflow-run-id",
        AppMode.ADVANCED_CHAT,
        workflow.id,
        generate_entity.inputs,
        WorkflowStartReason.RESUMPTION,
    )


def test_resume_workflow_publishes_events_for_originally_blocking_runs(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    generate_entity = _build_workflow_generate_entity(stream=False)
    workflow = _make_workflow()

    generator_instance = MagicMock()
    response_stream = _single_event_generator({"event": "workflow_finished"})
    generator_instance.resume.return_value = response_stream
    generator = create_autospec(WorkflowAppGenerator, spec_set=True, return_value=generator_instance)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.WorkflowAppGenerator", generator)
    trigger_layer = TriggerPostLayer(datetime.now(), "resume-trigger")
    terminal_publications: list[str] = []
    monkeypatch.setattr(trigger_layer, "publish_pending_terminal", lambda: terminal_publications.append("terminal"))

    publish_streaming_response = MagicMock()
    publish_streaming_response.side_effect = lambda *_args: terminal_publications.append("stream")
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._publish_streaming_response", publish_streaming_response
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_workflow_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_workflow_node_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    workflow_run_repo = MagicMock()
    pause_entity = MagicMock()

    _resume_workflow(
        knowledge_retrieval=knowledge_retrieval,
        app_model=_make_app(),
        workflow=workflow,
        user=_make_account(),
        generate_entity=generate_entity,
        graph_runtime_state=MagicMock(),
        response_stream_filter=MagicMock(),
        session_factory=sqlite_session_factory,
        pause_state_config=MagicMock(),
        workflow_run_id="workflow-run-id",
        workflow_run=_make_workflow_run(),
        workflow_run_repo=workflow_run_repo,
        pause_entity=pause_entity,
        graph_engine_layers=(trigger_layer,),
    )

    resumed_entity = generator_instance.resume.call_args.kwargs["application_generate_entity"]
    assert resumed_entity.stream is True
    assert generator_instance.resume.call_args.kwargs["graph_engine_layers"] == (trigger_layer,)
    assert generator.call_args.kwargs["knowledge_retrieval"] is knowledge_retrieval
    publish_streaming_response.assert_called_once_with(
        response_stream,
        "workflow-run-id",
        AppMode.WORKFLOW,
        workflow.id,
        generate_entity.inputs,
        WorkflowStartReason.RESUMPTION,
    )
    assert terminal_publications == ["stream", "terminal"]
    workflow_run_repo.delete_workflow_pause.assert_called_once_with(pause_entity)


def test_resume_workflow_ignores_missing_old_pause_after_repause(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    knowledge_retrieval: KnowledgeRetriever,
):
    generate_entity = _build_workflow_generate_entity(stream=False)
    workflow = _make_workflow()

    generator_instance = MagicMock()
    response_stream = _single_event_generator({"event": "workflow_paused"})
    generator_instance.resume.return_value = response_stream
    generator = create_autospec(WorkflowAppGenerator, spec_set=True, return_value=generator_instance)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.WorkflowAppGenerator", generator)

    publish_streaming_response = MagicMock()
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._publish_streaming_response", publish_streaming_response
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_workflow_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowRepositoryFactory.create_workflow_node_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    workflow_run_repo = MagicMock()
    workflow_run_repo.delete_workflow_pause.side_effect = _WorkflowRunError("WorkflowPause not found: old-pause")
    pause_entity = MagicMock()
    runtime_state = RuntimeState(workflow_id=workflow.id, variable_pool=VariablePool(), start_at=0.0)

    _resume_workflow(
        knowledge_retrieval=knowledge_retrieval,
        app_model=_make_app(),
        workflow=workflow,
        user=_make_account(),
        generate_entity=generate_entity,
        graph_runtime_state=runtime_state,
        response_stream_filter=ResponseStreamFilter(),
        session_factory=sqlite_session_factory,
        pause_state_config=PauseStateLayerConfig(
            session_factory=sqlite_session_factory,
            state_owner_user_id=workflow.created_by,
        ),
        workflow_run_id="workflow-run-id",
        workflow_run=_make_workflow_run(),
        workflow_run_repo=workflow_run_repo,
        pause_entity=pause_entity,
    )

    publish_streaming_response.assert_called_once_with(
        response_stream,
        "workflow-run-id",
        AppMode.WORKFLOW,
        workflow.id,
        generate_entity.inputs,
        WorkflowStartReason.RESUMPTION,
    )
    assert generator.call_args.kwargs["knowledge_retrieval"] is knowledge_retrieval
    workflow_run_repo.delete_workflow_pause.assert_called_once_with(pause_entity)
