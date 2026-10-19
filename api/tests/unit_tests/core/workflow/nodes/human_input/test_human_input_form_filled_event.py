import datetime
import json
from collections.abc import Generator, Iterable, Mapping, Sequence
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, create_autospec

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    DIFY_RUN_CONTEXT_KEY,
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    UserFrom,
)
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueHumanInputFormFilledEvent,
    QueueNodeSucceededEvent,
    QueueWorkflowStartedEvent,
    WorkflowQueueMessage,
)
from core.workflow.system_variables import build_system_variables
from enums.human_input import HumanInputFormStatus
from graphon.entities import GraphInitParams, WorkflowStartReason
from graphon.enums import BuiltinNodeTypes
from graphon.file import File, FileTransferMethod, FileType
from graphon.filters import GraphEventFilterContext, filter_graph_events
from graphon.graph import Graph
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import (
    GraphEdgeSkippedEvent,
    GraphEdgeTakenEvent,
    GraphEngineEvent,
)
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.protocols import FileReferenceFactoryProtocol
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool
from graphon.variables.segments import StringSegment
from libs.datetime_utils import naive_utc_now
from libs.helper import compact_generate_response
from models.account import Account
from models.enums import ConversationFromSource, MessageStatus
from models.human_input import HumanInputForm
from models.human_input_entities import (
    FileInputConfig,
    FileListInputConfig,
    FormDefinition,
    HumanInputNodeData,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    UserActionConfig,
)
from models.model import AppMode
from repositories.human_input.form_repository import HumanInputFormSubmissionRepository
from services.app.generation.ports import ConversationSnapshot, MessageSnapshot, WorkflowSnapshot
from services.app.generation.response import convert_to_event_stream
from services.workflow.execution.adapters.chatflow.generate_response_converter import (
    AdvancedChatAppGenerateResponseConverter,
)
from services.workflow.execution.adapters.chatflow.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from services.workflow.execution.adapters.events import WorkflowEventPublisher
from services.workflow.execution.adapters.human_input import (
    DifyHITLCallback,
)
from services.workflow.execution.adapters.human_input_events import HumanInputFormEventFilter
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry, iter_dify_graph_engine_events
from tests.unit_tests.model_factories import make_message
from tests.unit_tests.workflow_execution import NO_HUMAN_INPUT_FORMS


def _persist_form(
    sessions: sessionmaker[Session],
    *,
    form_id: str,
    app_id: str,
    node_id: str,
    expiration_time: datetime.datetime,
    status: HumanInputFormStatus,
) -> None:
    definition = FormDefinition(form_content="content", rendered_content="content", expiration_time=expiration_time)
    form = HumanInputForm(
        tenant_id="tenant",
        app_id=app_id,
        workflow_run_id="run-1",
        node_id=node_id,
        form_definition=definition.model_dump_json(),
        rendered_content="content",
        expiration_time=expiration_time,
        status=status,
    )
    form.id = form_id
    with sessions.begin() as session:
        session.add(form)


class _FakeFormRepository:
    def __init__(self, form):
        self._form = form

    def get_form(self, *_args, **_kwargs):
        return self._form


class _TestFileReferenceFactory(FileReferenceFactoryProtocol):
    def build_from_mapping(self, *, mapping: Mapping[str, Any]):
        return File(
            file_id=mapping.get("id"),
            file_type=FileType(mapping["type"]),
            transfer_method=FileTransferMethod(mapping["transfer_method"]),
            remote_url=mapping.get("remote_url") or mapping.get("url"),
            related_id=mapping.get("related_id") or mapping.get("upload_file_id"),
            filename=mapping.get("filename"),
            extension=mapping.get("extension"),
            mime_type=mapping.get("mime_type"),
            size=mapping.get("size", -1),
        )


