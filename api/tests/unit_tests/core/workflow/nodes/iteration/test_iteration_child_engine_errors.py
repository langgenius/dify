from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from dify_graph.entities import GraphInitParams
from dify_graph.nodes.iteration.exc import IterationGraphNotFoundError
from dify_graph.nodes.iteration.iteration_node import IterationNode
from dify_graph.runtime import (
    ChildEngineBuilderNotConfiguredError,
    ChildGraphNotFoundError,
    GraphRuntimeState,
    VariablePool,
)
from dify_graph.system_variable import SystemVariable
from tests.workflow_test_utils import build_test_graph_init_params


class _MissingGraphBuilder:
    def build_child_engine(
        self,
        *,
        workflow_id: str,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        graph_config: Mapping[str, Any],
        root_node_id: str,
        layers: Sequence[object] = (),
    ) -> object:
        raise ChildGraphNotFoundError(f"child graph root node '{root_node_id}' not found")


def _build_runtime_state() -> GraphRuntimeState:
    return GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable.default(), user_inputs={}),
        start_at=0.0,
    )


def _build_iteration_node(
    *,
    graph_config: Mapping[str, Any],
    runtime_state: GraphRuntimeState,
    start_node_id: str,
) -> IterationNode:
    init_params = build_test_graph_init_params(graph_config=graph_config)
    return IterationNode(
        id="iteration-node",
        config={
            "id": "iteration-node",
            "data": {
                "type": "iteration",
                "title": "Iteration",
                "iterator_selector": ["start", "items"],
                "output_selector": ["iteration-node", "output"],
                "start_node_id": start_node_id,
            },
        },
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )


def test_graph_runtime_state_raises_specific_error_when_child_builder_is_missing():
    runtime_state = _build_runtime_state()
    graph_init_params = build_test_graph_init_params()

    with pytest.raises(ChildEngineBuilderNotConfiguredError):
        runtime_state.create_child_engine(
            workflow_id="workflow",
            graph_init_params=graph_init_params,
            graph_runtime_state=_build_runtime_state(),
            graph_config={},
            root_node_id="root",
        )


def test_iteration_node_only_translates_child_graph_not_found_error():
    runtime_state = _build_runtime_state()
    runtime_state.bind_child_engine_builder(_MissingGraphBuilder())
    node = _build_iteration_node(
        graph_config={"nodes": [{"id": "present-node"}], "edges": []},
        runtime_state=runtime_state,
        start_node_id="missing-node",
    )

    with pytest.raises(IterationGraphNotFoundError):
        node._create_graph_engine(index=0, item="item")


def test_iteration_node_propagates_non_graph_not_found_errors():
    runtime_state = _build_runtime_state()
    node = _build_iteration_node(
        graph_config={"nodes": [{"id": "start-node"}], "edges": []},
        runtime_state=runtime_state,
        start_node_id="start-node",
    )

    with pytest.raises(ChildEngineBuilderNotConfiguredError):
        node._create_graph_engine(index=0, item="item")
