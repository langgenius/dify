from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest

from core.repositories.human_input_repository import FormCreateParams, HumanInputFormEntity
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.system_variables import SystemVariableKey, system_variable_selector
from core.workflow.workflow_tool_container_handler import (
    WorkflowToolContainerHandler,
    WorkflowToolNestedContainerHandler,
)
from core.workflow.workflow_tool_container_types import WorkflowToolContainerPayload
from core.workflow.workflow_tool_node import DifyWorkflowToolNode
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine.event.processor import NodeEventProcessor
from graphon.engine.event.stream import EventStream
from graphon.engine.frame import ExecutionFrame, FrameRegistry
from graphon.engine.ready_queue import ResumeTask, StartTask
from graphon.engine.worker import NodeEventTask
from graphon.engine_events import NodeRunFailedEvent, NodeRunSucceededEvent
from graphon.engine_events.base import NodeEvent
from graphon.engine_events.graph import GraphRunPausedEvent, GraphRunSucceededEvent
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.graph import Graph
from graphon.node_events import StreamChunkEvent, StreamCompletedEvent
from graphon.nodes.container_effects import (
    ContainerExecutionResult,
    ContainerNodeRunResult,
    CustomContainerRequest,
    build_container_value,
)
from graphon.nodes.protocols import ToolFileManagerProtocol
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.container_state import create_container_run_state
from graphon.runtime.execution import ROOT_FRAME_ID
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context


def _workflow_tool_node(
    runtime_state: RuntimeState | None = None,
    *,
    app_id: str = "outer-app",
) -> tuple[DifyWorkflowToolNode, MagicMock, WorkflowToolContainerPayload]:
    graph_config = {
        "nodes": [
            {
                "id": "tool",
                "data": {
                    "type": "tool",
                    "title": "Workflow Tool",
                    "provider_id": "workflow-provider",
                    "provider_type": "workflow",
                    "provider_name": "workflow-provider",
                    "tool_name": "nested-workflow",
                    "tool_label": "Nested Workflow",
                    "tool_configurations": {},
                    "tool_parameters": {},
                },
            }
        ],
        "edges": [],
    }
    init_params = build_test_graph_init_params(
        workflow_id="outer-workflow",
        graph_config=graph_config,
        call_depth=2,
        app_id=app_id,
    )
    if runtime_state is None:
        runtime_state = RuntimeState(
            workflow_id="outer-workflow",
            variable_pool=VariablePool(),
            start_at=1,
        )
    payload = WorkflowToolContainerPayload(
        source_app_id="source-app",
        source_workflow_id="source-workflow",
        source_workflow_version="1",
        inputs={"question": "hello"},
        inputs_for_log={"question": "hello"},
        call_depth=3,
    )
    runtime = MagicMock()
    runtime.get_runtime.return_value = ToolRuntimeHandle(raw=object())
    runtime.get_runtime_parameters.return_value = []
    runtime.build_workflow_tool_container_payload.return_value = payload
    node = DifyWorkflowToolNode(
        node_id="tool",
        data=ToolNodeData.model_validate(graph_config["nodes"][0]["data"]),
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
        tool_file_manager=MagicMock(spec=ToolFileManagerProtocol),
        runtime=runtime,
    )
    node.bind_execution_id("tool-execution")
    return node, runtime, payload


def _outer_graph(node: DifyWorkflowToolNode) -> Graph:
    start = StartNode(
        node_id="outer-start",
        data=StartNodeData(title="Start", variables=[]),
        graph_init_params=node._graph_init_params,
        graph_runtime_state=node.graph_runtime_state,
    )
    return Graph.new().add_root(start).add_node(node, from_node_id=start.id).build()


