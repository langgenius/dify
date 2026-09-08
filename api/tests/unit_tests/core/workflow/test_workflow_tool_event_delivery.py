from dataclasses import replace
from datetime import UTC, datetime
from functools import partial
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from clients.agent_backend import FakeAgentBackendRunClient, FakeAgentBackendScenario
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.tools.workflow_as_tool.repository import WorkflowToolSource, WorkflowToolSourceRepository
from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
    WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY,
)
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.agent_v2.session_store import StoredWorkflowAgentSession
from core.workflow.workflow_tool_container_handler import (
    WorkflowToolContainerHandler,
    WorkflowToolNestedContainerHandler,
)
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine.container_handler.builtin.loop import LoopContainerHandler
from graphon.engine.event.processor import NodeEventProcessor
from graphon.engine.event.stream import EventStream
from graphon.engine.worker import NodeEventTask
from graphon.engine_events import (
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.engine_events.base import NodeEvent
from graphon.entities import WorkflowNodeExecution
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus, WorkflowType
from graphon.graph import Graph
from graphon.node_events import NodeRunResult
from graphon.runtime import RuntimeState
from models import Account, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from tests.unit_tests.core.workflow.nodes.agent_v2.test_agent_node import FakeBindingResolver, FakeSessionStore
from tests.unit_tests.core.workflow.test_workflow_tool_container import (
    _container_handler,
    _outer_graph,
    _workflow_tool_node,
)
from tests.workflow_test_utils import build_test_graph_init_params


def test_workflow_tool_loop_break_does_not_escape_into_enclosing_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    def node(node_id: str, node_type: str, **data: object) -> dict[str, object]:
        return {"id": node_id, "data": {"type": node_type, "title": node_id, **data}}

    def edge(source: str, target: str, handle: str = "source") -> dict[str, str]:
        return {"id": f"{source}-{target}", "source": source, "target": target, "sourceHandle": handle}

    tool_node, runtime, _ = _workflow_tool_node()
    monkeypatch.setattr("core.workflow.node_factory.DifyToolNodeRuntime", lambda _: runtime)
    outer_graph = {
        "nodes": [
            node("start", "start", variables=[]),
            node(
                "outer-loop",
                "loop",
                loop_count=3,
                start_node_id="outer-loop-start",
                break_conditions=[],
                logical_operator="and",
                loop_variables=[
                    {"id": "guard", "label": "guard", "var_type": "number", "value_type": "constant", "value": 0}
                ],
            ),
            node("outer-loop-start", "loop-start", loop_id="outer-loop"),
            node(
                "condition",
                "if-else",
                loop_id="outer-loop",
                cases=[
                    {
                        "case_id": "true",
                        "logical_operator": "and",
                        "conditions": [
                            {"comparison_operator": "=", "variable_selector": ["outer-loop", "guard"], "value": "1"}
                        ],
                    }
                ],
            ),
            {"id": "tool", "data": {**tool_node.node_data.model_dump(), "loop_id": "outer-loop"}},
            node("shared-loop-end", "loop-end", loop_id="outer-loop"),
            node(
                "end",
                "end",
                outputs=[
                    {"variable": "rounds", "value_selector": ["outer-loop", "loop_round"], "value_type": "number"}
                ],
            ),
        ],
        "edges": [
            edge("start", "outer-loop"),
            edge("outer-loop", "end"),
            edge("outer-loop-start", "condition"),
            edge("condition", "tool", "false"),
            edge("condition", "shared-loop-end", "true"),
        ],
    }
    _, _, _, _, repository = _container_handler()
    assert isinstance(repository, MagicMock)
    repository.get_source.return_value = replace(
        repository.get_source.return_value,
        graph_config={
            "nodes": [
                node("source-start", "start", variables=[]),
                node(
                    "source-loop",
                    "loop",
                    loop_count=3,
                    start_node_id="source-loop-start",
                    break_conditions=[],
                    logical_operator="and",
                ),
                node("source-loop-start", "loop-start", loop_id="source-loop"),
                node("shared-loop-end", "loop-end", loop_id="source-loop"),
                node("source-end", "end", outputs=[]),
            ],
            "edges": [
                edge("source-start", "source-loop"),
                edge("source-loop", "source-end"),
                edge("source-loop-start", "shared-loop-end"),
            ],
        },
    )
    state = tool_node.runtime_state
    graph = Graph.init(
        graph_config=outer_graph,
        node_factory=DifyNodeFactory(
            init_params=build_test_graph_init_params(workflow_id="outer-workflow", graph_config=outer_graph),
            runtime_state=state,
        ),
        root_node_id="start",
    )
    persisted: list[NodeEvent] = []
    events = list(
        Engine(
            graph=graph,
            runtime_state=state,
            workers=1,
            container_handler_factories=(
                partial(WorkflowToolNestedContainerHandler, handler_factory=LoopContainerHandler),
                partial(
                    WorkflowToolContainerHandler,
                    source_repository=repository,
                    event_listener_factory=lambda _: persisted.append,
                ),
            ),
        ).run()
    )

    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert state.outputs == {"rounds": 3}
    assert repository.get_source.call_count == 3
    assert [
        event.node_run_result.outputs["loop_round"]
        for event in persisted
        if isinstance(event, NodeRunSucceededEvent) and event.node_id == "source-loop"
    ] == [1, 1, 1]


def test_workflow_tool_persists_loop_outputs_after_graphon_normalizes_them() -> None:
    _, frames, state, request, repository = _container_handler()
    assert isinstance(repository, MagicMock)
    source = repository.get_source.return_value
    repository.get_source.return_value = replace(
        source,
        graph_config={
            "nodes": [
                {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "loop",
                    "data": {
                        "type": "loop",
                        "title": "Loop",
                        "loop_count": 1,
                        "start_node_id": "loop-start",
                        "break_conditions": [],
                        "logical_operator": "and",
                    },
                },
                {"id": "loop-start", "data": {"type": "loop-start", "title": "Loop start", "loop_id": "loop"}},
            ],
            "edges": [{"id": "start-loop", "source": "start", "target": "loop"}],
        },
    )
    persisted: list[NodeEvent] = []
    handler = WorkflowToolContainerHandler(
        frames, source_repository=repository, event_listener_factory=lambda _: persisted.append
    )
    handler.handle_request(invocation_id="invocation", request=request)
    frame = frames["invocation:workflow-tool"]
    frame.state.variable_pool.add(("loop", "counter"), 2)
    processor = NodeEventProcessor(
        graph_execution=state.graph_execution,
        event_stream=MagicMock(spec=EventStream),
        frame_registry=frames,
        container_handlers={BuiltinNodeTypes.TOOL: handler},
    )
    event = NodeRunSucceededEvent(
        id="loop-execution",
        node_id="loop",
        node_type=BuiltinNodeTypes.LOOP,
        start_at=datetime.now(UTC).replace(tzinfo=None),
        node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"counter": 1}),
    )

    processor.dispatch(NodeEventTask(frame_id=frame.frame_id, event=event))

    assert event.node_run_result.outputs == {"counter": 2}
    assert persisted[0].node_run_result.outputs == {"counter": 2}
    assert persisted[0].container_id == ""


