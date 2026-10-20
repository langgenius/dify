"""Count a real graph's paused message on resume, before its answer node runs.

Only the external model, form repositories and transport boundaries are mocked.
Nodes, scheduling, response filtering, message persistence and resume count run.
"""

from collections.abc import Iterator
from contextlib import nullcontext
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from constants import UUID_NIL
from core.app.apps.advanced_chat import app_generator as generator_module
from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.queue_entities import QueueTextChunkEvent, QueueWorkflowPausedEvent
from core.repositories.human_input_repository import HumanInputFormRepository
from core.workflow.nodes.human_input.boundary import build_human_input_pause_reason
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
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
from graphon.graph import Graph
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessageRole
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.human_input.entities import HumanInputNodeData as GraphHumanInputNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.llm.entities import ContextConfig, LLMNodeChatModelMessage, LLMNodeData, ModelConfig
from graphon.nodes.llm.file_saver import LLMFileSaver
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMProtocol, PromptMessageSerializerProtocol
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import RuntimeState, VariablePool
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.execution_extra_content import HumanInputContent
from models.model import Message
from models.workflow import WorkflowRun
from tests.workflow_test_utils import build_test_graph_init_params


def _build_graph(
    state: RuntimeState,
    completion_tokens: int,
    visible_before_pause: bool,
    *,
    submitted: bool = False,
    form_id: str | None = None,
) -> tuple[Graph, Mock, Mock, SimpleNamespace, HumanInputNodeData]:
    params = build_test_graph_init_params(workflow_id="workflow")
    model = Mock(spec=LLMProtocol)
    model.provider = "openai"
    model.model_name = "test-model"
    model.parameters = dict[str, object]()
    model.stop = ()
    model.get_model_schema.return_value = AIModelEntity(
        model="test-model",
        label=I18nObject(en_US="Test"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
        model_properties={},
    )
    model.get_llm_num_tokens.return_value = 0
    # Supply only the external model response, never runtime usage or node results.

    def invoke_model(**_kwargs) -> Iterator[LLMResultChunk]:
        yield LLMResultChunk(
            model="test-model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content="private model output"),
                usage=LLMUsage.empty_usage().model_copy(
                    update={"completion_tokens": completion_tokens, "total_tokens": completion_tokens}
                ),
                finish_reason="stop",
            ),
        )

    model.invoke_llm.side_effect = invoke_model
    model.is_structured_output_parse_error.return_value = False
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
        llm_file_saver=Mock(spec=LLMFileSaver),
        prompt_message_serializer=Mock(spec=PromptMessageSerializerProtocol),
    )
    data = HumanInputNodeData(
        title="human",
        form_content="Approve {{#llm.text#}}",
        inputs=[],
        user_actions=[UserActionConfig(id="continue", title="Continue")],
    )
    form = SimpleNamespace(
        id=form_id or str(uuid4()),
        submission_token="token",
        recipients=[],
        rendered_content="Approve private model output",
        submitted=submitted,
        selected_action_id="continue",
        submitted_data={},
        status=HumanInputFormStatus.WAITING,
        created_at=datetime.now(),
        expiration_time=datetime.now() + timedelta(hours=1),
    )
    repo = Mock(spec=HumanInputFormRepository)
    repo.get_form.return_value = form if submitted else None
    repo.create_form.return_value = form
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
    model.invoke_llm.assert_called_once()
    repo.create_form.assert_called_once()
    assert repo.create_form.call_args[0][0].rendered_content == "Approve private model output"
    restored_state = RuntimeState.from_snapshot(state.dumps())
    assert restored_state.llm_usage.completion_tokens == completion_tokens

    pipeline = AdvancedChatAppGenerateTaskPipeline.__new__(AdvancedChatAppGenerateTaskPipeline)
    pipeline._message_id = current_id
    pipeline._graph_runtime_state = state
    pipeline._workflow_run_id = str(uuid4())
    pipeline._workflow_tenant_id = "tenant"
    pipeline._application_generate_entity = Mock(task_id="task", app_config=SimpleNamespace(app_id="app"))
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
    pipeline._workflow_response_converter = Mock()
    pipeline._workflow_response_converter.workflow_pause_to_stream_response.return_value = ()
    pipeline._base_task_pipeline = Mock(start_at=0.0, queue_manager=Mock())
    pipeline._task_state = Mock(answer="", is_streaming_response=False, first_token_time=None)
    pipeline._task_state.metadata.model_dump.return_value = dict[str, object]()
    pipeline._recorded_files = []
    pipeline._message_saved_on_pause = False
    pipeline._message_cycle_manager = Mock()
    pipeline._handle_output_moderation_chunk = Mock(return_value=False)
    runner = WorkflowBasedAppRunner.__new__(WorkflowBasedAppRunner)
    published = []
    runner._queue_manager = Mock()
    runner._queue_manager.publish.side_effect = lambda event, _source: published.append(event)
    runner._enqueue_human_input_notifications = Mock()
    submission_repo = Mock()
    submission_repo.get_by_form_id.return_value = SimpleNamespace(
        form_id=form.id,
        rendered_content=form.rendered_content,
        node_id="human",
        definition=SimpleNamespace(
            inputs=[], user_actions=list(data.user_actions), default_values={}, node_title="human"
        ),
    )
    # Real runner mapping enriches the real HITL pause and forwards only answer-visible chunks.
    for event in events:
        if isinstance(event, (NodeRunStreamChunkEvent, GraphRunPausedEvent)):
            runner.handle_event(
                Mock(spec=WorkflowEntry),
                event,
                pause_reasons=[
                    build_human_input_pause_reason(
                        reason=reason, record=submission_repo.get_by_form_id(reason.session_id), variable_pool=pool
                    )
                    for reason in event.reasons
                    if isinstance(reason, HitlRequired)
                ]
                if isinstance(event, GraphRunPausedEvent)
                else (),
            )
    for event in published:
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
        generator._bind_file_access_scope = Mock(return_value=nullcontext())
        generator._init_generate_records = Mock(side_effect=AssertionError("resume must reuse its message"))

        class CountObservedError(Exception):
            pass

        # Real resume/_generate query the saved message before transport/worker startup.
        monkeypatch.setattr(generator_module, "MessageBasedAppQueueManager", Mock(side_effect=CountObservedError))
        entity = Mock(
            trace_manager=object(),
            app_config=SimpleNamespace(tenant_id="tenant"),
            invoke_from="service-api",
            task_id="task",
            user_id="user",
            stream=False,
        )
        with pytest.raises(CountObservedError):
            generator.resume(
                app_model=Mock(),
                workflow=Mock(),
                user=Mock(),
                conversation=Mock(id=conversation_id, mode="advanced-chat"),
                message=saved,
                session=reader,
                application_generate_entity=entity,
                workflow_execution_repository=Mock(),
                workflow_node_execution_repository=Mock(),
                graph_runtime_state=restored_state,
            )
        assert generator._dialogue_count == expected_length + 1
        generator._init_generate_records.assert_not_called()

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
    resumed_model.invoke_llm.assert_not_called()
    assert restored_state.llm_usage.completion_tokens == completion_tokens
    assert [event.node_id for event in resumed_events if isinstance(event, NodeRunSucceededEvent)] == (
        ["human"] if answer else ["human", "answer"]
    )
    if not answer:
        assert "".join(event.chunk for event in resumed_events if isinstance(event, NodeRunStreamChunkEvent)) == (
            "private model output"
        )
