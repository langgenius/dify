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
    QueueAdvancedChatMessageEndEvent,
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueMessageReplaceEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueuePingEvent,
    QueueReasoningChunkEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import (
    AdvancedChatPausedBlockingResponse,
    AnnotationReply,
    AnnotationReplyAccount,
    HumanInputRequiredResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    PingStreamResponse,
    ReasoningChunkStreamResponse,
    StreamEvent,
)
from core.base.tts.app_generator_tts_publisher import AudioTrunk
from core.workflow.nodes.human_input.pause_reason import DifyHITLEventType, HumanInputRequired
from core.workflow.system_variables import build_system_variables
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus, WorkflowType
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime import RuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from models.base import TypeBase
from models.enums import CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm, HumanInputFormRecipient
from models.human_input_entities import UserActionConfig
from models.model import App, AppMode, Conversation, EndUser, Message, MessageFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowPause, WorkflowRun
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.app.generation_repository import AppGenerationRepository
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from repositories.workflow.runtime_context_repository import WorkflowRuntimeContextRepository
from services.app.generation.ports import ChatRecordSeed, ConversationSnapshot, MessageSnapshot, WorkflowSnapshot
from services.errors.message import MessageNotExistsError
from services.workflow.execution.adapters.chatflow import generate_task_pipeline as pipeline_module
from services.workflow.execution.adapters.chatflow.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from tests.helpers.unit.model_factories import make_app, make_conversation, make_end_user
from tests.workflow_test_utils import build_test_variable_pool


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
                WorkflowRun,
                WorkflowPause,
                WorkflowNodeExecutionModel,
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
def runtime_app_records(sqlite_session_factory: sessionmaker[Session]) -> AppGenerationRepository:
    return AppGenerationRepository(sqlite_session_factory)


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
                "_inputs": {},
                "from_source": "api",
                "from_end_user_id": "user-1",
                "from_account_id": None,
            },
            message={
                "id": "message-1",
                "_inputs": {},
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
    pipeline._graph_runtime_state = RuntimeState(
        workflow_id="workflow-1",
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
    form_id = "form-1" if form_exists else None
    pipeline._persist_human_input_extra_content(form_id=form_id, node_id=node)
    pipeline._persist_human_input_extra_content(form_id=form_id, node_id=node)
    with message_case.sessions() as session:
        rows = list(session.scalars(select(HumanInputContent)))
        assert [(row.message_id, row.form_id) for row in rows] == ([("message-1", "form-1")] if form_exists else [])


@pytest.mark.parametrize("stop_after_pause", [False, True])
def test_pause_does_not_overwrite_a_concurrent_stop(message_case, stop_after_pause):
    pipeline = message_case.pipeline
    pipeline._workflow_response_converter.workflow_pause_to_stream_response = lambda **_kwargs: ["pause"]
    with message_case.sessions.begin() as session:
        session.add(
            WorkflowRun(
                id="run-1",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_id="workflow-1",
                task_id="task-1",
                type=ModelWorkflowType(WorkflowType.CHAT),
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="1",
                status=WorkflowExecutionStatus.PAUSED,
                created_by_role=CreatorUserRole.END_USER,
                created_by="user-1",
            )
        )
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
    assert next(responses) == "pause"
    if stop_after_pause:
        repository = DifyAPISQLAlchemyWorkflowRunRepository(message_case.sessions)
        repository.stop_paused_workflow_task(tenant_id="tenant-1", app_id="app-1", task_id="task-1", owner=None)
    assert list(responses) == []
    assert message_case.message().status == (MessageStatus.NORMAL if stop_after_pause else MessageStatus.PAUSED)
    assert message_case.message().answer == "before"
    with message_case.sessions() as session:
        assert session.scalar(select(HumanInputContent.form_id)) == "form-1"


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


def _make_pipeline(app_records=None):
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant",
        app_id="app",
        app_mode=AppMode.ADVANCED_CHAT,
        additional_features=AppAdditionalFeatures(),
        variables=[],
        workflow_id="workflow-id",
    )
    application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
        task_id="task",
        app_config=app_config,
        inputs={},
        query="hello",
        files=[],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        trace_manager=None,
        workflow_run_id="run-id",
    )

    message = MessageSnapshot(
        id="message-id",
        query="hello",
        created_at=naive_utc_now(),
        status=MessageStatus.NORMAL,
        answer="",
    )
    conversation = ConversationSnapshot(id="conv-id", mode=AppMode.ADVANCED_CHAT)
    workflow = WorkflowSnapshot(id="workflow-id", tenant_id="tenant", features_dict={})
    user = EndUser(tenant_id="tenant", type="session", name="tester", session_id="session")

    pipeline = AdvancedChatAppGenerateTaskPipeline(
        contexts=mock.MagicMock(),
        chat_records=app_records or mock.MagicMock(),
        application_generate_entity=application_generate_entity,
        workflow=workflow,
        queue_manager=SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None),
        conversation=conversation,
        message=message,
        user=user,
        stream=False,
        dialogue_count=1,
        draft_var_saver_factory=lambda **kwargs: None,
        tool_providers=mock.MagicMock(),
    )

    return pipeline


