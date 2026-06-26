from __future__ import annotations

import json
import logging
import uuid
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.model import App, AppMode, Conversation
from models.workflow import Workflow, WorkflowRun
from repositories.sqlalchemy_api_workflow_run_repository import _WorkflowRunError
from tasks.app_generate import workflow_execute_task as workflow_execute_task_module
from tasks.app_generate.workflow_execute_task import (
    AppExecutionParams,
    _AppRunner,
    _publish_streaming_response,
    _resume_advanced_chat,
    _resume_app_execution,
    _resume_workflow,
)


class _FakeSessionContext:
    def __init__(self, session: MagicMock):
        self._session = session

    def __enter__(self) -> MagicMock:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _StreamEventModel(BaseModel):
    event: object | None = None
    task_id: object | None = None


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
    mock_topic: MagicMock, monkeypatch
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
    runner = _AppRunner(session_factory=MagicMock(), exec_params=exec_params)

    workflow = SimpleNamespace(id="workflow-id", app_id="app-id", created_by="workflow-owner")
    app = SimpleNamespace(id="app-id")
    fake_session = MagicMock()
    fake_session.get.side_effect = [workflow, app]

    monkeypatch.setattr(runner, "_session", lambda: nullcontext(fake_session))
    monkeypatch.setattr(runner, "_resolve_user", lambda: MagicMock())
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


def test_app_runner_streaming_failure_keeps_existing_pre_runtime_helper_behavior(
    mock_topic: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
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
    runner = _AppRunner(session_factory=MagicMock(), exec_params=exec_params)

    workflow = SimpleNamespace(id="workflow-id", app_id="app-id", created_by="workflow-owner")
    app = SimpleNamespace(id="app-id")
    fake_session = MagicMock()
    fake_session.get.side_effect = [workflow, app]

    monkeypatch.setattr(runner, "_session", lambda: nullcontext(fake_session))
    monkeypatch.setattr(runner, "_resolve_user", lambda: MagicMock())
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
    runner = _AppRunner(session_factory=MagicMock(), exec_params=exec_params)

    workflow = SimpleNamespace(id="workflow-id", app_id="app-id", created_by="workflow-owner")
    app = SimpleNamespace(id="app-id")
    fake_session = MagicMock()
    fake_session.get.side_effect = [workflow, app]
    response_stream = _single_event_generator({"event": "message"})
    publish_streaming_response = MagicMock()

    monkeypatch.setattr(runner, "_session", lambda: nullcontext(fake_session))
    monkeypatch.setattr(runner, "_resolve_user", lambda: MagicMock())
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


def test_resume_app_execution_queries_message_by_conversation_and_workflow_run(monkeypatch: pytest.MonkeyPatch):
    workflow_run_id = "run-id"
    conversation_id = "conversation-id"
    message = MagicMock()

    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=object()))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
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
        "tasks.app_generate.workflow_execute_task.GraphRuntimeState.from_snapshot",
        lambda *_args, **_kwargs: MagicMock(),
    )

    workflow_run = SimpleNamespace(
        workflow_id="wf-id",
        app_id="app-id",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-id",
        tenant_id="tenant-id",
    )
    workflow = SimpleNamespace(created_by="workflow-owner")
    app_model = SimpleNamespace(id="app-id")
    conversation = SimpleNamespace(id=conversation_id)

    session = MagicMock()

    def _session_get(model, key):
        if model is WorkflowRun:
            return workflow_run
        if model is Workflow:
            return workflow
        if model is App:
            return app_model
        if model is Conversation:
            return conversation
        return None

    session.get.side_effect = _session_get
    session.scalar.return_value = message

    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.Session", lambda *_args, **_kwargs: _FakeSessionContext(session)
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._resolve_user_for_run", lambda *_args, **_kwargs: MagicMock()
    )
    resume_advanced_chat = MagicMock()
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_advanced_chat", resume_advanced_chat)
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_workflow", MagicMock())

    _resume_app_execution({"workflow_run_id": workflow_run_id})

    stmt = session.scalar.call_args.args[0]
    stmt_text = str(stmt)
    assert "messages.conversation_id = :conversation_id_1" in stmt_text
    assert "messages.workflow_run_id = :workflow_run_id_1" in stmt_text
    assert "ORDER BY messages.created_at DESC" in stmt_text
    assert " LIMIT " in stmt_text

    compiled_params = stmt.compile().params
    assert conversation_id in compiled_params.values()
    assert workflow_run_id in compiled_params.values()

    workflow_run_repo.resume_workflow_pause.assert_called_once_with(workflow_run_id, pause_entity)
    resume_advanced_chat.assert_called_once()
    assert resume_advanced_chat.call_args.kwargs["conversation"] is conversation
    assert resume_advanced_chat.call_args.kwargs["message"] is message


