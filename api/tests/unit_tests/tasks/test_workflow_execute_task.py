from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from models.enums import CreatorUserRole
from models.model import App, AppMode, Conversation
from models.workflow import Workflow, WorkflowRun
from tasks.app_generate.workflow_execute_task import _publish_streaming_response, _resume_app_execution


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


@pytest.fixture
def mock_topic(mocker) -> MagicMock:
    topic = MagicMock()
    mocker.patch(
        "tasks.app_generate.workflow_execute_task.MessageBasedAppGenerator.get_response_topic",
        return_value=topic,
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


def test_resume_app_execution_queries_message_by_conversation_and_workflow_run(mocker):
    workflow_run_id = "run-id"
    conversation_id = "conversation-id"
    message = MagicMock()

    mocker.patch("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=object()))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    mocker.patch(
        "tasks.app_generate.workflow_execute_task.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=workflow_run_repo,
    )

    generate_entity = _build_advanced_chat_generate_entity(conversation_id)
    resumption_context = MagicMock()
    resumption_context.serialized_graph_runtime_state = "{}"
    resumption_context.get_generate_entity.return_value = generate_entity
    mocker.patch(
        "tasks.app_generate.workflow_execute_task.WorkflowResumptionContext.loads", return_value=resumption_context
    )
    mocker.patch("tasks.app_generate.workflow_execute_task.GraphRuntimeState.from_snapshot", return_value=MagicMock())

    workflow_run = SimpleNamespace(
        workflow_id="wf-id",
        app_id="app-id",
        created_by_role=CreatorUserRole.ACCOUNT.value,
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

    mocker.patch("tasks.app_generate.workflow_execute_task.Session", return_value=_FakeSessionContext(session))
    mocker.patch("tasks.app_generate.workflow_execute_task._resolve_user_for_run", return_value=MagicMock())
    resume_advanced_chat = mocker.patch("tasks.app_generate.workflow_execute_task._resume_advanced_chat")
    mocker.patch("tasks.app_generate.workflow_execute_task._resume_workflow")

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


def test_resume_app_execution_returns_early_when_advanced_chat_missing_conversation_id(mocker):
    workflow_run_id = "run-id"

    mocker.patch("tasks.app_generate.workflow_execute_task.db", SimpleNamespace(engine=object()))

    pause_entity = MagicMock()
    pause_entity.get_state.return_value = b"state"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    mocker.patch(
        "tasks.app_generate.workflow_execute_task.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=workflow_run_repo,
    )

    generate_entity = _build_advanced_chat_generate_entity(conversation_id=None)
    resumption_context = MagicMock()
    resumption_context.serialized_graph_runtime_state = "{}"
    resumption_context.get_generate_entity.return_value = generate_entity
    mocker.patch(
        "tasks.app_generate.workflow_execute_task.WorkflowResumptionContext.loads", return_value=resumption_context
    )
    mocker.patch("tasks.app_generate.workflow_execute_task.GraphRuntimeState.from_snapshot", return_value=MagicMock())

    workflow_run = SimpleNamespace(
        workflow_id="wf-id",
        app_id="app-id",
        created_by_role=CreatorUserRole.ACCOUNT.value,
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

    mocker.patch("tasks.app_generate.workflow_execute_task.Session", return_value=_FakeSessionContext(session))
    mocker.patch("tasks.app_generate.workflow_execute_task._resolve_user_for_run", return_value=MagicMock())
    resume_advanced_chat = mocker.patch("tasks.app_generate.workflow_execute_task._resume_advanced_chat")

    _resume_app_execution({"workflow_run_id": workflow_run_id})

    session.scalar.assert_not_called()
    workflow_run_repo.resume_workflow_pause.assert_not_called()
    resume_advanced_chat.assert_not_called()
