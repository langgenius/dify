from __future__ import annotations

from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.base.template import Template
from core.workflow.nodes.end.end_node import EndNode
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


def test_end_node_run_collects_outputs(graph_init_params: GraphInitParams) -> None:
    first_var = Mock()
    first_var.to_object.return_value = "alpha"
    second_var = Mock()
    second_var.to_object.return_value = 123

    variable_pool = Mock()
    variable_pool.get.side_effect = [first_var, None, second_var]

    graph_runtime_state = Mock()
    graph_runtime_state.variable_pool = variable_pool

    node_config = {
        "id": "node-1",
        "data": {
            "title": "End",
            "outputs": [
                {"variable": "text", "value_selector": ["start", "text"]},
                {"variable": "missing", "value_selector": ["start", "missing"]},
                {"variable": "count", "value_selector": ["calc", "count"]},
            ],
        },
    }

    node = EndNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"text": "alpha", "missing": None, "count": 123}
    assert result.inputs == result.outputs


def test_end_node_streaming_template(graph_init_params: GraphInitParams) -> None:
    graph_runtime_state = Mock()
    node_config = {
        "id": "node-1",
        "data": {
            "title": "End",
            "outputs": [
                {"variable": "text", "value_selector": ["start", "text"]},
                {"variable": "count", "value_selector": ["calc", "count"]},
            ],
        },
    }

    node = EndNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )

    template = node.get_streaming_template()

    assert isinstance(template, Template)
    assert str(template) == "{{#start.text#}}\n{{#calc.count#}}"
