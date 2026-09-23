from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, WorkflowAppGenerateEntity
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_system_variables
from graphon.engine import Engine
from graphon.engine_events import NodeRunStartedEvent
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowType
from graphon.graph import Graph
from graphon.runtime import RuntimeState, VariablePool
from models import Account, AppMode
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.workflow_run_index import WorkflowRunIndex
from tests.workflow_test_utils import build_test_graph_init_params


def _history(execution_id: str, index: int) -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id=execution_id,
        node_execution_id=execution_id,
        workflow_id="workflow",
        workflow_execution_id="run",
        node_id="start",
        node_type=BuiltinNodeTypes.START,
        title="Start",
        index=index,
        created_at=datetime(2026, 9, 7),
    )


def _engine(*, invocation_id: str | None = None) -> Engine:
    graph_config: dict[str, object] = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [{"source": "start", "target": "end", "sourceHandle": "source"}],
    }
    state = RuntimeState(
        workflow_id="workflow",
        variable_pool=VariablePool.from_bootstrap(system_variables=build_system_variables(workflow_execution_id="run")),
        start_at=0.0,
    )
    params = build_test_graph_init_params(workflow_id="workflow", graph_config=graph_config)
    params.run_context[DIFY_RUN_CONTEXT_KEY].workflow_tool_invocation_id = invocation_id
    return Engine(
        graph=Graph.init(
            graph_config=graph_config,
            node_factory=DifyNodeFactory(init_params=params, runtime_state=state),
            root_node_id="start",
        ),
        runtime_state=state,
        workers=2,
    )


def test_engine_indices_are_available_before_delivery_and_match_persistence(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    user = Account(name="Tester", email="tester@example.com")
    user.id = "user"
    execution_repo = SQLAlchemyWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant",
        user=user,
        app_id="app",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    node_repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant",
        user=user,
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    history = _history("earlier", 7)
    node_repo.save(history)
    persisted_history = node_repo.get_by_workflow_execution("run")
    index = WorkflowRunIndex(root_executions=persisted_history)
    engine = _engine()
    layer = WorkflowPersistenceLayer(
        application_generate_entity=WorkflowAppGenerateEntity(
            task_id="task",
            app_config=WorkflowUIBasedAppConfig(
                tenant_id="tenant", app_id="app", app_mode=AppMode.WORKFLOW, workflow_id="workflow"
            ),
            inputs={},
            files=[],
            user_id="user",
            stream=True,
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_execution_id="run",
        ),
        workflow_info=PersistenceWorkflowInfo(
            workflow_id="workflow", workflow_type=WorkflowType.WORKFLOW, version="1", graph_data={}
        ),
        workflow_execution_repository=execution_repo,
        workflow_node_execution_repository=node_repo,
    )
    layer.set_node_run_indices(index.indices)
    layer.set_node_execution_history(persisted_history)
    engine.add_layer(index)
    engine.add_layer(layer)
    started = {event.id: index.index_for(event.id) for event in engine.run() if isinstance(event, NodeRunStartedEvent)}
    assert sorted(started.values()) == [8, 9]
    with sqlite_session_factory() as session:
        stored = {row.id: row.index for row in session.scalars(select(WorkflowNodeExecutionModel))}
    assert stored == {"earlier": 7, **started}


@pytest.mark.parametrize(
    "metadata",
    [None, {WorkflowNodeExecutionMetadataKey.ITERATION_ID: None, WorkflowNodeExecutionMetadataKey.LOOP_ID: None}],
)
def test_source_scopes_continue_independently_and_replayed_execution_keeps_its_index(
    metadata: dict[WorkflowNodeExecutionMetadataKey, object] | None,
) -> None:
    history = _history("root-earlier", 9)
    history.metadata = metadata
    index = WorkflowRunIndex(root_executions=[history])
    assert (index.root_snapshots[0].iteration_id, index.root_snapshots[0].loop_id) == ("", "")
    index.seed_source("app", "workflow", [_history("source-earlier", 3)])
    first = _engine(invocation_id="first-call")
    first.add_layer(index)
    first_events = [event for event in first.run() if isinstance(event, NodeRunStartedEvent)]
    assert [index.index_for(event.id) for event in first_events] == [4, 5]

    node = first.graph.root_node
    node.bind_execution_id(first_events[0].id)
    index.on_node_run_start(node)
    assert index.index_for(first_events[0].id) == 4

    index.seed_source("app", "workflow", [_history("source-earlier", 3)])
    for invocation, expected in (("second-call", [6, 7]), (None, [10, 11])):
        engine = _engine(invocation_id=invocation)
        engine.add_layer(index)
        assert [
            index.index_for(event.id) for event in engine.run() if isinstance(event, NodeRunStartedEvent)
        ] == expected