def test_resume_app_execution_returns_early_when_advanced_chat_missing_conversation_id(
    monkeypatch: pytest.MonkeyPatch,
):
    workflow_run_id = "run-id"

    monkeypatch.setattr("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=object()))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
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
        "tasks.app_generate.workflow_execute_task.GraphRuntimeState.from_snapshot",
        lambda *_args, **_kwargs: MagicMock(),
    )

    workflow_run = SimpleNamespace(
        workflow_id="wf-id",
        app_id="app-id",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-id",
        tenant_id="tenant-id",
    )
    workflow = SimpleNamespace(created_by="workflow-owner")
    app_model = SimpleNamespace(id="app-id")

    session = MagicMock()

    def _session_get(model, key):
        if model is WorkflowRun:
            return workflow_run
        if model is Workflow:
            return workflow
        if model is App:
            return app_model
        return None

    session.get.side_effect = _session_get

    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.Session", lambda *_args, **_kwargs: _FakeSessionContext(session)
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._resolve_user_for_run", lambda *_args, **_kwargs: MagicMock()
    )
    resume_advanced_chat = MagicMock()
    monkeypatch.setattr("tasks.app_generate.workflow_execute_task._resume_advanced_chat", resume_advanced_chat)

    _resume_app_execution({"workflow_run_id": workflow_run_id})

    session.scalar.assert_not_called()
    workflow_run_repo.resume_workflow_pause.assert_not_called()
    resume_advanced_chat.assert_not_called()


def test_resume_advanced_chat_publishes_events_for_originally_blocking_runs(monkeypatch: pytest.MonkeyPatch):
    generate_entity = _build_advanced_chat_generate_entity(conversation_id="conversation-id")
    generate_entity.stream = False
    workflow = SimpleNamespace(id="workflow-id", created_by="workflow-owner")
    trace_manager = object()

    generator_instance = MagicMock()
    response_stream = _single_event_generator({"event": "message"})
    generator_instance.resume.return_value = response_stream
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.AdvancedChatAppGenerator",
        lambda: generator_instance,
    )

    publish_streaming_response = MagicMock()
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._publish_streaming_response", publish_streaming_response
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.TraceQueueManager",
        lambda app_id, user_id: trace_manager,
    )

    _resume_advanced_chat(
        app_model=SimpleNamespace(id="app-id"),
        workflow=workflow,
        user=MagicMock(),
        conversation=SimpleNamespace(id="conversation-id"),
        message=MagicMock(),
        generate_entity=generate_entity,
        graph_runtime_state=MagicMock(),
        session_factory=MagicMock(),
        pause_state_config=MagicMock(),
        workflow_run_id="workflow-run-id",
        workflow_run=SimpleNamespace(triggered_from="app_run"),
    )

    resumed_entity = generator_instance.resume.call_args.kwargs["application_generate_entity"]
    assert resumed_entity.stream is True
    assert resumed_entity.trace_manager is trace_manager
    publish_streaming_response.assert_called_once_with(
        response_stream,
        "workflow-run-id",
        AppMode.ADVANCED_CHAT,
        workflow.id,
        generate_entity.inputs,
        WorkflowStartReason.RESUMPTION,
    )


