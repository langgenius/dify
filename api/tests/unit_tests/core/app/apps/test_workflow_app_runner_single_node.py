from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.workflow import Workflow


def _make_graph_state():
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
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
    )
    init_graph.assert_not_called()

    entry_kwargs = entry_class.call_args.kwargs
    assert entry_kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert entry_kwargs["variable_pool"] is variable_pool
    assert entry_kwargs["graph_runtime_state"] is graph_runtime_state