def test_workflow_tool_node_requests_child_container_and_resumes_successfully() -> None:
    node, runtime, payload = _workflow_tool_node()

    initial_events = list(node._run())

    assert initial_events == [CustomContainerRequest(payload=payload.model_dump_json())]
    runtime.get_runtime.assert_called_once_with(
        node_id="tool",
        node_data=node.node_data,
        variable_pool=None,
        node_execution_id="tool-execution",
    )
    runtime.build_workflow_tool_container_payload.assert_called_once_with(
        tool_runtime=runtime.get_runtime.return_value,
        tool_parameters={},
        inputs_for_log={},
        workflow_call_depth=2,
    )

    result = ContainerExecutionResult(
        metadata={},
        steps=2,
        node_run_result=ContainerNodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"question": build_container_value("hello")},
            outputs={
                "text": build_container_value("done"),
                "answer": build_container_value(42),
            },
        ),
    )

    resumed_events = list(node._resume_container_events(result=result))

    assert resumed_events[:2] == [
        StreamChunkEvent(selector=["tool", "text"], chunk="done", is_final=False),
        StreamChunkEvent(selector=["tool", "text"], chunk="", is_final=True),
    ]
    completed = resumed_events[2]
    assert isinstance(completed, StreamCompletedEvent)
    assert completed.node_run_result.inputs == {"question": "hello"}
    assert completed.node_run_result.outputs == {"text": "done", "answer": 42}
    assert node.graph_runtime_state.node_run_steps == 2
    assert completed.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.TOOL_INFO] == {
        "provider_type": ToolProviderType.WORKFLOW.value,
        "provider_id": "workflow-provider",
        "plugin_unique_identifier": None,
    }


def test_node_factory_can_keep_workflow_tool_direct_for_single_step_debug() -> None:
    node, _, _ = _workflow_tool_node()
    factory = object.__new__(DifyNodeFactory)
    factory._containerize_workflow_tools = True
    assert (
        factory._resolve_node_class_for_factory(
            node_type=BuiltinNodeTypes.TOOL,
            node_version="1",
            node_data=node.node_data,
        )
        is DifyWorkflowToolNode
    )

    factory._containerize_workflow_tools = False
    assert (
        factory._resolve_node_class_for_factory(
            node_type=BuiltinNodeTypes.TOOL,
            node_version="1",
            node_data=node.node_data,
        )
        is ToolNode
    )


def _source_workflow() -> tuple[App, Workflow]:
    source_graph = {
        "nodes": [
            {
                "id": "source-start",
                "data": {
                    "type": "start",
                    "title": "Start",
                    "variables": [
                        {
                            "variable": "answer",
                            "label": "Answer",
                            "type": "text-input",
                            "required": False,
                            "default": "fallback",
                        }
                    ],
                },
            },
            {
                "id": "source-end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {
                            "variable": "answer",
                            "value_selector": ["source-start", "answer"],
                        }
                    ],
                },
            },
        ],
        "edges": [
            {
                "id": "source-edge",
                "source": "source-start",
                "target": "source-end",
            }
        ],
    }
    app = App(
        id="00000000-0000-0000-0000-000000000001",
        tenant_id="tenant",
        name="Source app",
        description="",
        mode=AppMode.WORKFLOW,
        icon="",
        enable_site=False,
        enable_api=False,
    )
    workflow = Workflow.new(
        tenant_id="tenant",
        app_id=app.id,
        type=WorkflowType.WORKFLOW.value,
        version="1",
        graph=json.dumps(source_graph),
        features="{}",
        created_by="user",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = "00000000-0000-0000-0000-000000000002"
    return app, workflow


def _source_human_input_workflow() -> tuple[App, Workflow]:
    human_input = HumanInputNodeData(
        title="Approval",
        form_content="Approve this run?",
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )
    source_graph = {
        "nodes": [
            {
                "id": "source-start",
                "data": {"type": "start", "title": "Start", "variables": []},
            },
            {
                "id": "source-human",
                "data": human_input.model_dump(mode="json"),
            },
            {
                "id": "source-end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {
                            "variable": "decision",
                            "value_selector": ["source-human", "__action_id"],
                        }
                    ],
                },
            },
        ],
        "edges": [
            {
                "id": "source-edge-start-human",
                "source": "source-start",
                "target": "source-human",
            },
            {
                "id": "source-edge-human-end",
                "source": "source-human",
                "sourceHandle": "approve",
                "target": "source-end",
            },
        ],
    }
    app, workflow = _source_workflow()
    workflow.graph = json.dumps(source_graph)
    return app, workflow


