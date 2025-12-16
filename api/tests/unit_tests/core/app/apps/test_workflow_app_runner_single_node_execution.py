from types import SimpleNamespace
from unittest.mock import MagicMock

from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.workflow.enums import NodeType, SystemVariableKey
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