def _create_human_input_node(
    *,
    config: dict,
    graph_init_params: GraphInitParams,
    graph_runtime_state: GraphRuntimeState,
    repo: _FakeFormRepository,
) -> HumanInputNode:
    node_data = (
        config["data"]
        if isinstance(config["data"], HumanInputNodeData)
        else HumanInputNodeData.model_validate(config["data"])
    )
    callback = DifyHITLCallback(
        form_repository=repo,
        node_data=node_data,
        file_reference_factory=_TestFileReferenceFactory(),
    )
    node = HumanInputNode(
        node_id=config["id"],
        data=node_data,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        hitl_callback=callback,
    )
    node.bind_execution_id("00000000-0000-4000-8000-000000000001")
    return node


def _build_node(
    form_content: str = (
        "Please enter your name:\n\n{{#$output.name#}}\n"
        "Decision: {{#$output.decision#}}\n"
        "Attachment: {{#$output.attachment#}}\n"
        "Attachments: {{#$output.attachments#}}"
    ),
    *,
    with_inputs: bool = True,
    node_id: str = "node-1",
) -> HumanInputNode:
    system_variables = build_system_variables(app_id="app", workflow_execution_id="run-1")
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(
            system_variables=system_variables,
            user_inputs={},
            environment_variables=[],
        ),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "tenant",
                "app_id": "app",
                "user_id": "user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )

    config = {
        "id": node_id,
        "type": BuiltinNodeTypes.HUMAN_INPUT,
        "data": {
            "title": "Human Input",
            "form_content": form_content,
            "inputs": [
                ParagraphInputConfig(output_variable_name="name").model_dump(mode="json"),
                SelectInputConfig(
                    output_variable_name="decision",
                    option_source=StringListSource(type="constant", value=["approve", "reject"]),
                ).model_dump(mode="json"),
                FileInputConfig(output_variable_name="attachment").model_dump(mode="json"),
                FileListInputConfig(output_variable_name="attachments", number_limits=2).model_dump(mode="json"),
            ],
            "user_actions": [UserActionConfig(id="Accept", title="Approve").model_dump(mode="json")],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content=form_content,
        submitted=True,
        selected_action_id="Accept",
        submitted_data={
            "name": "Alice",
            "decision": "approve",
            "attachment": {
                "type": "document",
                "transfer_method": "remote_url",
                "remote_url": "https://example.com/resume.pdf",
                "filename": "resume.pdf",
                "extension": ".pdf",
                "mime_type": "application/pdf",
            },
            "attachments": [
                {
                    "type": "image",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/a.png",
                    "filename": "a.png",
                    "extension": ".png",
                    "mime_type": "image/png",
                }
            ],
        },
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=naive_utc_now() + datetime.timedelta(days=1),
    )

    if not with_inputs:
        config["data"]["inputs"] = []
        fake_form.submitted_data = {}

    repo = _FakeFormRepository(fake_form)
    return _create_human_input_node(
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        repo=repo,
    )


def _build_timeout_node(
    expiration_time: datetime.datetime | None = None,
    *,
    status: HumanInputFormStatus = HumanInputFormStatus.TIMEOUT,
    node_id: str = "node-1",
) -> HumanInputNode:
    system_variables = build_system_variables(app_id="app", workflow_execution_id="run-1")
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(
            system_variables=system_variables,
            user_inputs={},
            environment_variables=[],
        ),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "tenant",
                "app_id": "app",
                "user_id": "user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )

    config = {
        "id": node_id,
        "type": BuiltinNodeTypes.HUMAN_INPUT,
        "data": {
            "title": "Human Input",
            "form_content": "Please enter your name:\n\n{{#$output.name#}}",
            "inputs": [ParagraphInputConfig(output_variable_name="name").model_dump(mode="json")],
            "user_actions": [UserActionConfig(id="Accept", title="Approve").model_dump(mode="json")],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content="content",
        submitted=False,
        selected_action_id=None,
        submitted_data=None,
        status=status,
        created_at=naive_utc_now(),
        expiration_time=expiration_time or naive_utc_now() - datetime.timedelta(minutes=1),
    )

    repo = _FakeFormRepository(fake_form)
    return _create_human_input_node(
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        repo=repo,
    )


def _publish_node_events(node: HumanInputNode, *, sessions: sessionmaker[Session] | None = None) -> list[AppQueueEvent]:
    form_reader = HumanInputFormSubmissionRepository(sessions=sessions) if sessions else NO_HUMAN_INPUT_FORMS
    return _publish_graph_events(_filter_human_input_events(node.run(), node=node, form_reader=form_reader))


def _filter_human_input_events(
    events: Iterable[GraphEngineEvent],
    *,
    node: HumanInputNode | None = None,
    form_reader=NO_HUMAN_INPUT_FORMS,
):
    node = node or _build_node()
    return filter_graph_events(
        events,
        context=GraphEventFilterContext(
            graph=Graph(root_node=node),
            runtime_state=ReadOnlyGraphRuntimeStateWrapper(node.graph_runtime_state),
        ),
        filters=[HumanInputFormEventFilter(form_repository=form_reader)],
    )


@pytest.mark.parametrize("event_type", [GraphEdgeTakenEvent, GraphEdgeSkippedEvent])
def test_human_input_filter_forwards_traversals_without_waiting_for_completion(event_type):
    started, _ = list(_build_node().run())
    edge = event_type(edge_id="human-answer", source_node_id="node-1", target_node_id="answer")
    edge_forwarded = False

    def source() -> Generator[GraphEngineEvent]:
        yield started
        yield edge
        assert edge_forwarded, "The traversal must be forwarded before consuming more upstream events"

    events = iter(_filter_human_input_events(source()))
    assert next(events) == started
    assert next(events) == edge
    edge_forwarded = True
    assert list(events) == []


def test_form_events_keep_titles_for_interleaved_executions_of_one_node():
    node = _build_node()
    started, succeeded = list(node.run())
    first_start = started.model_copy(update={"id": "first", "node_title": "First approval"})
    second_start = started.model_copy(update={"id": "second", "node_title": "Second approval"})
    first_result = succeeded.model_copy(update={"id": "first", "in_loop_id": "loop-1"})
    second_result = succeeded.model_copy(update={"id": "second", "in_iteration_id": "iteration-2"})

    events = _publish_graph_events(
        _filter_human_input_events([first_start, second_start, second_result, first_result], node=node)
    )

    filled = [event for event in events if isinstance(event, QueueHumanInputFormFilledEvent)]
    assert [(event.node_execution_id, event.node_title) for event in filled] == [
        ("second", "Second approval"),
        ("first", "First approval"),
    ]
    completed = [event for event in events if isinstance(event, QueueNodeSucceededEvent)]
    assert [(event.node_execution_id, event.in_loop_id, event.in_iteration_id) for event in completed] == [
        ("second", None, "iteration-2"),
        ("first", "loop-1", None),
    ]


class _EventQueue(AppQueueManager):
    """Record events and replay a finite stream without starting a watchdog."""

    def __init__(self, invoke_from: InvokeFrom, runtime_state: GraphRuntimeState) -> None:
        self.invoke_from = invoke_from
        self.graph_runtime_state = runtime_state
        self.events: list[AppQueueEvent] = []

    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        assert pub_from in {PublishFrom.APPLICATION_MANAGER, PublishFrom.TASK_PIPELINE}
        self.events.append(event)

    def listen(self) -> Generator[WorkflowQueueMessage]:
        for event in self.events:
            yield WorkflowQueueMessage(task_id="task-1", app_mode=AppMode.ADVANCED_CHAT, event=event)


def _publish_graph_events(events: Iterable[GraphEngineEvent]) -> list[AppQueueEvent]:
    published: list[AppQueueEvent] = []
    queue_manager = create_autospec(AppQueueManager, instance=True, spec_set=True)
    queue_manager.publish.side_effect = lambda event, _publish_from: published.append(event)
    publisher = WorkflowEventPublisher(queue_manager, resolve_pause=lambda **_: [], notify_pause=lambda _: None)
    workflow_entry = create_autospec(WorkflowEntry, instance=True, spec_set=True)
    for event in events:
        publisher.publish(workflow_entry, event)

    return published


class StreamMessageWrites:
    """The SSE contract tests replace persistence at its port; SQLite tests cover writes."""

    def attach_workflow(self, identity, workflow_run_id):
        pass

    def record_human_input(self, identity, *, workflow_run_id, form_id, node_id):
        pass

    def save_message(self, identity, update):
        pass

    def fail_message(self, identity, error):
        pass


def _sse_payloads(
    events: Sequence[AppQueueEvent],
    invoke_from: InvokeFrom,
    app: Flask,
    sessions: sessionmaker[Session],
    runtime_state: GraphRuntimeState | None = None,
    *,
    workflow_contexts,
    tool_providers,
) -> list[dict[str, Any]]:
    generate_entity = AdvancedChatAppGenerateEntity(
        task_id="task-1",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            workflow_id="workflow",
        ),
        inputs={},
        query="hello",
        files=[],
        user_id="user",
        stream=True,
        invoke_from=invoke_from,
        workflow_run_id="run-1",
    )
    if runtime_state is None:
        runtime_state = GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-1")
            ),
            start_at=0,
        )
    queue_manager = _EventQueue(invoke_from, runtime_state)
    queue_manager.events.extend(events)
    with sessions.begin() as session:
        session.add(
            make_message(
                app_id="app",
                inputs={},
                query="hello",
                message={},
                answer="",
                status=MessageStatus.PAUSED,
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                total_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            )
        )
        has_form = session.scalar(select(HumanInputForm.id).where(HumanInputForm.workflow_run_id == "run-1"))
    if has_form is None:
        for event in events:
            if isinstance(event, QueueHumanInputFormFilledEvent):
                _persist_form(
                    sessions,
                    form_id=event.node_execution_id,
                    app_id="app",
                    node_id=event.node_id,
                    expiration_time=naive_utc_now() + datetime.timedelta(days=1),
                    status=HumanInputFormStatus.SUBMITTED,
                )
    pipeline = AdvancedChatAppGenerateTaskPipeline(
        contexts=workflow_contexts,
        chat_records=StreamMessageWrites(),
        application_generate_entity=generate_entity,
        workflow=WorkflowSnapshot(id="workflow", tenant_id="tenant", features_dict={}),
        queue_manager=queue_manager,
        conversation=ConversationSnapshot(id="conversation-1", mode=AppMode.ADVANCED_CHAT),
        message=MessageSnapshot(
            id="message-1", query="hello", created_at=naive_utc_now(), status=MessageStatus.PAUSED, answer=""
        ),
        user=Account(name="tester", email="tester@example.com"),
        stream=True,
        dialogue_count=1,
        draft_var_saver_factory=MagicMock(),
        tool_providers=tool_providers,
    )
    with app.test_request_context():
        if not any(isinstance(event, QueueWorkflowStartedEvent) for event in events):
            list(
                pipeline._handle_workflow_started_event(
                    QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
                )
            )
        response = compact_generate_response(
            convert_to_event_stream(
                AdvancedChatAppGenerateResponseConverter.convert(
                    pipeline._to_stream_response(pipeline._process_stream_response()), invoke_from
                )
            )
        )
        assert response.mimetype == "text/event-stream"
        return [
            json.loads(line.removeprefix("data: ")) for line in response.get_data(as_text=True).splitlines() if line
        ]