def _persist_message(session: Session, *, message_id: str = "message-id") -> Message:
    message = Message(
        app_id="app",
        model_provider="provider",
        model_id="model",
        override_model_configs=None,
        conversation_id="conv-id",
        _inputs={},
        query="hello",
        message="",
        message_tokens=0,
        message_unit_price=0,
        message_price_unit=0,
        answer="",
        answer_tokens=0,
        answer_unit_price=0,
        answer_price_unit=0,
        parent_message_id=None,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.WEB_APP,
        from_source="api",
        from_end_user_id="end-user",
        from_account_id=None,
        app_mode=AppMode.ADVANCED_CHAT,
        status=MessageStatus.PAUSED,
    )
    message.id = message_id
    if session.get(App, "app") is None:
        session.add(make_app(app_id="app", tenant_id="tenant"))
    if session.get(Conversation, "conv-id") is None:
        session.add(make_conversation(conversation_id="conv-id", app_id="app", inputs={}, from_source="api"))
    session.add(message)
    session.commit()
    return message


class TestAdvancedChatGenerateTaskPipeline:
    def test_ensure_workflow_initialized_raises(self):
        pipeline = _make_pipeline()

        with pytest.raises(ValueError, match="workflow run not initialized"):
            pipeline._ensure_workflow_initialized()

    def test_to_blocking_response_returns_message_end(self):
        pipeline = _make_pipeline()
        pipeline._task_state.answer = "done"

        def _gen():
            yield MessageEndStreamResponse(task_id="task", id="message-id", metadata={"k": "v"})

        response = pipeline._to_blocking_response(_gen())

        assert response.data.answer == "done"
        assert response.data.metadata == {"k": "v"}

    def test_to_blocking_response_falls_back_to_human_input_required_when_pause_event_missing(self):
        pipeline = _make_pipeline()
        pipeline._task_state.answer = "partial answer"
        pipeline._workflow_run_id = "run-id"
        pipeline._graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=build_test_variable_pool(
                variables=build_system_variables(workflow_execution_id="run-id"),
            ),
            start_at=0.0,
            llm_usage=LLMUsage.empty_usage().model_copy(update={"total_tokens": 7}),
            node_run_steps=3,
        )

        def _gen():
            yield HumanInputRequiredResponse(
                task_id="task",
                workflow_run_id="run-id",
                data=HumanInputRequiredResponse.Data(
                    form_id="form-1",
                    node_id="node-1",
                    node_title="Approval",
                    form_content="Need approval",
                    inputs=[],
                    actions=[UserActionConfig(id="approve", title="Approve")],
                    display_in_ui=True,
                    form_token="token-1",
                    resolved_default_values={},
                    expiration_time=123,
                ),
            )

        response = pipeline._to_blocking_response(_gen())

        assert isinstance(response, AdvancedChatPausedBlockingResponse)
        assert response.data.workflow_run_id == "run-id"
        assert response.data.status == "paused"
        assert response.data.paused_nodes == ["node-1"]
        assert response.data.reasons == [
            {
                "TYPE": DifyHITLEventType.HUMAN_INPUT_REQUIRED,
                "form_version": "1",
                "form_id": "form-1",
                "node_id": "node-1",
                "node_title": "Approval",
                "form_content": "Need approval",
                "inputs": [],
                "actions": [{"id": "approve", "title": "Approve", "button_style": "default"}],
                "display_in_ui": True,
                "form_token": "token-1",
                "approval_channels": [],
                "resolved_default_values": {},
                "expiration_time": 123,
            }
        ]

    def test_handle_text_chunk_event_updates_state(self):
        pipeline = _make_pipeline()
        pipeline._message_cycle_manager = SimpleNamespace(
            message_to_stream_response=lambda **kwargs: MessageEndStreamResponse(
                task_id="task", id="message-id", metadata={}
            )
        )

        event = SimpleNamespace(text="hi", from_variable_selector=None)

        responses = list(pipeline._handle_text_chunk_event(event))

        assert pipeline._task_state.answer == "hi"
        assert responses

    def test_handle_reasoning_chunk_event_emits_on_nonempty(self):
        pipeline = _make_pipeline()
        event = QueueReasoningChunkEvent(reasoning="pondering", from_node_id="llm-1", is_final=False)

        responses = list(pipeline._handle_reasoning_chunk_event(event))

        assert len(responses) == 1
        response = responses[0]
        assert isinstance(response, ReasoningChunkStreamResponse)
        assert response.data.message_id == pipeline._message_id
        assert response.data.reasoning == "pondering"
        assert response.data.node_id == "llm-1"
        assert response.data.is_final is False
        # reasoning never touches the answer stream
        assert pipeline._task_state.answer == ""

    def test_handle_reasoning_chunk_event_drops_empty_nonfinal(self):
        pipeline = _make_pipeline()
        event = QueueReasoningChunkEvent(reasoning="", from_node_id="llm-1", is_final=False)

        responses = list(pipeline._handle_reasoning_chunk_event(event))

        assert responses == []

    def test_handle_reasoning_chunk_event_emits_empty_final_marker(self):
        pipeline = _make_pipeline()
        event = QueueReasoningChunkEvent(reasoning="", from_node_id="llm-1", is_final=True)

        responses = list(pipeline._handle_reasoning_chunk_event(event))

        assert len(responses) == 1
        response = responses[0]
        assert isinstance(response, ReasoningChunkStreamResponse)
        assert response.data.reasoning == ""
        assert response.data.is_final is True

    def test_listen_audio_msg_returns_audio_stream(self):
        pipeline = _make_pipeline()
        publisher = SimpleNamespace(check_and_get_audio=lambda: AudioTrunk(status="responding", audio="data"))

        response = pipeline._listen_audio_msg(publisher=publisher, task_id="task")

        assert isinstance(response, MessageAudioStreamResponse)

    def test_handle_ping_event(self):
        pipeline = _make_pipeline()
        pipeline._base_task_pipeline.ping_stream_response = lambda: PingStreamResponse(task_id="task")

        responses = list(pipeline._handle_ping_event(QueuePingEvent()))

        assert isinstance(responses[0], PingStreamResponse)

    def test_handle_error_event(self):
        pipeline = _make_pipeline()
        pipeline._base_task_pipeline.handle_error = lambda **kwargs: ValueError("boom")
        pipeline._base_task_pipeline.error_to_stream_response = lambda err: err

        responses = list(pipeline._handle_error_event(QueueErrorEvent(error=ValueError("boom"))))

        assert isinstance(responses[0], ValueError)

    def test_handle_workflow_started_event_sets_run_id(self, runtime_app_records, sqlite_session: Session):
        pipeline = _make_pipeline(runtime_app_records)
        message = _persist_message(sqlite_session)
        other_message = _persist_message(sqlite_session, message_id="other-message-id")
        pipeline._graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=build_test_variable_pool(variables=build_system_variables(workflow_execution_id="run-id")),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_start_to_stream_response = lambda **kwargs: "started"

        responses = list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))

        assert pipeline._workflow_run_id == "run-id"
        assert responses == ["started"]

        sqlite_session.refresh(message)
        sqlite_session.refresh(other_message)
        assert message.workflow_run_id == "run-id"
        assert other_message.workflow_run_id is None

    def test_message_end_to_stream_response_strips_annotation_reply(self):
        pipeline = _make_pipeline()
        pipeline._task_state.metadata.annotation_reply = AnnotationReply(
            id="ann",
            account=AnnotationReplyAccount(id="acc", name="acc"),
        )

        response = pipeline._message_end_to_stream_response()

        assert "annotation_reply" not in response.metadata

    def test_handle_output_moderation_chunk_publishes_stop(self):
        pipeline = _make_pipeline()
        events: list[object] = []

        class _Moderation:
            def should_direct_output(self):
                return True

            def get_final_output(self):
                return "final"

        pipeline._base_task_pipeline.output_moderation_handler = _Moderation()
        pipeline._base_task_pipeline.queue_manager = SimpleNamespace(
            publish=lambda event, pub_from: events.append(event)
        )

        result = pipeline._handle_output_moderation_chunk("ignored")

        assert result is True
        assert pipeline._task_state.answer == "final"
        assert any(isinstance(event, QueueTextChunkEvent) for event in events)
        assert any(isinstance(event, QueueStopEvent) for event in events)

    def test_handle_node_succeeded_event_records_files(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.fetch_files_from_node_outputs = lambda outputs: [
            {"type": "file", "transfer_method": "local"}
        ]
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "done"
        pipeline._save_output_for_event = lambda event, node_execution_id: None

        event = SimpleNamespace(
            node_type=BuiltinNodeTypes.ANSWER,
            outputs={"k": "v"},
            node_execution_id="exec",
            node_id="node",
        )

        responses = list(pipeline._handle_node_succeeded_event(event))

        assert responses == ["done"]
        assert pipeline._recorded_files

    def test_handle_node_succeeded_event_records_llm_reasoning(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.fetch_files_from_node_outputs = lambda outputs: []
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "done"
        pipeline._save_output_for_event = lambda event, node_execution_id: None

        event = SimpleNamespace(
            node_type=BuiltinNodeTypes.LLM,
            outputs={"reasoning_content": "first pass "},
            node_execution_id="exec",
            node_id="llm-1",
        )

        list(pipeline._handle_node_succeeded_event(event))

        assert pipeline._task_state.metadata.reasoning == {"llm-1": "first pass "}

    def test_handle_node_succeeded_event_accumulates_reasoning_across_passes(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.fetch_files_from_node_outputs = lambda outputs: []
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "done"
        pipeline._save_output_for_event = lambda event, node_execution_id: None

        def _llm_event(reasoning: str):
            return SimpleNamespace(
                node_type=BuiltinNodeTypes.LLM,
                outputs={"reasoning_content": reasoning},
                node_execution_id="exec",
                node_id="llm-1",
            )

        # Same node id across iteration/loop passes must accumulate, not overwrite.
        list(pipeline._handle_node_succeeded_event(_llm_event("pass one ")))
        list(pipeline._handle_node_succeeded_event(_llm_event("pass two")))

        assert pipeline._task_state.metadata.reasoning == {"llm-1": "pass one pass two"}

    def test_iteration_and_loop_handlers(self):
        pipeline = _make_pipeline()
        pipeline._workflow_run_id = "run-id"
        pipeline._workflow_response_converter.workflow_iteration_start_to_stream_response = lambda **kwargs: (
            "iter_start"
        )
        pipeline._workflow_response_converter.workflow_iteration_next_to_stream_response = lambda **kwargs: "iter_next"
        pipeline._workflow_response_converter.workflow_iteration_completed_to_stream_response = lambda **kwargs: (
            "iter_done"
        )
        pipeline._workflow_response_converter.workflow_loop_start_to_stream_response = lambda **kwargs: "loop_start"
        pipeline._workflow_response_converter.workflow_loop_next_to_stream_response = lambda **kwargs: "loop_next"
        pipeline._workflow_response_converter.workflow_loop_completed_to_stream_response = lambda **kwargs: "loop_done"

        iter_start = QueueIterationStartEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
        )
        iter_next = QueueIterationNextEvent(
            index=1,
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
        )
        iter_done = QueueIterationCompletedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
        )
        loop_start = QueueLoopStartEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
        )
        loop_next = QueueLoopNextEvent(
            index=1,
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
        )
        loop_done = QueueLoopCompletedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
        )

        assert list(pipeline._handle_iteration_start_event(iter_start)) == ["iter_start"]
        assert list(pipeline._handle_iteration_next_event(iter_next)) == ["iter_next"]
        assert list(pipeline._handle_iteration_completed_event(iter_done)) == ["iter_done"]
        assert list(pipeline._handle_loop_start_event(loop_start)) == ["loop_start"]
        assert list(pipeline._handle_loop_next_event(loop_next)) == ["loop_next"]
        assert list(pipeline._handle_loop_completed_event(loop_done)) == ["loop_done"]

    def test_workflow_finish_handlers(self):
        pipeline = _make_pipeline()
        pipeline._workflow_run_id = "run-id"
        pipeline._graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_finish_to_stream_response = lambda **kwargs: "finish"
        pipeline._workflow_response_converter.workflow_pause_to_stream_response = lambda **kwargs: ["pause"]
        pipeline._persist_human_input_extra_content = lambda **kwargs: None
        pipeline._save_message = lambda **kwargs: None
        pipeline._base_task_pipeline.queue_manager.publish = lambda *args, **kwargs: None
        pipeline._base_task_pipeline.handle_error = lambda **kwargs: ValueError("boom")
        pipeline._base_task_pipeline.error_to_stream_response = lambda err: err
        pipeline._get_message = lambda **kwargs: Message(id="message-id")

        succeeded_responses = list(pipeline._handle_workflow_succeeded_event(QueueWorkflowSucceededEvent(outputs={})))
        assert len(succeeded_responses) == 2
        assert isinstance(succeeded_responses[0], MessageEndStreamResponse)
        assert succeeded_responses[1] == "finish"

        partial_success_responses = list(
            pipeline._handle_workflow_partial_success_event(
                QueueWorkflowPartialSuccessEvent(exceptions_count=1, outputs={})
            )
        )
        assert len(partial_success_responses) == 2
        assert isinstance(partial_success_responses[0], MessageEndStreamResponse)
        assert partial_success_responses[1] == "finish"
        assert (
            list(pipeline._handle_workflow_failed_event(QueueWorkflowFailedEvent(error="err", exceptions_count=1)))[0]
            == "finish"
        )
        assert list(pipeline._handle_workflow_paused_event(QueueWorkflowPausedEvent(reasons=[], outputs={}))) == [
            "pause"
        ]

    def test_node_failure_handlers(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "node_finish"
        pipeline._save_output_for_event = lambda event, node_execution_id: None

        failed_event = QueueNodeFailedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=naive_utc_now(),
            inputs={},
            outputs={},
            process_data={},
            error="err",
        )
        exc_event = QueueNodeExceptionEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=naive_utc_now(),
            inputs={},
            outputs={},
            process_data={},
            error="err",
        )

        assert list(pipeline._handle_node_failed_events(failed_event)) == ["node_finish"]
        assert list(pipeline._handle_node_failed_events(exc_event)) == ["node_finish"]

    def test_handle_text_chunk_event_tracks_streaming_metrics(self):
        pipeline = _make_pipeline()
        published: list[object] = []

        class _Publisher:
            def publish(self, message):
                published.append(message)

        pipeline._message_cycle_manager = SimpleNamespace(message_to_stream_response=lambda **kwargs: "chunk")

        event = SimpleNamespace(text="hi", from_variable_selector=["a"])
        queue_message = SimpleNamespace(event=event)

        responses = list(
            pipeline._handle_text_chunk_event(event, tts_publisher=_Publisher(), queue_message=queue_message)
        )

        assert responses == ["chunk"]
        assert pipeline._task_state.is_streaming_response is True
        assert pipeline._task_state.first_token_time is not None
        assert pipeline._task_state.last_token_time is not None
        assert pipeline._task_state.answer == "hi"
        assert published == [queue_message]

    def test_handle_output_moderation_chunk_appends_token(self):
        pipeline = _make_pipeline()
        seen: list[str] = []

        class _Moderation:
            def should_direct_output(self):
                return False

            def append_new_token(self, text):
                seen.append(text)

        pipeline._base_task_pipeline.output_moderation_handler = _Moderation()

        result = pipeline._handle_output_moderation_chunk("token")

        assert result is False
        assert seen == ["token"]

    def test_handle_retriever_and_annotation_events(self, monkeypatch: pytest.MonkeyPatch):
        pipeline = _make_pipeline()
        calls = {"retriever": 0, "annotation": 0}

        def _hit_retriever(event):
            calls["retriever"] += 1

        def _hit_annotation(_manager, event):
            calls["annotation"] += 1

        pipeline._message_cycle_manager.handle_retriever_resources = _hit_retriever
        monkeypatch.setattr(type(pipeline._message_cycle_manager), "handle_annotation_reply", _hit_annotation)

        retriever_event = QueueRetrieverResourcesEvent(retriever_resources=[])
        annotation_event = QueueAnnotationReplyEvent(message_annotation_id="ann")

        assert list(pipeline._handle_retriever_resources_event(retriever_event)) == []
        assert list(pipeline._handle_annotation_reply_event(annotation_event)) == []
        assert calls == {"retriever": 1, "annotation": 1}

    def test_handle_message_replace_event(self):
        pipeline = _make_pipeline()
        pipeline._message_cycle_manager.message_replace_to_stream_response = lambda **kwargs: "replace"

        event = QueueMessageReplaceEvent(
            text="new",
            reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION,
        )

        assert list(pipeline._handle_message_replace_event(event)) == ["replace"]

    def test_handle_human_input_events(self):
        pipeline = _make_pipeline()
        persisted: list[str] = []
        pipeline._persist_human_input_extra_content = lambda **kwargs: persisted.append("saved")
        pipeline._workflow_response_converter.human_input_form_filled_to_stream_response = lambda **kwargs: "filled"
        pipeline._workflow_response_converter.human_input_form_timeout_to_stream_response = lambda **kwargs: "timeout"

        filled_event = QueueHumanInputFormFilledEvent(
            form_id="form",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="title",
            rendered_content="content",
            action_id="action",
            action_text="action",
        )
        timeout_event = QueueHumanInputFormTimeoutEvent(
            form_id="form",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="title",
            expiration_time=naive_utc_now(),
        )

        assert list(pipeline._handle_human_input_form_filled_event(filled_event)) == ["filled"]
        assert list(pipeline._handle_human_input_form_timeout_event(timeout_event)) == ["timeout"]
        assert persisted == ["saved"]

    def test_save_message_preserves_full_answer_and_sets_usage(self, runtime_app_records, sqlite_session: Session):
        pipeline = _make_pipeline(runtime_app_records)
        pipeline._recorded_files = [
            {
                "type": FileType.IMAGE,
                "transfer_method": FileTransferMethod.REMOTE_URL,
                "remote_url": "http://example.com/file.png",
                "related_id": "file-id",
            }
        ]
        # The answer is stored verbatim; markdown image links are never stripped.
        pipeline._task_state.answer = "![img](http://example.com/file.png) hello ![inline](http://llm.com/img.jpg)"
        pipeline._task_state.is_streaming_response = True
        pipeline._task_state.first_token_time = pipeline._base_task_pipeline.start_at + 0.1
        pipeline._task_state.last_token_time = pipeline._base_task_pipeline.start_at + 0.2

        message = _persist_message(sqlite_session)

        graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )

        pipeline._save_message(graph_runtime_state=graph_runtime_state)
        sqlite_session.refresh(message)

        assert message.status == MessageStatus.NORMAL
        assert message.answer == "![img](http://example.com/file.png) hello ![inline](http://llm.com/img.jpg)"
        assert message.message_metadata
        assert sqlite_session.query(MessageFile).filter_by(message_id=message.id).count() == 1

    def test_handle_stop_event_saves_message_for_moderation(self):
        pipeline = _make_pipeline()
        pipeline._message_end_to_stream_response = lambda: "end"
        saved: list[str] = []

        def _save_message(**kwargs):
            saved.append("saved")

        pipeline._save_message = _save_message

        responses = list(pipeline._handle_stop_event(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION)))

        assert responses == ["end"]
        assert saved == ["saved"]

    def test_handle_message_end_event_applies_output_moderation(self):
        pipeline = _make_pipeline()
        pipeline._graph_runtime_state = RuntimeState(
            workflow_id="test-workflow",
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )
        pipeline._base_task_pipeline.handle_output_moderation_when_task_finished = lambda answer: "safe"
        pipeline._message_cycle_manager.message_replace_to_stream_response = lambda **kwargs: "replace"
        pipeline._message_end_to_stream_response = lambda: "end"

        saved: list[str] = []

        def _save_message(**kwargs):
            saved.append("saved")

        pipeline._save_message = _save_message

        responses = list(pipeline._handle_advanced_chat_message_end_event(QueueAdvancedChatMessageEndEvent()))

        assert responses == ["replace", "end"]
        assert saved == ["saved"]

    def test_dispatch_event_handles_node_exception(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "failed"
        pipeline._save_output_for_event = lambda *args, **kwargs: None

        event = QueueNodeExceptionEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=naive_utc_now(),
            inputs={},
            outputs={},
            process_data={},
            error="err",
        )

        assert list(pipeline._dispatch_event(event)) == ["failed"]
