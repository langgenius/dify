from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from models.enums import CreatorUserRole
from models.model import App, AppMode, Conversation
from models.workflow import Workflow, WorkflowRun
from repositories.sqlalchemy_api_workflow_run_repository import _WorkflowRunError
from tasks.app_generate.workflow_execute_task import (
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
    response_stream = iter([{"event": "foo"}, "ping"])

    _publish_streaming_response(response_stream, workflow_run_id, app_mode=AppMode.ADVANCED_CHAT)

    payloads = [call.args[0] for call in mock_topic.publish.call_args_list]
    assert payloads == [json.dumps({"event": "foo"}).encode(), json.dumps("ping").encode()]


def test_publish_streaming_response_coerces_string_uuid(mock_topic: MagicMock):
    workflow_run_id = uuid.uuid4()
    response_stream = iter([{"event": "bar"}])

    _publish_streaming_response(response_stream, str(workflow_run_id), app_mode=AppMode.ADVANCED_CHAT)

    mock_topic.publish.assert_called_once_with(json.dumps({"event": "bar"}).encode())


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

    _resume_advanced_chat(
        app_model=SimpleNamespace(id="app-id"),
        workflow=SimpleNamespace(created_by="workflow-owner"),
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
    publish_streaming_response.assert_called_once_with(response_stream, "workflow-run-id", AppMode.ADVANCED_CHAT)


def test_resume_workflow_publishes_events_for_originally_blocking_runs(monkeypatch: pytest.MonkeyPatch):
    generate_entity = _build_workflow_generate_entity(stream=False)

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
    workflow_run_repo = MagicMock()
    pause_entity = MagicMock()

    _resume_workflow(
        app_model=SimpleNamespace(id="app-id"),
        workflow=SimpleNamespace(created_by="workflow-owner"),
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
    publish_streaming_response.assert_called_once_with(response_stream, "workflow-run-id", AppMode.WORKFLOW)
    workflow_run_repo.delete_workflow_pause.assert_called_once_with(pause_entity)


def test_resume_workflow_ignores_missing_old_pause_after_repause(monkeypatch: pytest.MonkeyPatch):
    generate_entity = _build_workflow_generate_entity(stream=False)

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
    workflow_run_repo = MagicMock()
    workflow_run_repo.delete_workflow_pause.side_effect = _WorkflowRunError("WorkflowPause not found: old-pause")
    pause_entity = MagicMock()

    _resume_workflow(
        app_model=SimpleNamespace(id="app-id"),
        workflow=SimpleNamespace(created_by="workflow-owner"),
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

    publish_streaming_response.assert_called_once_with(response_stream, "workflow-run-id", AppMode.WORKFLOW)
    workflow_run_repo.delete_workflow_pause.assert_called_once_with(pause_entity)