class _TestForm(HumanInputFormEntity):
    def __init__(self, form_id: str) -> None:
        self.form_id = form_id
        self.is_submitted = False

    @property
    def id(self) -> str:
        return self.form_id

    @property
    def submission_token(self) -> str | None:
        return "submission-token"

    @property
    def recipients(self) -> list:
        return []

    @property
    def rendered_content(self) -> str:
        return "Approve this run?"

    @property
    def selected_action_id(self) -> str | None:
        return "approve" if self.is_submitted else None

    @property
    def created_at(self) -> datetime:
        return datetime.now(UTC).replace(tzinfo=None)

    @property
    def submitted_data(self) -> dict[str, object] | None:
        return {} if self.is_submitted else None

    @property
    def submitted(self) -> bool:
        return self.is_submitted

    @property
    def status(self) -> HumanInputFormStatus:
        return HumanInputFormStatus.SUBMITTED if self.is_submitted else HumanInputFormStatus.WAITING

    @property
    def expiration_time(self) -> datetime:
        return datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)


class _TestFormRepository:
    def __init__(self) -> None:
        self.form: _TestForm | None = None
        self.create_params: list[FormCreateParams] = []

    def get_form(self, node_id: str, *, form_id: str | None = None) -> HumanInputFormEntity | None:
        _ = node_id
        if self.form is None or form_id != self.form.id:
            return None
        return self.form

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        assert params.form_id is not None
        self.create_params.append(params)
        self.form = _TestForm(params.form_id)
        return self.form


def _container_handler(
    monkeypatch: pytest.MonkeyPatch,
    *,
    inputs: dict[str, object] | None = None,
) -> tuple[
    WorkflowToolContainerHandler,
    FrameRegistry,
    RuntimeState,
    CustomContainerRequest,
]:
    app, workflow = _source_workflow()
    parent_pool = VariablePool()
    parent_pool.add(system_variable_selector(SystemVariableKey.USER_ID), "user")
    parent_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), "outer-execution")
    parent_pool.add(("env", "outer-secret"), "must-not-leak")
    parent_pool.add(("source-start", "stale"), "must-not-leak")
    parent_state = RuntimeState(
        workflow_id="outer-workflow",
        variable_pool=parent_pool,
        start_at=1,
    )
    parent_node = SimpleNamespace(
        node_type=BuiltinNodeTypes.TOOL,
        run_context=build_test_run_context(
            tenant_id="tenant",
            app_id="outer-app",
        ),
    )
    parent_graph = SimpleNamespace(nodes={"tool": parent_node})
    frame_registry = FrameRegistry()
    frame_registry.register(
        ExecutionFrame(
            frame_id=ROOT_FRAME_ID,
            graph=cast(Graph, parent_graph),
            state=parent_state,
            scheduler=MagicMock(),
            failure_handler=MagicMock(),
        )
    )
    monkeypatch.setattr(
        WorkflowToolContainerHandler,
        "_load_source",
        staticmethod(lambda **_: (app, workflow)),
    )
    payload = WorkflowToolContainerPayload(
        source_app_id=app.id,
        source_workflow_id=workflow.id,
        source_workflow_version=workflow.version,
        inputs={"answer": "ok"} if inputs is None else inputs,
        inputs_for_log={"answer": "ok"} if inputs is None else inputs,
        call_depth=1,
    )
    request = CustomContainerRequest(payload=payload.model_dump_json())
    parent_state.put_container_run(
        create_container_run_state(
            invocation_id="invocation",
            frame_id=ROOT_FRAME_ID,
            node_id="tool",
            started_at=datetime.now(UTC).replace(tzinfo=None),
            request=request,
        )
    )
    return WorkflowToolContainerHandler(frame_registry), frame_registry, parent_state, request


def _dispatch_next_node(
    *,
    expected_node_id: str,
    runtime_state: RuntimeState,
    frame_registry: FrameRegistry,
    processor: NodeEventProcessor,
) -> None:
    task = runtime_state.ready_queue.get(timeout=0.01)
    assert isinstance(task, StartTask)
    assert task.node_id == expected_node_id
    frame = frame_registry[task.frame_id]
    node = frame.graph.nodes[task.node_id]
    execution = runtime_state.graph_execution.get_or_create_node_execution(
        frame_id=frame.frame_id,
        node_id=node.id,
    )
    node.bind_execution_id(execution.execution_id)
    for event in node.run():
        assert isinstance(event, NodeEvent)
        processor.dispatch(NodeEventTask(frame_id=frame.frame_id, event=event))


