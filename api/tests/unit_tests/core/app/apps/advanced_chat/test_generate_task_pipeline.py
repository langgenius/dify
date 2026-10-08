from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.draft_variable_saver import NoopDraftVariableSaver
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueuePingEvent,
    QueueTextChunkEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import StreamEvent
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from models.base import TypeBase
from models.enums import MessageStatus
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm, HumanInputFormRecipient
from models.model import App, AppMode, Conversation, Message, MessageFile
from repositories.app.generation_repository import AppGenerationRepository
from repositories.workflow.runtime_context_repository import WorkflowRuntimeContextRepository
from services.app.generation.ports import ChatRecordSeed, ConversationSnapshot, MessageSnapshot, WorkflowSnapshot
from services.errors.message import MessageNotExistsError
from services.workflow.execution.adapters.chatflow import generate_task_pipeline as pipeline_module
from tests.unit_tests.model_factories import make_app, make_end_user


@dataclass
class MessageCase:
    pipeline: pipeline_module.AdvancedChatAppGenerateTaskPipeline
    sessions: sessionmaker[Session]

    def message(self) -> Message:
        with self.sessions() as session:
            return session.get(Message, "message-1")


@pytest.fixture
def message_store():
    # Keep the injected message database separate from the globally configured test database.
    engine = create_engine("sqlite://")
    TypeBase.metadata.create_all(
        engine,
        tables=[
            model.__table__
            for model in (
                App,
                Conversation,
                Message,
                MessageFile,
                HumanInputForm,
                HumanInputFormRecipient,
                HumanInputContent,
            )
        ],
    )
    try:
        yield sessionmaker(bind=engine, expire_on_commit=False)
    finally:
        engine.dispose()


@pytest.fixture
def app_records(message_store):
    return AppGenerationRepository(message_store)


@pytest.fixture
def message_case(app_records, message_store, *, tool_providers) -> MessageCase:
    with message_store.begin() as session:
        session.add(make_app(mode=AppMode.ADVANCED_CHAT))
        session.add(
            HumanInputForm(
                id="form-1",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_run_id="run-1",
                node_id="node-1",
                form_definition="{}",
                rendered_content="Approve?",
                expiration_time=naive_utc_now() + timedelta(days=1),
            )
        )
    conversation, message = app_records.initialize(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id=None,
        seed=ChatRecordSeed(
            conversation={
                "id": "conversation-1",
                "mode": AppMode.ADVANCED_CHAT,
                "name": "New conversation",
                "inputs": {},
                "from_source": "api",
                "from_end_user_id": "user-1",
                "from_account_id": None,
            },
            message={
                "id": "message-1",
                "inputs": {},
                "query": "hello",
                "message": "",
                "answer": "",
                "message_unit_price": 0,
                "answer_unit_price": 0,
                "currency": "USD",
                "from_source": "api",
                "from_end_user_id": "user-1",
                "invoke_from": InvokeFrom.WEB_APP,
            },
            files=[],
        ),
    )
    config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-1",
        variables=[],
        additional_features=AppAdditionalFeatures(),
    )
    entity = AdvancedChatAppGenerateEntity(
        task_id="task-1",
        app_config=config,
        inputs={},
        query="hello",
        files=[],
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
        workflow_run_id="run-1",
        extras={"trace_session_id": "trace-1"},
    )
    queue = MessageBasedAppQueueManager(
        task_id=entity.task_id,
        user_id=entity.user_id,
        invoke_from=entity.invoke_from,
        conversation_id=conversation.id,
        app_mode=AppMode.ADVANCED_CHAT,
        message_id=message.id,
    )
    pipeline = pipeline_module.AdvancedChatAppGenerateTaskPipeline(
        contexts=WorkflowRuntimeContextRepository(message_store),
        application_generate_entity=entity,
        workflow=WorkflowSnapshot("workflow-1", "tenant-1", {}),
        queue_manager=queue,
        conversation=ConversationSnapshot.from_conversation(conversation),
        message=MessageSnapshot.from_message(message),
        user=make_end_user(end_user_id="user-1"),
        stream=True,
        dialogue_count=app_records.dialogue_count(conversation.id),
        draft_var_saver_factory=lambda *_args, **_kwargs: NoopDraftVariableSaver(),
        chat_records=app_records,
        tool_providers=tool_providers,
    )
    pipeline._graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(
            system_variables=build_system_variables(workflow_execution_id="run-1")
        ),
        start_at=0,
    )
    pipeline._workflow_run_id = "run-1"
    return MessageCase(pipeline, message_store)


