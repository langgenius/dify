"""Count a real graph's paused message on resume, before its answer node runs.

Only the external model, form repositories and transport boundaries are mocked.
Nodes, scheduling, response filtering, message persistence and resume count run.
"""

from collections.abc import Generator, Mapping, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal, Never, cast, overload
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from constants import UUID_NIL
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat import app_generator as generator_module
from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import AppQueueEvent, QueueTextChunkEvent, QueueWorkflowPausedEvent
from core.app.entities.task_entities import StreamResponse, WorkflowTaskState
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.repositories.human_input_repository import (
    FormCreateParams,
    HumanInputFormEntity,
    HumanInputFormRecipientEntity,
    HumanInputFormRecord,
    HumanInputFormRepository,
)
from core.workflow.node_runtime import DifyPromptMessageSerializer
from core.workflow.nodes.human_input.boundary import build_human_input_pause_reason
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import FormDefinition, HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.system_variables import build_system_variables
from core.workflow.workflow_entry import WorkflowEntry, iter_dify_graph_engine_events
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine.filter import ResponseStreamFilter
from graphon.engine_events import (
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.file.enums import FileType
from graphon.file.models import File
from graphon.graph import Graph
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    PromptMessageTool,
)
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.human_input.entities import HumanInputNodeData as GraphHumanInputNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.llm.entities import ContextConfig, LLMNodeChatModelMessage, LLMNodeData, ModelConfig
from graphon.nodes.llm.file_saver import LLMFileSaver
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import RuntimeState, VariablePool
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.execution_extra_content import HumanInputContent
from models.model import App, AppMode, Conversation, EndUser, Message
from models.workflow import Workflow, WorkflowRun
from tests.workflow_test_utils import build_test_graph_init_params


class _StreamingModel:
    """Deterministic external model response; graphon still computes node usage."""

    provider = "openai"
    model_name = "test-model"
    stop: tuple[str, ...] = ()

    def __init__(self, completion_tokens: int) -> None:
        self.completion_tokens = completion_tokens
        self.parameters: Mapping[str, object] = {}
        self.invocations = 0

    def get_model_schema(self) -> AIModelEntity:
        return AIModelEntity(
            model=self.model_name,
            label=I18nObject(en_US="Test"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={},
        )

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        assert prompt_messages
        return 0

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, object],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResult: ...

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, object],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunk]: ...

    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, object],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResult | Generator[LLMResultChunk]:
        assert stream, "This regression expects the streaming model path"
        assert prompt_messages
        assert not model_parameters
        assert not tools
        assert not stop
        self.invocations += 1
        return self._stream()

    def _stream(self) -> Generator[LLMResultChunk]:
        yield LLMResultChunk(
            model=self.model_name,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content="private model output"),
                usage=LLMUsage.empty_usage().model_copy(
                    update={"completion_tokens": self.completion_tokens, "total_tokens": self.completion_tokens}
                ),
                finish_reason="stop",
            ),
        )

    def invoke_llm_with_structured_output(self, **_kwargs: object) -> Never:
        raise AssertionError("This graph must not request structured output")

    def is_structured_output_parse_error(self, error: Exception) -> bool:
        assert isinstance(error, Exception)
        return False


class _NoFileSaver(LLMFileSaver):
    """Fail rather than perform file I/O for this text-only model response."""

    def save_binary_string(
        self, data: bytes, mime_type: str, file_type: FileType, extension_override: str | None = None
    ) -> File:
        raise AssertionError(f"Unexpected inline model file: {len(data)} {mime_type} {file_type} {extension_override}")

    def save_remote_url(self, url: str, file_type: FileType) -> File:
        raise AssertionError(f"Unexpected remote model file: {url} {file_type}")


@dataclass
class _Form:
    id: str
    submitted: bool
    created_at: datetime
    expiration_time: datetime
    submission_token: str = "token"
    recipients: list[HumanInputFormRecipientEntity] = field(default_factory=list)
    rendered_content: str = "Approve private model output"
    selected_action_id: str = "continue"
    submitted_data: dict[str, object] = field(default_factory=dict)
    status: HumanInputFormStatus = HumanInputFormStatus.WAITING


