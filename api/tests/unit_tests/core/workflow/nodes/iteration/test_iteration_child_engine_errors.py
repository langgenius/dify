from collections.abc import Mapping
from typing import Any

import pytest

from core.workflow.system_variables import default_system_variables
from graphon.entities import GraphInitParams
from graphon.nodes.iteration.entities import IterationNodeData
from graphon.nodes.iteration.exc import IterationGraphNotFoundError
from graphon.nodes.iteration.iteration_node import IterationNode
from graphon.runtime import (
    ChildEngineBuilderNotConfiguredError,
    ChildGraphNotFoundError,
    GraphRuntimeState,
    VariablePool,
)
from tests.workflow_test_utils import build_test_graph_init_params


class _MissingGraphBuilder:
    def build_child_engine(
        self,
        *,
        workflow_id: str,
        graph_init_params: GraphInitParams,
        parent_graph_runtime_state: GraphRuntimeState,
        root_node_id: str,
        variable_pool: VariablePool | None = None,
    ) -> object:
        raise ChildGraphNotFoundError(f"child graph root node '{root_node_id}' not found")


def _build_runtime_state() -> GraphRuntimeState:
    return GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables(), user_inputs={}),
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
        node_id="iteration-node",
        data=IterationNodeData(
            type="iteration",
            title="Iteration",
            iterator_selector=["start", "items"],
            output_selector=["iteration-node", "output"],
            start_node_id=start_node_id,
        ),
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