def _build_pipeline() -> pipeline_module.AdvancedChatAppGenerateTaskPipeline:
    pipeline = pipeline_module.AdvancedChatAppGenerateTaskPipeline.__new__(
        pipeline_module.AdvancedChatAppGenerateTaskPipeline
    )
    pipeline._workflow_run_id = "run-1"
    pipeline._message_id = "message-1"
    pipeline._workflow_tenant_id = "tenant-1"
    return pipeline


def test_process_passes_message_id_to_conversation_name_generation(message_case, monkeypatch):
    pipeline = message_case.pipeline
    calls = []
    monkeypatch.setattr(
        pipeline._message_cycle_manager, "generate_conversation_name", lambda **kwargs: calls.append(kwargs)
    )
    monkeypatch.setattr(pipeline, "_wrapper_process_stream_response", lambda **kwargs: iter(()))
    assert list(pipeline.process()) == []
    assert calls == [{"conversation_id": "conversation-1", "query": "hello", "message_id": "message-1"}]


@pytest.mark.parametrize("form_exists", [True, False])
def test_human_input_association_is_persisted_once(message_case, form_exists):
    pipeline = message_case.pipeline
    node = "node-1" if form_exists else "missing"
    pipeline._persist_human_input_extra_content(node_id=node)
    pipeline._persist_human_input_extra_content(node_id=node)
    with message_case.sessions() as session:
        rows = list(session.scalars(select(HumanInputContent)))
        assert [(row.message_id, row.form_id) for row in rows] == ([("message-1", "form-1")] if form_exists else [])


def test_pause_is_committed_before_client_observes_event(message_case):
    pipeline = message_case.pipeline
    list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))
    pipeline._task_state.answer = "before"
    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Approve?",
        inputs=[],
        actions=[],
        node_id="node-1",
        node_title="Approval",
        resolved_default_values={},
    )
    responses = pipeline._handle_workflow_paused_event(
        QueueWorkflowPausedEvent(reasons=[reason], outputs={}, paused_nodes=["node-1"])
    )
    next(responses)
    assert message_case.message().status == MessageStatus.PAUSED
    assert message_case.message().answer == "before"
    with message_case.sessions() as session:
        assert session.scalar(select(HumanInputContent.form_id)) == "form-1"
    responses.close()


def test_resume_appends_chunks_and_resets_paused_status(message_case):
    pipeline = message_case.pipeline
    pipeline._task_state.answer = "before"
    pipeline._save_message(paused=True)
    pipeline._seed_task_state_from_message(MessageSnapshot.from_message(message_case.message()))
    list(pipeline._handle_text_chunk_event(QueueTextChunkEvent(text="after")))
    pipeline._save_message()
    assert message_case.message().answer == "beforeafter"
    assert message_case.message().status == MessageStatus.NORMAL


