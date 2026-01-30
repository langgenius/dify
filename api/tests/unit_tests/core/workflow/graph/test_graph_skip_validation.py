from __future__ import annotations

from typing import Any

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph.validation import GraphValidationError
from core.workflow.nodes import NodeType
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


def _build_iteration_graph(node_id: str) -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": node_id,
                "data": {
                    "type": "iteration",
                    "title": "Iteration",
                    "iterator_selector": ["start", "items"],
                    "output_selector": [node_id, "output"],
                },
            }
        ],
        "edges": [],
    }


def _build_loop_graph(node_id: str) -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": node_id,
                "data": {
                    "type": "loop",
                    "title": "Loop",
                    "loop_count": 1,
                    "break_conditions": [],
                    "logical_operator": "and",
                    "loop_variables": [],
                    "outputs": {},
                },
            }
        ],
        "edges": [],
    }


def _make_factory(graph_config: dict[str, Any]) -> DifyNodeFactory:
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
            environment_variables=[],
        ),
        start_at=0.0,
    )
    return DifyNodeFactory(graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state)


def test_iteration_root_requires_skip_validation():
    node_id = "iteration-node"
    graph_config = _build_iteration_graph(node_id)
    node_factory = _make_factory(graph_config)

    with pytest.raises(GraphValidationError):
        Graph.init(
            graph_config=graph_config,
            node_factory=node_factory,
            root_node_id=node_id,
        )

    graph = Graph.init(
        graph_config=graph_config,
        node_factory=node_factory,
        root_node_id=node_id,
        skip_validation=True,
    )

    assert graph.root_node.id == node_id
    assert graph.root_node.node_type == NodeType.ITERATION


def test_loop_root_requires_skip_validation():
    node_id = "loop-node"
    graph_config = _build_loop_graph(node_id)
    node_factory = _make_factory(graph_config)

    with pytest.raises(GraphValidationError):
        Graph.init(
            graph_config=graph_config,
            node_factory=node_factory,
            root_node_id=node_id,
        )

    graph = Graph.init(
        graph_config=graph_config,
        node_factory=node_factory,
        root_node_id=node_id,
        skip_validation=True,
    )

    assert graph.root_node.id == node_id
    assert graph.root_node.node_type == NodeType.LOOP
