from __future__ import annotations

from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.variables.types import SegmentType
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.variable_aggregator.variable_aggregator_node import VariableAggregatorNode
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


def _make_runtime_state(*selectors_with_values) -> Mock:
    variable_pool = Mock()
    value_map = {tuple(selector): value for selector, value in selectors_with_values}

    def _get(selector):
        return value_map.get(tuple(selector))

    variable_pool.get.side_effect = _get
    graph_runtime_state = Mock()
    graph_runtime_state.variable_pool = variable_pool
    return graph_runtime_state


def test_run_without_groups_picks_first_found(graph_init_params: GraphInitParams) -> None:
    variable = Mock()
    variable.to_object.return_value = "value"
    runtime_state = _make_runtime_state(
        (
            [
                "start",
                "a",
            ],
            None,
        ),
        (
            [
                "start",
                "b",
            ],
            variable,
        ),
    )

    node_config = {
        "id": "node-1",
        "data": {
            "title": "Aggregator",
            "output_type": "string",
            "variables": [["start", "a"], ["start", "b"]],
        },
    }
    node = VariableAggregatorNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"output": variable}
    assert result.inputs == {"b": "value"}


def test_run_with_groups_outputs_group(graph_init_params: GraphInitParams) -> None:
    variable = Mock()
    variable.to_object.return_value = {"key": "value"}
    runtime_state = _make_runtime_state(
        (
            [
                "start",
                "payload",
            ],
            variable,
        )
    )

    node_config = {
        "id": "node-1",
        "data": {
            "title": "Aggregator",
            "output_type": "string",
            "variables": [],
            "advanced_settings": {
                "group_enabled": True,
                "groups": [
                    {
                        "output_type": SegmentType.OBJECT,
                        "variables": [["start", "payload"]],
                        "group_name": "group_a",
                    }
                ],
            },
        },
    }

    node = VariableAggregatorNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"group_a": {"output": variable}}
    assert result.inputs == {"payload": {"key": "value"}}


def test_run_without_matches_returns_empty_outputs(graph_init_params: GraphInitParams) -> None:
    runtime_state = _make_runtime_state(
        (
            [
                "start",
                "missing",
            ],
            None,
        )
    )

    node_config = {
        "id": "node-1",
        "data": {
            "title": "Aggregator",
            "output_type": "string",
            "variables": [["start", "missing"]],
        },
    }

    node = VariableAggregatorNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {}
    assert result.inputs == {}