def test_start_completion_files_and_error_use_initialization_database(message_case):
    pipeline = message_case.pipeline
    list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))
    assert message_case.message().workflow_run_id == "run-1"
    pipeline._task_state.answer = "done"
    pipeline._recorded_files = [
        {"type": "image", "transfer_method": "remote_url", "remote_url": "https://example.com/a.png"}
    ]
    responses = list(pipeline._handle_workflow_succeeded_event(QueueWorkflowSucceededEvent(outputs={})))
    assert responses[0].event == StreamEvent.MESSAGE_END
    assert message_case.message().answer == "done"
    with message_case.sessions() as session:
        file = session.scalar(select(MessageFile))
        assert file.message_id == "message-1"
        assert file.created_by == "user-1"
    list(pipeline._handle_error_event(QueueErrorEvent(error=ValueError("failed"))))
    assert message_case.message().status == MessageStatus.ERROR
    assert message_case.message().error == "failed"


def test_failed_attachment_write_rolls_back_answer_and_status(message_case):
    pipeline = message_case.pipeline
    pipeline._task_state.answer = "uncommitted"
    pipeline._recorded_files = [
        {"type": "image", "transfer_method": "remote_url", "remote_url": "https://example.com/a.png"}
    ]
    engine = message_case.sessions.kw["bind"]

    def fail_file(_conn, _cursor, sql, _params, _ctx, _many):
        if sql.startswith("INSERT INTO message_files"):
            raise RuntimeError("file write failed")

    event.listen(engine, "before_cursor_execute", fail_file)
    try:
        with pytest.raises(RuntimeError, match="file write failed"):
            pipeline._save_message(paused=True)
    finally:
        event.remove(engine, "before_cursor_execute", fail_file)
    assert message_case.message().answer == ""
    assert message_case.message().status == MessageStatus.NORMAL


def test_deleted_message_does_not_suppress_start_or_error_event(message_case):
    with message_case.sessions.begin() as session:
        session.delete(session.get(Message, "message-1"))
    pipeline = message_case.pipeline
    assert list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))
    responses = list(pipeline._handle_error_event(QueueErrorEvent(error=ValueError("failed"))))
    assert len(responses) == 1
    assert str(responses[0].err) == "failed"


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "conversation_id"])
def test_message_writes_check_owner_chain(message_case, field):
    pipeline = message_case.pipeline
    pipeline._message_identity = replace(pipeline._message_identity, **{field: "foreign"})
    with pytest.raises(MessageNotExistsError):
        pipeline._save_message()
    assert message_case.message().answer == ""


def test_trace_is_enqueued_after_message_commit(message_case):
    pipeline = message_case.pipeline
    traces = []

    class TraceRecorder:
        def add_trace_task(self, task):
            assert message_case.message().answer == "done"
            traces.append(task)

    pipeline._application_generate_entity.trace_manager = TraceRecorder()
    pipeline._task_state.answer = "done"
    pipeline._save_message()
    assert traces == []
    pipeline._emit_message_trace()
    assert len(traces) == 1
    assert traces[0].message_id == "message-1"
    assert traces[0].kwargs["trace_session_id"] == "trace-1"


def test_workflow_succeeded_emits_message_end_before_workflow_finished() -> None:
    pipeline = _build_pipeline()
    pipeline._application_generate_entity = SimpleNamespace(task_id="task-1")
    pipeline._workflow_id = "workflow-1"
    pipeline._ensure_workflow_initialized = mock.Mock()
    runtime_state = SimpleNamespace()
    pipeline._ensure_graph_runtime_initialized = mock.Mock(return_value=runtime_state)
    pipeline._handle_advanced_chat_message_end_event = mock.Mock(
        return_value=iter([SimpleNamespace(event=StreamEvent.MESSAGE_END)])
    )
    pipeline._workflow_response_converter = mock.Mock()
    pipeline._workflow_response_converter.workflow_finish_to_stream_response.return_value = SimpleNamespace(
        event=StreamEvent.WORKFLOW_FINISHED,
        data=SimpleNamespace(status=WorkflowExecutionStatus.SUCCEEDED),
    )

    event = QueueWorkflowSucceededEvent(outputs={})
    responses = list(pipeline._handle_workflow_succeeded_event(event))

    assert [resp.event for resp in responses] == [StreamEvent.MESSAGE_END, StreamEvent.WORKFLOW_FINISHED]


