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
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.agent_v2 import DifyAgentNode
from core.workflow.workflow_tool_container_handler import WorkflowToolContainerHandler
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import (
    GraphRunSucceededEvent,
    NodeRunPauseRequestedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.engine_events.base import NodeEvent
from graphon.enums import WorkflowType
from models import Account, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from tests.unit_tests.core.workflow.nodes.agent_v2.test_agent_node import FakeBindingResolver, FakeSessionStore
from tests.unit_tests.core.workflow.test_workflow_tool_container import _outer_graph, _workflow_tool_node
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context


def test_workflow_tool_delivers_source_events_to_persistence_without_exposing_them() -> None:
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
    listener_factory = MagicMock(return_value=persisted.append)

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
    assert all(event.node_id not in {"source-start", "source-end"} for event in events if isinstance(event, NodeEvent))


def test_workflow_tool_agent_finds_its_persisted_caller_before_resolving_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
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
        # The real workspace store must see the caller synchronously before the
        # real binding resolver can report this deliberately unconfigured Agent.
        assert execution.error == "Workflow Agent binding not found for node source-agent."
        assert execution.status == "exception"
        assert execution.outputs_dict["error_type"] == "agent_binding_not_found"
        run = session.scalars(select(WorkflowRun)).one()
        assert (run.app_id, run.workflow_id, run.status) == ("outer-app", "outer-workflow", "succeeded")
    assert not any(isinstance(event, NodeEvent) and event.node_id == "source-agent" for event in events)


def test_workflow_tool_agent_ask_human_creates_form_owned_by_outer_app(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    store = FakeSessionStore()
    client = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.PAUSED)
    monkeypatch.setattr("core.workflow.node_factory.WorkflowAgentBindingResolver", FakeBindingResolver)
    monkeypatch.setattr("core.workflow.nodes.agent_v2.session_store.WorkflowAgentWorkspaceStore", lambda: store)
    monkeypatch.setattr("clients.agent_backend.factory.create_agent_backend_run_client", lambda **_kwargs: client)
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.resolve_model_context_window", lambda **_kwargs: None
    )
    node, _, _ = _workflow_tool_node()
    node.runtime_state.variable_pool.add(("sys", "workflow_run_id"), "outer-run")
    node.runtime_state.variable_pool.add(("previous-node", "text"), "Previous result")
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="source-workflow", app_id="source-app"),
        runtime_state=node.runtime_state,
        human_input_run_context=build_test_run_context(app_id="outer-app"),
    )
    agent = factory.create_node(
        {
            "id": "source-agent",
            "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Agent"},
        }
    )
    assert isinstance(agent, DifyAgentNode)
    agent.bind_execution_id("agent-execution")

    events = list(agent.run())

    assert isinstance(events[-1], NodeRunPauseRequestedEvent)
    with sqlite_session_factory() as session:
        form = session.scalars(select(HumanInputForm)).one()
        assert (form.app_id, form.workflow_run_id, form.node_id) == ("outer-app", "outer-run", "source-agent")
        assert store.saved[0][3] == form.id
    assert store.resolved_scopes[0].app_id == "source-app"
    assert store.resolved_scopes[0].workflow_id == "source-workflow"