@pytest.mark.parametrize("listener_fails", [False, True])
def test_workflow_tool_delivers_source_events_to_persistence_without_exposing_them(
    listener_fails: bool, caplog: pytest.LogCaptureFixture
) -> None:
    node, _, payload = _workflow_tool_node()
    source = WorkflowToolSource(
        app_id=payload.source_app_id,
        workflow_id=payload.source_workflow_id,
        graph_config={
            "nodes": [
                {"id": "source-start", "data": {"type": "start", "title": "Start", "variables": []}},
                {"id": "source-end", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [{"id": "source-edge", "source": "source-start", "target": "source-end"}],
        },
        features_dict={},
        environment_variables=[],
        workflow_kind="standard",
    )
    repository = MagicMock(spec=WorkflowToolSourceRepository)
    repository.get_source.return_value = source
    persisted: list[NodeEvent] = []

    def persist_event(event: NodeEvent) -> None:
        persisted.append(event)
        if listener_fails:
            raise RuntimeError("Trace store unavailable")

    listener_factory = MagicMock(return_value=persist_event)

    events = list(
        Engine(
            graph=_outer_graph(node),
            runtime_state=node.runtime_state,
            command_channel=InMemoryChannel(),
            workers=1,
            container_handler_factories=(
                partial(
                    WorkflowToolContainerHandler,
                    source_repository=repository,
                    event_listener_factory=listener_factory,
                ),
            ),
        ).run()
    )

    assert isinstance(events[-1], GraphRunSucceededEvent)
    listener_factory.assert_called_once_with(source)
    assert [event.node_id for event in persisted if isinstance(event, NodeRunStartedEvent)] == [
        "source-start",
        "source-end",
    ]
    assert [event.node_id for event in persisted if isinstance(event, NodeRunSucceededEvent)] == [
        "source-start",
        "source-end",
    ]
    assert all(not event.container_id for event in persisted)
    parent = next(event for event in events if isinstance(event, NodeRunStartedEvent) and event.node_id == node.id)
    assert {event.node_run_result.process_data[WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY] for event in persisted} == {
        parent.id
    }
    assert len({event.node_run_result.process_data[WORKFLOW_TOOL_INVOCATION_ID_KEY] for event in persisted}) == 1
    assert all(event.node_id not in {"source-start", "source-end"} for event in events if isinstance(event, NodeEvent))
    if listener_fails:
        assert "Failed to persist Workflow Tool event" in caplog.text


@pytest.mark.parametrize("caller_save_fails", [False, True])
def test_workflow_tool_agent_finds_its_persisted_caller_before_resolving_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    caller_save_fails: bool,
) -> None:
    binding_resolver = MagicMock()
    if caller_save_fails:
        monkeypatch.setattr("core.workflow.node_factory.WorkflowAgentBindingResolver", lambda: binding_resolver)
        save = SQLAlchemyWorkflowNodeExecutionRepository.save

        def fail_caller_save(
            repository: SQLAlchemyWorkflowNodeExecutionRepository, execution: WorkflowNodeExecution
        ) -> None:
            if execution.node_id == "source-agent" and execution.status == WorkflowNodeExecutionStatus.RUNNING:
                raise RuntimeError("Caller store unavailable")
            save(repository, execution)

        monkeypatch.setattr(SQLAlchemyWorkflowNodeExecutionRepository, "save", fail_caller_save)
    monkeypatch.setattr(
        "clients.agent_backend.factory.create_agent_backend_run_client", lambda **_kwargs: FakeAgentBackendRunClient()
    )
    node, _, payload = _workflow_tool_node()
    source = WorkflowToolSource(
        app_id=payload.source_app_id,
        workflow_id=payload.source_workflow_id,
        graph_config={
            "nodes": [
                {"id": "source-start", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "source-agent",
                    "data": {
                        "type": "agent",
                        "version": "2",
                        "agent_node_kind": "dify_agent",
                        "title": "Unconfigured Agent",
                        "error_strategy": "default-value",
                        "default_value": [],
                    },
                },
            ],
            "edges": [{"id": "source-edge", "source": "source-start", "target": "source-agent"}],
        },
        features_dict={},
        environment_variables=[],
        workflow_kind="standard",
    )
    source_repository = MagicMock(spec=WorkflowToolSourceRepository)
    source_repository.get_source.return_value = source
    user = Account(name="Test", email="test@example.com")
    user.id = "user"
    layer = WorkflowPersistenceLayer(
        application_generate_entity=WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=SimpleNamespace(app_id="outer-app", tenant_id="tenant"),
            inputs={},
            files=[],
            user_id=user.id,
            extras={},
            workflow_execution_id="outer-run",
        ),
        workflow_info=PersistenceWorkflowInfo(
            workflow_id="outer-workflow",
            workflow_type=WorkflowType.WORKFLOW,
            version="1",
            graph_data=node.init_params.graph_config,
        ),
        workflow_execution_repository=SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant",
            user=user,
            app_id="outer-app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ),
        workflow_node_execution_repository=SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant",
            user=user,
            app_id="outer-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        ),
    )
    node.runtime_state.variable_pool.add(("sys", "workflow_run_id"), "outer-run")
    engine = Engine(
        graph=_outer_graph(node),
        runtime_state=node.runtime_state,
        command_channel=InMemoryChannel(),
        workers=1,
        container_handler_factories=(
            partial(
                WorkflowToolContainerHandler,
                source_repository=source_repository,
                event_listener_factory=layer.create_workflow_tool_event_listener,
            ),
        ),
    )
    engine.add_layer(layer)

    events = list(engine.run())

    assert isinstance(events[-1], GraphRunSucceededEvent)
    with sqlite_session_factory() as session:
        execution = session.scalars(
            select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "source-agent")
        ).one()
        assert (execution.app_id, execution.workflow_id, execution.workflow_run_id) == (
            "source-app",
            "source-workflow",
            "outer-run",
        )
        assert execution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
        assert execution.status == "exception"
        if caller_save_fails:
            binding_resolver.resolve.assert_not_called()
            assert execution.error == "Workflow node execution caller is unavailable"
            assert execution.outputs_dict["error_type"] == "agent_workflow_node_runtime_error"
        else:
            # The real workspace store must see the caller synchronously before
            # the binding resolver reports this deliberately unconfigured Agent.
            assert execution.error == "Workflow Agent binding not found for node source-agent."
            assert execution.outputs_dict["error_type"] == "agent_binding_not_found"
        run = session.scalars(select(WorkflowRun)).one()
        assert (run.app_id, run.workflow_id, run.status) == ("outer-app", "outer-workflow", "succeeded")
    assert not any(isinstance(event, NodeEvent) and event.node_id == "source-agent" for event in events)