def test_workflow_tool_handler_runs_child_graph_with_internal_name_collision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler, frame_registry, runtime_state, request = _container_handler(monkeypatch)
    handler.handle_request(invocation_id="invocation", request=request)
    frame_registry["invocation:workflow-tool"].state.variable_pool.add(
        ("__workflow_tool_container__", "failure"),
        {"legitimate": True},
    )
    event_stream = MagicMock(spec=EventStream)
    processor = NodeEventProcessor(
        graph_execution=runtime_state.graph_execution,
        event_stream=event_stream,
        frame_registry=frame_registry,
        container_handlers={BuiltinNodeTypes.TOOL: handler},
    )

    _dispatch_next_node(
        expected_node_id="source-start",
        runtime_state=runtime_state,
        frame_registry=frame_registry,
        processor=processor,
    )
    _dispatch_next_node(
        expected_node_id="source-end",
        runtime_state=runtime_state,
        frame_registry=frame_registry,
        processor=processor,
    )

    resume_task = runtime_state.ready_queue.get(timeout=0.01)
    assert isinstance(resume_task, ResumeTask)
    assert isinstance(resume_task.result, ContainerExecutionResult)
    assert resume_task.result.steps == 2
    outputs = {key: value.to_object() for key, value in resume_task.result.node_run_result.outputs.items()}
    assert outputs == {
        "answer": "ok",
        "text": '{"answer": "ok"}',
        "files": [],
        "json": [{"answer": "ok"}],
    }
    assert not any(isinstance(call.args[0], NodeEvent) for call in event_stream.collect.call_args_list)
    with pytest.raises(KeyError):
        frame_registry["invocation:workflow-tool"]
    with pytest.raises(KeyError):
        runtime_state.get_container_frame("invocation:workflow-tool")


def test_workflow_tool_handler_restores_child_frame(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler, frame_registry, runtime_state, request = _container_handler(monkeypatch)
    handler.handle_request(invocation_id="invocation", request=request)
    frame_id = "invocation:workflow-tool"
    original_frame = frame_registry[frame_id]
    frame_state = runtime_state.get_container_frame(frame_id)
    frame_registry.remove(frame_id)

    handler.restore_frame(frame_state)

    restored_frame = frame_registry[frame_id]
    assert restored_frame is not original_frame
    assert set(restored_frame.graph.nodes) == {"source-start", "source-end"}
    answer = restored_frame.state.variable_pool.get(("source-start", "answer"))
    assert answer is not None
    assert answer.to_object() == "ok"
    assert restored_frame.state.ready_queue is runtime_state.ready_queue
    assert restored_frame.state.graph_execution is runtime_state.graph_execution
    assert all(node.graph_runtime_state is restored_frame.state for node in restored_frame.graph.nodes.values())


def test_workflow_tool_handler_restores_child_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler, frame_registry, runtime_state, request = _container_handler(monkeypatch)
    handler.handle_request(invocation_id="invocation", request=request)
    frame_id = "invocation:workflow-tool"
    frame = frame_registry[frame_id]
    now = datetime.now(UTC).replace(tzinfo=None)
    handler.record_frame_failure(
        frame=frame,
        event=NodeRunFailedEvent(
            id="failed-execution",
            node_id="source-start",
            node_type=BuiltinNodeTypes.START,
            error="source failed",
            start_at=now,
            finished_at=now,
            node_run_result=ContainerNodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="source failed",
                error_type="RuntimeError",
            ).to_node_run_result(),
        ),
    )
    frame_state = runtime_state.get_container_frame(frame_id)
    frame_state = frame_state.model_copy(update={"runtime_data": frame.state.snapshot_frame()})
    runtime_state.put_container_frame(frame_state)
    frame_registry.remove(frame_id)

    restored_handler = WorkflowToolContainerHandler(frame_registry)
    restored_handler.restore_frame(frame_state)
    restored_handler.complete_frame_if_ready(frame_registry[frame_id])

    tasks = [runtime_state.ready_queue.get(timeout=0.01) for _ in range(2)]
    resume_task = next(task for task in tasks if isinstance(task, ResumeTask))
    assert resume_task.result.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert {key: value.to_object() for key, value in resume_task.result.node_run_result.inputs.items()} == {
        "answer": "ok"
    }
    assert resume_task.result.node_run_result.error == "source failed"
    assert resume_task.result.node_run_result.error_type == "RuntimeError"


