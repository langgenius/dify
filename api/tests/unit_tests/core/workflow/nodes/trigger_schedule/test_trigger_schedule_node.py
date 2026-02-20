from __future__ import annotations

from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities import GraphInitParams
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.trigger_schedule.trigger_schedule_node import TriggerScheduleNode
from models.enums import UserFrom


@pytest.fixture
def graph_init_params() -> GraphInitParams:
    return GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={},
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )


def test_get_default_config() -> None:
    config = TriggerScheduleNode.get_default_config()

    assert config["type"] == "trigger-schedule"
    assert config["config"]["frequency"] == "daily"
    assert config["config"]["timezone"] == "UTC"


def test_run_includes_system_variables(graph_init_params: GraphInitParams) -> None:
    variable_pool = Mock()
    variable_pool.user_inputs = {"input_key": "input_value"}
    system_variables = Mock()
    system_variables.to_dict.return_value = {"sys_key": "sys_val"}
    variable_pool.system_variables = system_variables

    graph_runtime_state = Mock()
    graph_runtime_state.variable_pool = variable_pool

    node_config = {
        "id": "node-1",
        "data": {
            "title": "Schedule",
            "mode": "visual",
            "frequency": "daily",
            "visual_config": {"time": "12:00 AM"},
            "timezone": "UTC",
        },
    }

    node = TriggerScheduleNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.inputs["input_key"] == "input_value"
    assert result.inputs[f"{SYSTEM_VARIABLE_NODE_ID}.sys_key"] == "sys_val"
    assert result.outputs == result.inputs