def test_workflow_tool_agent_ask_human_preserves_invocation_identity_after_runtime_restore(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    monkeypatch.setattr("core.workflow.node_factory.WorkflowAgentBindingResolver", FakeBindingResolver)
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.resolve_model_context_window", lambda **_kwargs: None
    )
    source_repository = MagicMock(spec=WorkflowToolSourceRepository)
    source_repository.get_source.return_value = WorkflowToolSource(
        app_id="source-app",
        workflow_id="source-workflow",
        graph_config={
            "nodes": [
                {
                    "id": "previous-node",
                    "data": {
                        "type": "start",
                        "title": "Start",
                        "variables": [{"variable": "text", "type": "text-input", "label": "Text", "required": True}],
                    },
                },
                {
                    "id": "source-agent",
                    "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Agent"},
                },
            ],
            "edges": [{"id": "source-edge", "source": "previous-node", "target": "source-agent"}],
        },
        features_dict={},
        environment_variables=[],
        workflow_kind="standard",
    )
    handler_factory = partial(WorkflowToolContainerHandler, source_repository=source_repository)
    invocation_ids: set[str] = set()
    owner_scope_keys: set[str] = set()
    for run_index in range(2):
        store = FakeSessionStore()
        client = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.PAUSED)
        monkeypatch.setattr(
            "core.workflow.nodes.agent_v2.session_store.WorkflowAgentWorkspaceStore", MagicMock(return_value=store)
        )
        monkeypatch.setattr(
            "clients.agent_backend.factory.create_agent_backend_run_client", MagicMock(return_value=client)
        )
        node, runtime, payload = _workflow_tool_node()
        runtime.build_workflow_tool_container_payload.return_value = payload.model_copy(
            update={"inputs": {"text": "Previous result"}}
        )
        workflow_run_id = f"outer-run-{run_index}"
        node.runtime_state.variable_pool.add(("sys", "workflow_run_id"), workflow_run_id)
        events = list(
            Engine(
                graph=_outer_graph(node),
                runtime_state=node.runtime_state,
                command_channel=InMemoryChannel(),
                workers=1,
                container_handler_factories=(handler_factory,),
            ).run()
        )

        paused = events[-1]
        assert isinstance(paused, GraphRunPausedEvent)
        assert isinstance(paused.reasons[0], HitlRequired)
        assert paused.reasons[0].node_id == "source-agent"
        (container_run,) = node.runtime_state.container_runs()
        scope, binding_id, snapshot, form_id, tool_call_id = store.saved[0]
        assert scope.workflow_tool_invocation_id == container_run.invocation_id
        assert (scope.app_id, scope.workflow_id, scope.workspace_owner.owner_id) == (
            "source-app",
            "source-workflow",
            workflow_run_id,
        )
        invocation_ids.add(container_run.invocation_id)
        owner_scope_keys.add(scope.workspace_owner.owner_scope_key)
        with sqlite_session_factory() as session:
            form = session.scalars(
                select(HumanInputForm).where(HumanInputForm.workflow_run_id == workflow_run_id)
            ).one()
            assert (form.id, form.app_id, form.node_id) == (form_id, "outer-app", "source-agent")

        store.loaded_session = StoredWorkflowAgentSession(
            scope=scope,
            binding_id=binding_id,
            workspace_id=store.workspace_id,
            backend_binding_ref=store.backend_binding_ref,
            session_snapshot=snapshot,
            pending_form_id=form_id,
            pending_tool_call_id=tool_call_id,
        )
        restored_state = RuntimeState.from_snapshot(node.runtime_state.dumps())
        restored_node, _, _ = _workflow_tool_node(restored_state)
        restored_events = list(
            Engine(
                graph=_outer_graph(restored_node),
                runtime_state=restored_state,
                command_channel=InMemoryChannel(),
                workers=1,
                container_handler_factories=(handler_factory,),
            ).run()
        )

        assert isinstance(restored_events[-1], GraphRunPausedEvent)
        assert len(store.resolved_scopes) == 2
        assert store.resolved_scopes[-1].workspace_owner == scope.workspace_owner
        assert store.existing_scope_lookups[-1]["workflow_tool_invocation_id"] == container_run.invocation_id
        (restored_run,) = restored_state.container_runs()
        assert restored_run.invocation_id == container_run.invocation_id
        with sqlite_session_factory() as session:
            form = session.scalars(
                select(HumanInputForm).where(HumanInputForm.workflow_run_id == workflow_run_id)
            ).one()
            assert form.id == form_id
        assert len(store.saved) == 1

    assert len(invocation_ids) == 2
    assert len(owner_scope_keys) == 2