class _FormRepository(HumanInputFormRepository):
    """Record form creation and expose the supplied submission on graph resume."""

    def __init__(self, form: HumanInputFormEntity, *, submitted: bool) -> None:
        self.form = form
        self.submitted = submitted
        self.created: list[FormCreateParams] = []

    def get_form(self, node_id: str, *, form_id: str | None = None) -> HumanInputFormEntity | None:
        assert node_id == "human"
        assert form_id is None or form_id == self.form.id
        return self.form if self.submitted else None

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        assert params.node_id == "human"
        self.created.append(params)
        return self.form

    def mark_timeout(self, node_id: str, *, form_id: str) -> HumanInputFormEntity:
        raise AssertionError(f"Unexpected form timeout: {node_id} {form_id}")


@dataclass
class _RecordingQueue:
    events: list[tuple[AppQueueEvent, PublishFrom]] = field(default_factory=list)

    def publish(self, event: AppQueueEvent, source: PublishFrom) -> None:
        self.events.append((event, source))


@dataclass
class _PipelineBoundary:
    queue_manager: _RecordingQueue
    start_at: float = 0.0


class _PauseResponseBoundary:
    def workflow_pause_to_stream_response(self, **_kwargs: object) -> tuple[StreamResponse, ...]:
        return ()


def _build_graph(
    state: RuntimeState,
    completion_tokens: int,
    visible_before_pause: bool,
    *,
    submitted: bool = False,
    form_id: str | None = None,
) -> tuple[Graph, _StreamingModel, _FormRepository, _Form, HumanInputNodeData]:
    params = build_test_graph_init_params(workflow_id="workflow")
    model = _StreamingModel(completion_tokens)
    start = StartNode(
        node_id="start",
        data=StartNodeData(title="start", variables=[]),
        init_params=params,
        runtime_state=state,
    )
    llm = LLMNode(
        node_id="llm",
        data=LLMNodeData(
            title="llm",
            model=ModelConfig(provider="openai", name="test-model", mode="chat"),
            prompt_template=[LLMNodeChatModelMessage(role=PromptMessageRole.USER, text="question")],
            context=ContextConfig(enabled=False),
        ),
        init_params=params,
        runtime_state=state,
        model_instance=model,
        llm_file_saver=_NoFileSaver(),
        prompt_message_serializer=DifyPromptMessageSerializer(),
    )
    data = HumanInputNodeData(
        title="human",
        form_content="Approve {{#llm.text#}}",
        inputs=[],
        user_actions=[UserActionConfig(id="continue", title="Continue")],
    )
    form = _Form(
        id=form_id or str(uuid4()),
        submitted=submitted,
        created_at=datetime.now(),
        expiration_time=datetime.now() + timedelta(hours=1),
    )
    repo = _FormRepository(form, submitted=submitted)
    human = HumanInputNode(
        node_id="human",
        data=GraphHumanInputNodeData(title=data.title),
        init_params=params,
        runtime_state=state,
        hitl_callback=DifyHITLCallback(form_repository=repo, node_data=data),
    )
    answer = AnswerNode(
        node_id="answer",
        data=AnswerNodeData(title="answer", answer="{{#llm.text#}}"),
        init_params=params,
        runtime_state=state,
    )
    builder = Graph.new().add_root(start).add_node(llm, from_node_id="start")
    if visible_before_pause:
        builder.add_node(answer, from_node_id="llm").add_node(human, from_node_id="answer")
    else:
        builder.add_node(human, from_node_id="llm").add_node(answer, from_node_id="human", source_handle="continue")
    return builder.build(), model, repo, form, data