def test_workflow_tool_handler_isolates_child_variable_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler, frame_registry, _, request = _container_handler(monkeypatch)

    handler.handle_request(invocation_id="invocation", request=request)

    child_pool = frame_registry["invocation:workflow-tool"].state.variable_pool
    assert child_pool.get(system_variable_selector(SystemVariableKey.USER_ID)).to_object() == "user"  # type: ignore[union-attr]
    assert child_pool.get(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID)).to_object() == (  # type: ignore[union-attr]
        "outer-execution"
    )
    assert child_pool.get(system_variable_selector(SystemVariableKey.APP_ID)).to_object() == (  # type: ignore[union-attr]
        "00000000-0000-0000-0000-000000000001"
    )
    assert child_pool.get(("env", "outer-secret")) is None
    assert child_pool.get(("source-start", "stale")) is None


def test_workflow_tool_handler_applies_start_input_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    handler, frame_registry, _, request = _container_handler(monkeypatch, inputs={})

    handler.handle_request(invocation_id="invocation", request=request)

    answer = frame_registry["invocation:workflow-tool"].state.variable_pool.get(("source-start", "answer"))
    assert answer is not None
    assert answer.to_object() == "fallback"


def test_workflow_tool_handler_preserves_inputs_when_start_validation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler, _, runtime_state, request = _container_handler(monkeypatch, inputs={"answer": 42})

    handler.handle_request(invocation_id="invocation", request=request)

    resume_task = runtime_state.ready_queue.get(timeout=0.01)
    assert isinstance(resume_task, ResumeTask)
    assert resume_task.result.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert {key: value.to_object() for key, value in resume_task.result.node_run_result.inputs.items()} == {
        "answer": 42
    }
    assert resume_task.result.node_run_result.error_type == "ValueError"


def test_workflow_tool_nested_handler_hides_marked_child_events() -> None:
    frame_registry = MagicMock(spec=FrameRegistry)
    delegate = MagicMock()
    delegate.node_type = BuiltinNodeTypes.LOOP
    delegate.should_emit.return_value = True
    hidden_event_listener = MagicMock()
    nested_handler = WorkflowToolNestedContainerHandler(
        frame_registry,
        handler_factory=lambda _: delegate,
        hidden_event_listener=hidden_event_listener,
    )
    workflow_tool_handler = WorkflowToolContainerHandler(frame_registry)
    event = NodeRunSucceededEvent(
        id="source-execution",
        node_id="source-start",
        node_type=BuiltinNodeTypes.START,
        start_at=datetime.now(UTC).replace(tzinfo=None),
    )

    workflow_tool_handler.prepare_frame_event(frame=SimpleNamespace(container_id="tool"), event=event)  # type: ignore[arg-type]

    assert nested_handler.should_emit(event=event) is False
    hidden_event_listener.assert_called_once_with(event)
    unmarked_event = event.model_copy(deep=True)
    unmarked_event.node_run_result.process_data = {}
    assert nested_handler.should_emit(event=unmarked_event) is True


def test_workflow_tool_child_failure_does_not_change_outer_exception_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler, frame_registry, runtime_state, request = _container_handler(monkeypatch)
    handler.handle_request(invocation_id="invocation", request=request)
    now = datetime.now(UTC).replace(tzinfo=None)
    event = NodeRunFailedEvent(
        id="source-execution",
        node_id="source-start",
        node_type=BuiltinNodeTypes.START,
        error="handled source failure",
        start_at=now,
        finished_at=now,
    )

    handler.prepare_frame_event(frame=frame_registry["invocation:workflow-tool"], event=event)
    handler.prepare_frame_event(frame=frame_registry["invocation:workflow-tool"], event=event)
    runtime_state.graph_execution.record_node_failure()

    assert runtime_state.graph_execution.exceptions_count == 0


def test_workflow_tool_empty_outputs_match_direct_invocation(monkeypatch: pytest.MonkeyPatch) -> None:
    handler, frame_registry, runtime_state, request = _container_handler(monkeypatch)
    handler.handle_request(invocation_id="invocation", request=request)

    result = handler._build_success_result(
        frame=frame_registry["invocation:workflow-tool"],
        run_state=runtime_state.get_container_run("invocation"),
    )

    assert result.node_run_result.outputs["json"].to_object() == [{}]