def test_workflow_partial_success_emits_message_end_before_workflow_finished() -> None:
    pipeline = _build_pipeline()
    pipeline._application_generate_entity = SimpleNamespace(task_id="task-1")
    pipeline._workflow_id = "workflow-1"
    pipeline._ensure_workflow_initialized = mock.Mock()
    runtime_state = SimpleNamespace()
    pipeline._ensure_graph_runtime_initialized = mock.Mock(return_value=runtime_state)
    pipeline._handle_advanced_chat_message_end_event = mock.Mock(
        return_value=iter([SimpleNamespace(event=StreamEvent.MESSAGE_END)])
    )
    pipeline._workflow_response_converter = mock.Mock()
    pipeline._workflow_response_converter.workflow_finish_to_stream_response.return_value = SimpleNamespace(
        event=StreamEvent.WORKFLOW_FINISHED,
        data=SimpleNamespace(status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED),
    )

    event = QueueWorkflowPartialSuccessEvent(exceptions_count=1, outputs={})
    responses = list(pipeline._handle_workflow_partial_success_event(event))

    assert [resp.event for resp in responses] == [StreamEvent.MESSAGE_END, StreamEvent.WORKFLOW_FINISHED]


def test_process_stream_response_breaks_after_workflow_succeeded() -> None:
    pipeline = _build_pipeline()
    succeeded_event = QueueWorkflowSucceededEvent(outputs={})
    ping_event = QueuePingEvent()
    queue_messages = [
        SimpleNamespace(event=succeeded_event),
        SimpleNamespace(event=ping_event),
    ]

    pipeline._conversation_name_generate_thread = None
    pipeline._base_task_pipeline = mock.Mock()
    pipeline._base_task_pipeline.queue_manager = mock.Mock()
    pipeline._base_task_pipeline.queue_manager.listen.return_value = iter(queue_messages)
    pipeline._base_task_pipeline.ping_stream_response = mock.Mock(return_value=SimpleNamespace(event=StreamEvent.PING))
    pipeline._handle_workflow_succeeded_event = mock.Mock(
        return_value=iter([SimpleNamespace(event=StreamEvent.WORKFLOW_FINISHED)])
    )

    responses = list(pipeline._process_stream_response())

    assert [resp.event for resp in responses] == [StreamEvent.WORKFLOW_FINISHED]
    pipeline._handle_workflow_succeeded_event.assert_called_once_with(succeeded_event, trace_manager=None)
    pipeline._base_task_pipeline.ping_stream_response.assert_not_called()


def test_process_stream_response_breaks_after_workflow_partial_success() -> None:
    pipeline = _build_pipeline()
    partial_event = QueueWorkflowPartialSuccessEvent(exceptions_count=1, outputs={})
    ping_event = QueuePingEvent()
    queue_messages = [
        SimpleNamespace(event=partial_event),
        SimpleNamespace(event=ping_event),
    ]

    pipeline._conversation_name_generate_thread = None
    pipeline._base_task_pipeline = mock.Mock()
    pipeline._base_task_pipeline.queue_manager = mock.Mock()
    pipeline._base_task_pipeline.queue_manager.listen.return_value = iter(queue_messages)
    pipeline._base_task_pipeline.ping_stream_response = mock.Mock(return_value=SimpleNamespace(event=StreamEvent.PING))
    pipeline._handle_workflow_partial_success_event = mock.Mock(
        return_value=iter([SimpleNamespace(event=StreamEvent.WORKFLOW_FINISHED)])
    )

    responses = list(pipeline._process_stream_response())

    assert [resp.event for resp in responses] == [StreamEvent.WORKFLOW_FINISHED]
    pipeline._handle_workflow_partial_success_event.assert_called_once_with(partial_event, trace_manager=None)
    pipeline._base_task_pipeline.ping_stream_response.assert_not_called()
