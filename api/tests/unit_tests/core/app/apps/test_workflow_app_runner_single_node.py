from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.credit_usage import CreditUsageAppType
from core.workflow.system_variables import default_system_variables
from graphon.runtime import GraphRuntimeState, VariablePool
from models.model import AppMode
from models.workflow import Workflow, WorkflowKind
from services.workflow.execution.adapters.graph import WorkflowGraphBuilder
from services.workflow.execution.adapters.workflow.app_runner import WorkflowAppRunner
from services.workflow.execution.ports import WorkflowRuntime


def _make_graph_state():
    variable_pool = VariablePool.from_bootstrap(
        system_variables=default_system_variables(),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    return MagicMock(), variable_pool, GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)


@pytest.fixture
def queue_manager() -> WorkflowAppQueueManager:
    return WorkflowAppQueueManager(
        task_id="task-id", user_id="user", invoke_from=InvokeFrom.SERVICE_API, app_mode=AppMode.WORKFLOW
    )


@pytest.mark.parametrize(
    ("single_iteration_run", "single_loop_run"),
    [
        (WorkflowAppGenerateEntity.SingleIterationRunEntity(node_id="iter", inputs={}), None),
        (None, WorkflowAppGenerateEntity.SingleLoopRunEntity(node_id="loop", inputs={})),
    ],
)
def test_run_uses_single_node_execution_branch(
    single_iteration_run: WorkflowAppGenerateEntity.SingleIterationRunEntity | None,
    single_loop_run: WorkflowAppGenerateEntity.SingleLoopRunEntity | None,
    queue_manager: WorkflowAppQueueManager,
    *,
    workflow_runtime: WorkflowRuntime,
) -> None:
    app_generate_entity = WorkflowAppGenerateEntity(
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", workflow_id="workflow", app_mode=AppMode.WORKFLOW
        ),
        inputs={},
        files=[],
        user_id="user",
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_id="execution-id",
        task_id="task-id",
        stream=True,
        extras={"trace_session_id": "session-1"},
        single_iteration_run=single_iteration_run,
        single_loop_run=single_loop_run,
    )

    workflow = Workflow(
        tenant_id="tenant",
        app_id="app",
        id="workflow",
        type="workflow",
        version="v1",
        graph=json.dumps({"nodes": [], "edges": []}),
    )
    workflow.environment_variables = []

    runner = WorkflowAppRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=queue_manager,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="system-user",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        runtime=workflow_runtime,
    )

    graph, variable_pool, graph_runtime_state = _make_graph_state()
    mock_workflow_entry = MagicMock()
    mock_workflow_entry.graph_engine = MagicMock()
    mock_workflow_entry.graph_engine.layer = MagicMock()
    mock_workflow_entry.run.return_value = iter([])

    with (
        patch("services.workflow.execution.adapters.workflow.app_runner.RedisChannel"),
        patch("services.workflow.execution.adapters.workflow.app_runner.redis_client"),
        patch(
            "services.workflow.execution.adapters.workflow.app_runner.WorkflowEntry", return_value=mock_workflow_entry
        ) as entry_class,
        patch.object(
            runner._graphs,
            "build_single_node",
            return_value=(
                graph,
                variable_pool,
                graph_runtime_state,
            ),
        ) as prepare_single,
        patch.object(runner._graphs, "build") as init_graph,
    ):
        runner.run()

    prepare_single.assert_called_once_with(
        workflow=workflow,
        single_iteration_run=single_iteration_run,
        single_loop_run=single_loop_run,
        user_id="user",
        app_type=CreditUsageAppType.WORKFLOW,
        trace_session_id="session-1",
    )
    init_graph.assert_not_called()

    entry_kwargs = entry_class.call_args.kwargs
    assert entry_kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert entry_kwargs["variable_pool"] is variable_pool
    assert entry_kwargs["graph_runtime_state"] is graph_runtime_state


def test_single_node_run_validates_target_node_config() -> None:
    runner = WorkflowGraphBuilder(
        variable_loader=MagicMock(),
        app_id="app",
    )

    workflow = Workflow(
        id="workflow",
        tenant_id="tenant",
        graph=json.dumps(
            {
                "nodes": [
                    {
                        "id": "loop-node",
                        "data": {},
                    }
                ],
                "edges": [],
            }
        ),
    )

    _, _, graph_runtime_state = _make_graph_state()

    with pytest.raises(ValidationError, match="nodes.0.data.type"):
        runner._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id="loop-node",
            user_inputs={},
            graph_runtime_state=graph_runtime_state,
            node_type_filter_key="loop_id",
            node_type_label="loop",
            user_id="00000000-0000-0000-0000-000000000001",
        )


def test_run_adds_inputs_with_snippet_compatible_start_aliases(
    queue_manager: WorkflowAppQueueManager, *, workflow_runtime: WorkflowRuntime
) -> None:
    app_generate_entity = WorkflowAppGenerateEntity(
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", workflow_id="workflow", app_mode=AppMode.WORKFLOW
        ),
        inputs={"question": "hello"},
        files=[],
        user_id="user",
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_id="execution-id",
        task_id="task-id",
        stream=True,
    )

    workflow = Workflow(
        tenant_id="tenant",
        app_id="app",
        id="workflow",
        type="workflow",
        version="v1",
        graph=json.dumps({"nodes": [], "edges": []}),
        kind=WorkflowKind.SNIPPET,
    )
    workflow.environment_variables = []

    runner = WorkflowAppRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=queue_manager,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="system-user",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        runtime=workflow_runtime,
    )

    mock_workflow_entry = MagicMock()
    mock_workflow_entry.graph_engine = MagicMock()
    mock_workflow_entry.graph_engine.layer = MagicMock()
    mock_workflow_entry.run.return_value = iter([])

    with (
        patch("services.workflow.execution.adapters.workflow.app_runner.RedisChannel"),
        patch("services.workflow.execution.adapters.workflow.app_runner.redis_client"),
        patch(
            "services.workflow.execution.adapters.workflow.app_runner.WorkflowEntry", return_value=mock_workflow_entry
        ),
        patch("services.workflow.execution.adapters.workflow.app_runner.build_system_variables", return_value={}),
        patch("services.workflow.execution.adapters.workflow.app_runner.build_bootstrap_variables", return_value=[]),
        patch("services.workflow.execution.adapters.workflow.app_runner.add_variables_to_pool"),
        patch(
            "services.workflow.execution.adapters.workflow.app_runner.get_default_root_node_id",
            return_value="root-node",
        ),
        patch(
            "services.workflow.execution.adapters.workflow.app_runner.get_compatible_start_aliases",
            return_value=("legacy-start",),
        ) as aliases,
        patch("services.workflow.execution.adapters.workflow.app_runner.add_node_inputs_to_pool") as add_inputs,
        patch.object(runner._graphs, "build", return_value=MagicMock()),
    ):
        runner.run()

    aliases.assert_called_once_with(workflow_kind="snippet", root_node_id="root-node")
    add_inputs.assert_called_once()
    assert add_inputs.call_args.kwargs["node_id"] == "root-node"
    assert add_inputs.call_args.kwargs["inputs"] == {"question": "hello"}
    assert add_inputs.call_args.kwargs["aliases"] == ("legacy-start",)
