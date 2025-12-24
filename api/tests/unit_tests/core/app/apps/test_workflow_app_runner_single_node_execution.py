from types import SimpleNamespace
from unittest.mock import MagicMock

import core.app.apps.workflow.app_runner as workflow_app_runner
from core.app.apps.workflow.app_runner import WorkflowAppRunner, WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.enums import NodeType, SystemVariableKey, WorkflowType
from core.workflow.system_variable import SystemVariable


def test_prepare_single_iteration_injects_system_variables_and_fake_workflow():
    node_id = "iteration_node"
    execution_id = "workflow-exec-123"

    workflow = SimpleNamespace(
        id="workflow-id",
        tenant_id="tenant-id",
        app_id="app-id",
        environment_variables=[],
        graph_dict={
            "nodes": [
                {
                    "id": node_id,
                    "type": "custom",
                    "data": {
                        "type": NodeType.ITERATION,
                        "title": "Iteration",
                        "version": "1",
                        "iterator_selector": ["start", "items"],
                        "output_selector": [node_id, "output"],
                    },
                }
            ],
            "edges": [],
        },
    )

    runner = WorkflowBasedAppRunner(queue_manager=MagicMock(), app_id="app-id")

    system_inputs = SystemVariable(app_id="app-id", workflow_id="workflow-id", workflow_execution_id=execution_id)

    graph, _, runtime_state = runner._prepare_single_node_execution(
        workflow=workflow,
        single_iteration_run=SimpleNamespace(node_id=node_id, inputs={"input_selector": [1, 2, 3]}),
        system_variables=system_inputs,
    )

    assert runtime_state.variable_pool.system_variables.workflow_execution_id == execution_id
    assert runtime_state.variable_pool.get_by_prefix("sys")[SystemVariableKey.WORKFLOW_EXECUTION_ID] == execution_id
    assert graph.root_node.id == f"{node_id}_single_step_start"
    assert f"{node_id}_single_step_end" in graph.nodes


def test_prepare_single_loop_injects_system_variables_and_fake_workflow():
    node_id = "loop_node"
    execution_id = "workflow-exec-456"

    workflow = SimpleNamespace(
        id="workflow-id",
        tenant_id="tenant-id",
        app_id="app-id",
        environment_variables=[],
        graph_dict={
            "nodes": [
                {
                    "id": node_id,
                    "type": "custom",
                    "data": {
                        "type": NodeType.LOOP,
                        "title": "Loop",
                        "version": "1",
                        "loop_count": 1,
                        "break_conditions": [],
                        "logical_operator": "and",
                        "loop_variables": [],
                        "outputs": {},
                    },
                }
            ],
            "edges": [],
        },
    )

    runner = WorkflowBasedAppRunner(queue_manager=MagicMock(), app_id="app-id")

    system_inputs = SystemVariable(app_id="app-id", workflow_id="workflow-id", workflow_execution_id=execution_id)

    graph, _, runtime_state = runner._prepare_single_node_execution(
        workflow=workflow,
        single_loop_run=SimpleNamespace(node_id=node_id, inputs={}),
        system_variables=system_inputs,
    )

    assert runtime_state.variable_pool.system_variables.workflow_execution_id == execution_id
    assert graph.root_node.id == f"{node_id}_single_step_start"
    assert f"{node_id}_single_step_end" in graph.nodes


class DummyCommandChannel:
    def fetch_commands(self):
        return []

    def send_command(self, command):
        return None


def _empty_graph_engine_run(self):
    if False:  # pragma: no cover
        yield None


def _build_generate_entity(*, single_iteration_run=None, single_loop_run=None):
    if isinstance(single_iteration_run, dict):
        single_iteration_run = SimpleNamespace(**single_iteration_run)
    if isinstance(single_loop_run, dict):
        single_loop_run = SimpleNamespace(**single_loop_run)

    base = SimpleNamespace(
        app_config=SimpleNamespace(app_id="app-id", workflow_id="workflow-id"),
        workflow_execution_id="workflow-exec-id",
        files=[],
        user_id="user-id",
        inputs={},
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        task_id="task-id",
        trace_manager=None,
        single_iteration_run=single_iteration_run,
        single_loop_run=single_loop_run,
    )

    def is_single_stepping_container_nodes():
        return base.single_iteration_run is not None or base.single_loop_run is not None

    base.is_single_stepping_container_nodes = is_single_stepping_container_nodes  # type: ignore[attr-defined]
    return base


def test_workflow_runner_attaches_persistence_for_full_run(monkeypatch):
    from core.workflow.graph_engine.graph_engine import GraphEngine

    monkeypatch.setattr(GraphEngine, "run", _empty_graph_engine_run)
    persistence_ctor = MagicMock(name="persistence_layer_ctor")
    monkeypatch.setattr(workflow_app_runner, "WorkflowPersistenceLayer", persistence_ctor)
    monkeypatch.setattr(workflow_app_runner, "RedisChannel", lambda *args, **kwargs: DummyCommandChannel())

    queue_manager = MagicMock()
    workflow = SimpleNamespace(
        id="workflow-id",
        tenant_id="tenant-id",
        app_id="app-id",
        type=WorkflowType.WORKFLOW,
        version="1",
        graph_dict={
            "nodes": [
                {
                    "id": "start",
                    "type": "custom",
                    "data": {"type": NodeType.START, "title": "Start", "version": "1", "variables": []},
                },
                {
                    "id": "end",
                    "type": "custom",
                    "data": {"type": NodeType.END, "title": "End", "version": "1", "outputs": []},
                },
            ],
            "edges": [
                {"source": "start", "target": "end", "sourceHandle": "source", "targetHandle": "target"},
            ],
        },
        environment_variables=[],
    )
    generate_entity = _build_generate_entity()
    generate_entity.inputs = {"input": "value"}

    runner = WorkflowAppRunner(
        application_generate_entity=generate_entity,
        queue_manager=queue_manager,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="system-user-id",
        root_node_id=None,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        graph_engine_layers=(),
    )

    runner.run()

    assert persistence_ctor.call_count == 1


def test_workflow_runner_skips_persistence_for_single_step(monkeypatch):
    from core.workflow.graph_engine.graph_engine import GraphEngine

    monkeypatch.setattr(GraphEngine, "run", _empty_graph_engine_run)
    persistence_ctor = MagicMock(name="persistence_layer_ctor")
    monkeypatch.setattr(workflow_app_runner, "WorkflowPersistenceLayer", persistence_ctor)
    monkeypatch.setattr(workflow_app_runner, "RedisChannel", lambda *args, **kwargs: DummyCommandChannel())

    queue_manager = MagicMock()
    workflow = SimpleNamespace(
        id="workflow-id",
        tenant_id="tenant-id",
        app_id="app-id",
        type=WorkflowType.WORKFLOW,
        version="1",
        graph_dict={
            "nodes": [
                {
                    "id": "loop",
                    "type": "custom",
                    "data": {
                        "type": NodeType.LOOP,
                        "title": "Loop",
                        "version": "1",
                        "loop_count": 1,
                        "break_conditions": [],
                        "logical_operator": "and",
                        "loop_variables": [],
                        "outputs": {},
                    },
                }
            ],
            "edges": [],
        },
        environment_variables=[],
    )
    generate_entity = _build_generate_entity(single_loop_run={"node_id": "loop", "inputs": {}})

    runner = WorkflowAppRunner(
        application_generate_entity=generate_entity,
        queue_manager=queue_manager,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="system-user-id",
        root_node_id=None,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        graph_engine_layers=(),
    )

    runner.run()

    assert persistence_ctor.call_count == 0