@pytest.mark.parametrize("invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.WEB_APP], ids=["full", "simple"])
def test_submitted_human_input_reaches_response_stream(
    invoke_from: InvokeFrom,
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    *,
    workflow_contexts,
    tool_providers,
):
    events = _publish_node_events(_build_node())

    payloads = _sse_payloads(
        events,
        invoke_from,
        app,
        sqlite_session_factory,
        workflow_contexts=workflow_contexts,
        tool_providers=tool_providers,
    )

    # Dify's original HumanInputNode (9c339239850) emitted the form event
    # before node completion; its runner and task pipeline preserved that order.
    assert [payload["event"] for payload in payloads] == [
        "node_started",
        "human_input_form_filled",
        "node_finished",
    ]
    payload = payloads[1]
    assert payload["workflow_run_id"] == "run-1"
    assert payload["data"]["node_id"] == "node-1"
    assert payload["data"]["node_title"] == "Human Input"
    assert payload["data"]["action_id"] == "Accept"
    assert payload["data"]["action_text"] == "Approve"
    assert payload["data"]["rendered_content"] == (
        "Please enter your name:\n\nAlice\nDecision: approve\nAttachment: [file]\nAttachments: [1 files]"
    )
    submitted_data = payload["data"]["submitted_data"]
    assert submitted_data["name"] == "Alice"
    assert submitted_data["decision"] == "approve"
    assert submitted_data["attachment"]["filename"] == "resume.pdf"
    assert submitted_data["attachment"]["type"] == "document"
    assert submitted_data["attachment"]["transfer_method"] == "remote_url"
    assert submitted_data["attachments"][0]["filename"] == "a.png"
    assert submitted_data["attachments"][0]["type"] == "image"


def test_button_only_human_input_reaches_response_stream(
    app: Flask, sqlite_session_factory: sessionmaker[Session], *, workflow_contexts, tool_providers
):
    events = _publish_node_events(_build_node("Approve deployment?", with_inputs=False))

    payloads = _sse_payloads(
        events,
        InvokeFrom.WEB_APP,
        app,
        sqlite_session_factory,
        workflow_contexts=workflow_contexts,
        tool_providers=tool_providers,
    )

    assert [payload["event"] for payload in payloads] == [
        "node_started",
        "human_input_form_filled",
        "node_finished",
    ]
    assert payloads[1]["data"]["rendered_content"] == "Approve deployment?"
    assert payloads[1]["data"]["submitted_data"] == {}
    assert payloads[1]["data"]["action_id"] == "Accept"


@pytest.mark.parametrize("status", [HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.WAITING])
def test_timed_out_human_input_reaches_response_stream(
    status: HumanInputFormStatus,
    sqlite_session_factory: sessionmaker[Session],
    app: Flask,
    *,
    workflow_contexts,
    tool_providers,
):
    expiration_time = datetime.datetime(2025, 1, 1)
    for form_id, expiration in (
        ("previous-execution", datetime.datetime(2024, 1, 1)),
        ("00000000-0000-4000-8000-000000000001", expiration_time),
    ):
        _persist_form(
            sqlite_session_factory,
            form_id=form_id,
            app_id="app",
            node_id="node-1",
            expiration_time=expiration,
            status=status,
        )

    events = _publish_node_events(_build_timeout_node(expiration_time, status=status), sessions=sqlite_session_factory)

    payloads = _sse_payloads(
        events,
        InvokeFrom.WEB_APP,
        app,
        sqlite_session_factory,
        workflow_contexts=workflow_contexts,
        tool_providers=tool_providers,
    )
    assert [payload["event"] for payload in payloads] == [
        "node_started",
        "human_input_form_timeout",
        "node_finished",
    ]
    assert payloads[1]["data"] == {
        "node_id": "node-1",
        "node_title": "Human Input",
        "expiration_time": 1735689600,
    }


@pytest.mark.parametrize("timed_out", [False, True])
@pytest.mark.parametrize("terminal", ["end", "answer"])
def test_human_input_completion_and_referenced_answer_reach_response_stream(
    timed_out: bool,
    terminal: str,
    mocker: MockerFixture,
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    *,
    workflow_contexts,
    tool_providers,
):
    expiration_time = datetime.datetime(2025, 1, 1)
    node = (
        _build_timeout_node(expiration_time, node_id="human")
        if timed_out
        else _build_node("Approve?", with_inputs=False, node_id="human")
    )
    runtime_state = node.graph_runtime_state
    runtime_state.variable_pool.add(["sys", "workflow_execution_id"], StringSegment(value="run-1"))
    init_params = GraphInitParams(workflow_id="workflow", graph_config={}, run_context={}, call_depth=0)
    start = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )
    if terminal == "answer":
        terminal_node = AnswerNode(
            node_id="answer",
            data=AnswerNodeData(title="Answer", answer="Action: {{#human.__action_id#}}"),
            graph_init_params=init_params,
            graph_runtime_state=runtime_state,
        )
    else:
        terminal_node = EndNode(
            node_id="end",
            data=EndNodeData(title="End", outputs=[]),
            graph_init_params=init_params,
            graph_runtime_state=runtime_state,
        )
    graph = (
        Graph.new()
        .add_root(start)
        .add_node(node, from_node_id="start")
        .add_node(terminal_node, from_node_id=node.id, source_handle="__timeout" if timed_out else "Accept")
        .build()
    )
    engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(min_workers=1, max_workers=1),
    )
    bind_execution_id = node.bind_execution_id

    def bind_form(execution_id: str) -> None:
        bind_execution_id(execution_id)
        _persist_form(
            sqlite_session_factory,
            form_id=execution_id,
            app_id="app",
            node_id=node.id,
            expiration_time=expiration_time,
            status=HumanInputFormStatus.TIMEOUT if timed_out else HumanInputFormStatus.SUBMITTED,
        )

    mocker.patch.object(node, "bind_execution_id", side_effect=bind_form)

    repository = HumanInputFormSubmissionRepository(sessions=sqlite_session_factory)
    events = _publish_graph_events(iter_dify_graph_engine_events(engine, human_form_reader=repository))
    payloads = _sse_payloads(
        events,
        InvokeFrom.WEB_APP,
        app,
        sqlite_session_factory,
        runtime_state,
        workflow_contexts=workflow_contexts,
        tool_providers=tool_providers,
    )

    form_event = "human_input_form_timeout" if timed_out else "human_input_form_filled"
    lifecycle_events = [payload for payload in payloads if payload["event"] != "message"]
    assert [(payload["event"], payload.get("data", {}).get("node_id")) for payload in lifecycle_events] == [
        ("workflow_started", None),
        ("node_started", "start"),
        ("node_finished", "start"),
        ("node_started", node.id),
        (form_event, node.id),
        ("node_finished", node.id),
        ("node_started", terminal),
        ("node_finished", terminal),
        ("message_end", None),
        ("workflow_finished", None),
    ]
    answer = "".join(payload["answer"] for payload in payloads if payload["event"] == "message")
    expected_answer = "Action: " + ("" if timed_out else "Accept")
    assert answer == (expected_answer if terminal == "answer" else "")
    assert payloads[-1]["data"]["status"] == "succeeded"


@pytest.mark.parametrize("form_owner", [None, ("other-app", "node-1"), ("app", "other-node")])
def test_timeout_rejects_missing_or_unrelated_form(
    form_owner: tuple[str, str] | None, sqlite_session_factory: sessionmaker[Session]
):
    if form_owner is not None:
        app_id, node_id = form_owner
        _persist_form(
            sqlite_session_factory,
            form_id="00000000-0000-4000-8000-000000000001",
            app_id=app_id,
            node_id=node_id,
            expiration_time=datetime.datetime(2025, 1, 1),
            status=HumanInputFormStatus.TIMEOUT,
        )

    with pytest.raises(ValueError, match="Cannot resolve timed-out human input form"):
        _publish_node_events(_build_timeout_node(), sessions=sqlite_session_factory)