def test_resume_workflow_publishes_events_for_originally_blocking_runs(monkeypatch: pytest.MonkeyPatch):
    generate_entity = _build_workflow_generate_entity(stream=False)
    workflow = SimpleNamespace(id="workflow-id", created_by="workflow-owner")
    trace_manager = object()

    generator_instance = MagicMock()
    response_stream = _single_event_generator({"event": "workflow_finished"})
    generator_instance.resume.return_value = response_stream
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowAppGenerator",
        lambda: generator_instance,
    )

    publish_streaming_response = MagicMock()
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._publish_streaming_response", publish_streaming_response
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.TraceQueueManager",
        lambda app_id, user_id: trace_manager,
    )
    workflow_run_repo = MagicMock()
    pause_entity = MagicMock()

    _resume_workflow(
        app_model=SimpleNamespace(id="app-id"),
        workflow=workflow,
        user=MagicMock(),
        generate_entity=generate_entity,
        graph_runtime_state=MagicMock(),
        session_factory=MagicMock(),
        pause_state_config=MagicMock(),
        workflow_run_id="workflow-run-id",
        workflow_run=SimpleNamespace(triggered_from="app_run"),
        workflow_run_repo=workflow_run_repo,
        pause_entity=pause_entity,
    )

    resumed_entity = generator_instance.resume.call_args.kwargs["application_generate_entity"]
    assert resumed_entity.stream is True
    assert resumed_entity.trace_manager is trace_manager
    publish_streaming_response.assert_called_once_with(
        response_stream,
        "workflow-run-id",
        AppMode.WORKFLOW,
        workflow.id,
        generate_entity.inputs,
        WorkflowStartReason.RESUMPTION,
    )
    workflow_run_repo.delete_workflow_pause.assert_called_once_with(pause_entity)


def test_resume_workflow_ignores_missing_old_pause_after_repause(monkeypatch: pytest.MonkeyPatch):
    generate_entity = _build_workflow_generate_entity(stream=False)
    workflow = SimpleNamespace(id="workflow-id", created_by="workflow-owner")
    trace_manager = object()

    generator_instance = MagicMock()
    response_stream = _single_event_generator({"event": "workflow_paused"})
    generator_instance.resume.return_value = response_stream
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.WorkflowAppGenerator",
        lambda: generator_instance,
    )

    publish_streaming_response = MagicMock()
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task._publish_streaming_response", publish_streaming_response
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        lambda **kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.TraceQueueManager",
        lambda app_id, user_id: trace_manager,
    )
    workflow_run_repo = MagicMock()
    workflow_run_repo.delete_workflow_pause.side_effect = _WorkflowRunError("WorkflowPause not found: old-pause")
    pause_entity = MagicMock()

    _resume_workflow(
        app_model=SimpleNamespace(id="app-id"),
        workflow=workflow,
        user=MagicMock(),
        generate_entity=generate_entity,
        graph_runtime_state=MagicMock(),
        session_factory=MagicMock(),
        pause_state_config=MagicMock(),
        workflow_run_id="workflow-run-id",
        workflow_run=SimpleNamespace(triggered_from="app_run"),
        workflow_run_repo=workflow_run_repo,
        pause_entity=pause_entity,
    )

    resumed_entity = generator_instance.resume.call_args.kwargs["application_generate_entity"]
    assert resumed_entity.stream is True
    assert resumed_entity.trace_manager is trace_manager
    publish_streaming_response.assert_called_once_with(
        response_stream,
        "workflow-run-id",
        AppMode.WORKFLOW,
        workflow.id,
        generate_entity.inputs,
        WorkflowStartReason.RESUMPTION,
    )
    workflow_run_repo.delete_workflow_pause.assert_called_once_with(pause_entity)
