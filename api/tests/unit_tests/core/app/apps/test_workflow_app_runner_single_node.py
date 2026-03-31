from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.runtime import GraphRuntimeState, VariablePool

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.workflow.system_variables import default_system_variables
from models.workflow import Workflow


def _make_graph_state():
    variable_pool = VariablePool(
        system_variables=default_system_variables(),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    return MagicMock(), variable_pool, GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)


@pytest.mark.parametrize(
    ("single_iteration_run", "single_loop_run"),
    [
        (WorkflowAppGenerateEntity.SingleIterationRunEntity(node_id="iter", inputs={}), None),
        (None, WorkflowAppGenerateEntity.SingleLoopRunEntity(node_id="loop", inputs={})),
    ],
)
def test_run_uses_single_node_execution_branch(
    single_iteration_run: Any,
    single_loop_run: Any,
) -> None:
    app_config = MagicMock()
    app_config.app_id = "app"
    app_config.tenant_id = "tenant"
    app_config.workflow_id = "workflow"

    app_generate_entity = MagicMock(spec=WorkflowAppGenerateEntity)
    app_generate_entity.app_config = app_config
    app_generate_entity.inputs = {}
    app_generate_entity.files = []
    app_generate_entity.user_id = "user"
    app_generate_entity.invoke_from = InvokeFrom.SERVICE_API
    app_generate_entity.workflow_execution_id = "execution-id"
    app_generate_entity.task_id = "task-id"
    app_generate_entity.call_depth = 0
    app_generate_entity.trace_manager = None
    app_generate_entity.single_iteration_run = single_iteration_run
    app_generate_entity.single_loop_run = single_loop_run

    workflow = MagicMock(spec=Workflow)
    workflow.tenant_id = "tenant"
    workflow.app_id = "app"
    workflow.id = "workflow"
    workflow.type = "workflow"
    workflow.version = "v1"
    workflow.graph_dict = {"nodes": [], "edges": []}
    workflow.environment_variables = []

    runner = WorkflowAppRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=MagicMock(spec=AppQueueManager),
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="system-user",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    graph, variable_pool, graph_runtime_state = _make_graph_state()
    mock_workflow_entry = MagicMock()
    mock_workflow_entry.graph_engine = MagicMock()
    mock_workflow_entry.graph_engine.layer = MagicMock()
    mock_workflow_entry.run.return_value = iter([])

    with (
        patch("core.app.apps.workflow.app_runner.RedisChannel"),
        patch("core.app.apps.workflow.app_runner.redis_client"),
        patch("core.app.apps.workflow.app_runner.WorkflowEntry", return_value=mock_workflow_entry) as entry_class,
        patch.object(
            runner,
            "_prepare_single_node_execution",
            return_value=(
                graph,
                variable_pool,
                graph_runtime_state,
            ),
        ) as prepare_single,
        patch.object(runner, "_init_graph") as init_graph,
    ):
        runner.run()

    prepare_single.assert_called_once_with(
        workflow=workflow,
        single_iteration_run=single_iteration_run,
        single_loop_run=single_loop_run,
        user_id="user",
    )
    init_graph.assert_not_called()

    entry_kwargs = entry_class.call_args.kwargs
    assert entry_kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert entry_kwargs["variable_pool"] is variable_pool
    assert entry_kwargs["graph_runtime_state"] is graph_runtime_state


def test_single_node_run_validates_target_node_config(monkeypatch) -> None:
    runner = WorkflowBasedAppRunner(
        queue_manager=MagicMock(spec=AppQueueManager),
        variable_loader=MagicMock(),
        app_id="app",
    )

    workflow = MagicMock(spec=Workflow)
    workflow.id = "workflow"
    workflow.tenant_id = "tenant"
    workflow.graph_dict = {
        "nodes": [
            {
                "id": "loop-node",
                "data": {
                    "type": "loop",
                    "title": "Loop",
                    "loop_count": 1,
                    "break_conditions": [],
                    "logical_operator": "and",
                },
            }
        ],
        "edges": [],
    }

    _, _, graph_runtime_state = _make_graph_state()
    seen_configs: list[object] = []
    original_validate_python = NodeConfigDictAdapter.validate_python

    def record_validate_python(value: object):
        seen_configs.append(value)
        return original_validate_python(value)

    monkeypatch.setattr(NodeConfigDictAdapter, "validate_python", record_validate_python)

    with (
        patch("core.app.apps.workflow_app_runner.DifyNodeFactory"),
        patch("core.app.apps.workflow_app_runner.Graph.init", return_value=MagicMock()),
        patch("core.app.apps.workflow_app_runner.load_into_variable_pool"),
        patch("core.app.apps.workflow_app_runner.WorkflowEntry.mapping_user_inputs_to_variable_pool"),
    ):
        runner._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id="loop-node",
            user_inputs={},
            graph_runtime_state=graph_runtime_state,
            node_type_filter_key="loop_id",
            node_type_label="loop",
            user_id="00000000-0000-0000-0000-000000000001",
        )

    assert seen_configs == [workflow.graph_dict["nodes"][0]]