@pytest.mark.parametrize(
    ("answer", "completion_tokens", "expected_length"),
    [("", 5, 2), ("", 0, 1), ("private model output", 5, 2)],
)
@pytest.mark.parametrize("sqlite_session", [(Message, HumanInputContent, WorkflowRun)], indirect=True)
def test_resume_counts_message_written_by_pause(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, answer: str, completion_tokens: int, expected_length: int
) -> None:
    conversation_id, previous_id, current_id = (str(uuid4()) for _ in range(3))
    now = datetime.now()
    for message_id, parent, text, created in [
        (previous_id, UUID_NIL, "previous answer", now - timedelta(seconds=1)),
        (current_id, previous_id, "", now),
    ]:
        message = Message(
            id=message_id,
            app_id=str(uuid4()),
            conversation_id=conversation_id,
            query="question",
            message={"role": "user", "content": "question"},
            answer=text,
            message_tokens=0,
            answer_tokens=0,
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.API,
            parent_message_id=parent,
            created_at=created,
            updated_at=created,
        )
        message._inputs = {}
        sqlite_session.add(message)
    sqlite_session.commit()
    factory = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    monkeypatch.setattr("core.app.apps.advanced_chat.generate_task_pipeline.session_factory.create_session", factory)

    pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            workflow_execution_id="execution", app_id="app", workflow_id="workflow", user_id="user"
        ),
        user_inputs={},
        conversation_variables=[],
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0.0)
    graph, model, repo, form, data = _build_graph(state, completion_tokens, bool(answer))
    engine = Engine(graph=graph, runtime_state=state, command_channel=InMemoryChannel())
    response_filter = ResponseStreamFilter()
    events = list(iter_dify_graph_engine_events(engine, response_filter))
    assert isinstance(events[-1], GraphRunPausedEvent)
    assert state.llm_usage.completion_tokens == completion_tokens
    assert [event.node_id for event in events if isinstance(event, NodeRunSucceededEvent)] == (
        ["start", "llm", "answer"] if answer else ["start", "llm"]
    )
    assert any(isinstance(event, NodeRunStartedEvent) and event.node_id == "answer" for event in events) == bool(answer)
    assert model.invocations == 1
    assert len(repo.created) == 1
    assert repo.created[0].rendered_content == "Approve private model output"
    restored_state = RuntimeState.from_snapshot(state.dumps())
    assert restored_state.llm_usage.completion_tokens == completion_tokens

    pipeline = AdvancedChatAppGenerateTaskPipeline.__new__(AdvancedChatAppGenerateTaskPipeline)
    pipeline._message_id = current_id
    pipeline._graph_runtime_state = state
    pipeline._workflow_run_id = str(uuid4())
    pipeline._workflow_tenant_id = "tenant"
    entity = AdvancedChatAppGenerateEntity(
        task_id="task",
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", app_mode=AppMode.ADVANCED_CHAT, workflow_id="workflow"
        ),
        inputs={},
        files=[],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.SERVICE_API,
        query="question",
    )
    pipeline._application_generate_entity = entity
    sqlite_session.add(
        WorkflowRun(
            id=pipeline._workflow_run_id,
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            task_id="task",
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.PAUSED,
            created_by_role=CreatorUserRole.END_USER,
            created_by="user",
        )
    )
    sqlite_session.commit()
    # Only presentation and queue I/O are replaced; persistence and count remain real.
    pipeline._workflow_response_converter = cast(WorkflowResponseConverter, _PauseResponseBoundary())
    pipeline._base_task_pipeline = cast(
        BasedGenerateTaskPipeline[AdvancedChatAppGenerateEntity], _PipelineBoundary(queue_manager=_RecordingQueue())
    )
    pipeline._task_state = WorkflowTaskState()
    pipeline._recorded_files = []
    pipeline._message_saved_on_pause = False
    pipeline._message_cycle_manager = MessageCycleManager(
        application_generate_entity=entity, task_state=pipeline._task_state
    )
    monkeypatch.setattr(pipeline, "_handle_output_moderation_chunk", lambda _text: False)
    runner = WorkflowBasedAppRunner.__new__(WorkflowBasedAppRunner)
    recording_queue = _RecordingQueue()
    runner._queue_manager = cast(AppQueueManager, recording_queue)
    monkeypatch.setattr(runner, "_enqueue_human_input_notifications", lambda _reasons: None)
    record = HumanInputFormRecord(
        form_id=form.id,
        workflow_run_id=pipeline._workflow_run_id,
        tenant_id="tenant",
        app_id="app",
        form_kind=HumanInputFormKind.RUNTIME,
        rendered_content=form.rendered_content,
        node_id="human",
        created_at=form.created_at,
        expiration_time=form.expiration_time,
        status=form.status,
        selected_action_id=None,
        submitted_data=None,
        submitted_at=None,
        submission_user_id=None,
        submission_end_user_id=None,
        completed_by_recipient_id=None,
        recipient_id=None,
        recipient_type=None,
        access_token=None,
        definition=FormDefinition(
            form_content=data.form_content,
            rendered_content=form.rendered_content,
            expiration_time=form.expiration_time,
            inputs=[],
            user_actions=list(data.user_actions),
            default_values={},
            node_title="human",
        ),
    )
    # Real runner mapping enriches the real HITL pause and forwards only answer-visible chunks.
    workflow_entry = WorkflowEntry(graph_config={}, graph=graph, call_depth=0, graph_runtime_state=state)
    for event in events:
        if isinstance(event, (NodeRunStreamChunkEvent, GraphRunPausedEvent)):
            runner.handle_event(
                workflow_entry,
                event,
                pause_reasons=[
                    build_human_input_pause_reason(reason=reason, record=record, variable_pool=pool)
                    for reason in event.reasons
                    if isinstance(reason, HitlRequired)
                ]
                if isinstance(event, GraphRunPausedEvent)
                else (),
            )
    for event, _source in recording_queue.events:
        if isinstance(event, QueueTextChunkEvent):
            list(pipeline._handle_text_chunk_event(event))
        elif isinstance(event, QueueWorkflowPausedEvent):
            assert isinstance(event.reasons[0], HumanInputRequired)
            assert event.reasons[0].node_id == "human"
            list(pipeline._handle_workflow_paused_event(event))
    assert pipeline._message_saved_on_pause
    assert pipeline._task_state.answer == answer

    # The real pause writer committed; an independent Session observes the saved state.
    with factory() as reader:
        saved = reader.get(Message, current_id)
        assert saved is not None
        assert (saved.answer, saved.answer_tokens, saved.status) == (answer, completion_tokens, MessageStatus.PAUSED)
        content = reader.scalar(select(HumanInputContent).where(HumanInputContent.message_id == current_id))
        assert content is not None
        assert content.form_id == form.id
        generator = generator_module.AdvancedChatAppGenerator.__new__(generator_module.AdvancedChatAppGenerator)
        monkeypatch.setattr(generator, "_bind_file_access_scope", lambda **_kwargs: nullcontext())

        def reject_new_records(*_args: object, **_kwargs: object) -> Never:
            raise AssertionError("resume must reuse its message")

        monkeypatch.setattr(generator, "_init_generate_records", reject_new_records)

        class CountObservedError(Exception):
            pass

        # Real resume/_generate query the saved message before transport/worker startup.
        def observe_count(**_kwargs: object) -> Never:
            raise CountObservedError

        monkeypatch.setattr(generator_module, "MessageBasedAppQueueManager", observe_count)
        # Trace construction is an external side-effect boundary, not under test.
        monkeypatch.setattr(generator_module, "TraceQueueManager", lambda **_kwargs: object())
        with pytest.raises(CountObservedError):
            generator.resume(
                app_model=App(id="app"),
                workflow=Workflow(id="workflow"),
                user=EndUser(id="user", session_id="session"),
                conversation=Conversation(id=conversation_id, mode="advanced-chat"),
                message=saved,
                session=reader,
                application_generate_entity=entity,
                # Queue construction raises before either repository can be used.
                workflow_execution_repository=cast(WorkflowExecutionRepository, object()),
                workflow_node_execution_repository=cast(WorkflowNodeExecutionRepository, object()),
                graph_runtime_state=restored_state,
            )
        assert generator._dialogue_count == expected_length + 1

    # Resume the actual graph snapshot too: finish human input, run Answer, do not re-invoke LLM.
    resumed_graph, resumed_model, _, _, _ = _build_graph(
        restored_state, completion_tokens, bool(answer), submitted=True, form_id=form.id
    )
    resumed_engine = Engine(
        graph=resumed_graph,
        runtime_state=restored_state,
        command_channel=InMemoryChannel(),
    )
    restored_filter = ResponseStreamFilter()
    restored_filter.loads(response_filter.dumps())
    resumed_events = list(iter_dify_graph_engine_events(resumed_engine, restored_filter))
    assert isinstance(resumed_events[-1], GraphRunSucceededEvent)
    assert resumed_model.invocations == 0
    assert restored_state.llm_usage.completion_tokens == completion_tokens
    assert [event.node_id for event in resumed_events if isinstance(event, NodeRunSucceededEvent)] == (
        ["human"] if answer else ["human", "answer"]
    )
    if not answer:
        assert "".join(event.chunk for event in resumed_events if isinstance(event, NodeRunStreamChunkEvent)) == (
            "private model output"
        )