def test_workflow_tool_human_input_pauses_and_resumes_without_duplicate_form(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_app, source_workflow = _source_human_input_workflow()
    monkeypatch.setattr(
        WorkflowToolContainerHandler,
        "_load_source",
        staticmethod(lambda **_: (source_app, source_workflow)),
    )
    form_repository = _TestFormRepository()
    human_input_app_ids: list[str] = []

    def build_human_input_callback(
        factory: DifyNodeFactory,
        *,
        node_data: HumanInputNodeData,
        execution_id_getter,
    ) -> DifyHITLCallback:
        human_input_app_ids.append(factory._human_input_runtime._run_context.app_id)
        return DifyHITLCallback(
            form_repository=form_repository,
            node_data=node_data,
            execution_id_getter=execution_id_getter,
        )

    monkeypatch.setattr(DifyNodeFactory, "_build_human_input_callback", build_human_input_callback)

    outer_pool = VariablePool()
    outer_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), "outer-execution")
    outer_pool.add(system_variable_selector(SystemVariableKey.APP_ID), "outer-app")
    outer_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_ID), "outer-workflow")
    initial_state = RuntimeState(
        workflow_id="outer-workflow",
        variable_pool=outer_pool,
        start_at=1,
    )
    initial_node, _, _ = _workflow_tool_node(initial_state, app_id="intermediate-app")
    initial_graph = _outer_graph(initial_node)
    initial_owner_factory = object.__new__(DifyNodeFactory)
    initial_owner_factory._human_input_run_context = build_test_run_context(app_id="outer-app")
    initial_graph.node_factory = initial_owner_factory
    initial_events = list(
        Engine(
            graph=initial_graph,
            graph_runtime_state=initial_state,
            command_channel=InMemoryChannel(),
            workers=1,
            container_handler_factories=(WorkflowToolContainerHandler,),
        ).run()
    )

    paused = initial_events[-1]
    assert isinstance(paused, GraphRunPausedEvent)
    assert len(paused.reasons) == 1
    reason = paused.reasons[0]
    assert isinstance(reason, HitlRequired)
    assert reason.node_id == "tool"
    assert reason.node_title == "Approval"
    assert all(getattr(event, "node_id", None) not in {"source-start", "source-human"} for event in initial_events)
    assert len(form_repository.create_params) == 1
    create_params = form_repository.create_params[0]
    assert create_params.node_id == "source-human"
    assert create_params.workflow_execution_id == "outer-execution"
    child_frames = list(initial_state.container_frames())
    assert len(child_frames) == 1
    child_execution = initial_state.graph_execution.node_executions[(child_frames[0].frame_id, "source-human")]
    assert create_params.form_id == child_execution.execution_id
    assert human_input_app_ids == ["outer-app"]

    restored_state = RuntimeState.from_snapshot(initial_state.dumps())
    restored_node, _, _ = _workflow_tool_node(restored_state, app_id="intermediate-app")
    restored_graph = _outer_graph(restored_node)
    restored_owner_factory = object.__new__(DifyNodeFactory)
    restored_owner_factory._human_input_run_context = build_test_run_context(app_id="outer-app")
    restored_graph.node_factory = restored_owner_factory
    assert form_repository.form is not None
    form_repository.form.is_submitted = True
    resumed_events = list(
        Engine(
            graph=restored_graph,
            graph_runtime_state=restored_state,
            command_channel=InMemoryChannel(),
            workers=1,
            container_handler_factories=(WorkflowToolContainerHandler,),
        ).run()
    )

    assert isinstance(resumed_events[-1], GraphRunSucceededEvent)
    tool_succeeded = next(
        event for event in resumed_events if isinstance(event, NodeRunSucceededEvent) and event.node_id == "tool"
    )
    assert tool_succeeded.node_run_result.outputs["decision"] == "approve"
    assert json.loads(tool_succeeded.node_run_result.outputs["text"]) == {"decision": "approve"}
    assert len(form_repository.create_params) == 1
    assert human_input_app_ids == ["outer-app", "outer-app"]
    assert all(getattr(event, "node_id", None) not in {"source-human", "source-end"} for event in resumed_events)
    assert list(restored_state.container_frames()) == []
    assert list(restored_state.container_runs()) == []
