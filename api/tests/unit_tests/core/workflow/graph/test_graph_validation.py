from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType
from core.workflow.graph import Graph
from core.workflow.graph.validation import GraphValidationError
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


class _TestNode(Node):
    node_type = NodeType.ANSWER
    execution_type = NodeExecutionType.EXECUTABLE

    @classmethod
    def version(cls) -> str:
        return "test"

    def __init__(
        self,
        *,
        id: str,
        config: Mapping[str, object],
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        data = config.get("data", {})
        if isinstance(data, Mapping):
            execution_type = data.get("execution_type")
            if isinstance(execution_type, str):
                self.execution_type = NodeExecutionType(execution_type)
        self._base_node_data = BaseNodeData(title=str(data.get("title", self.id)))
        self.data: dict[str, object] = {}

    def init_node_data(self, data: Mapping[str, object]) -> None:
        title = str(data.get("title", self.id))
        desc = data.get("description")
        error_strategy_value = data.get("error_strategy")
        error_strategy: ErrorStrategy | None = None
        if isinstance(error_strategy_value, ErrorStrategy):
            error_strategy = error_strategy_value
        elif isinstance(error_strategy_value, str):
            error_strategy = ErrorStrategy(error_strategy_value)
        self._base_node_data = BaseNodeData(
            title=title,
            desc=str(desc) if desc is not None else None,
            error_strategy=error_strategy,
        )
        self.data = dict(data)

    def _run(self):
        raise NotImplementedError

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._base_node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._base_node_data.retry_config

    def _get_title(self) -> str:
        return self._base_node_data.title

    def _get_description(self) -> str | None:
        return self._base_node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._base_node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._base_node_data


@dataclass(slots=True)
class _SimpleNodeFactory:
    graph_init_params: GraphInitParams
    graph_runtime_state: GraphRuntimeState

    def create_node(self, node_config: Mapping[str, object]) -> _TestNode:
        node_id = str(node_config["id"])
        node = _TestNode(
            id=node_id,
            config=node_config,
            graph_init_params=self.graph_init_params,
            graph_runtime_state=self.graph_runtime_state,
        )
        node.init_node_data(node_config.get("data", {}))
        return node


@pytest.fixture
def graph_init_dependencies() -> tuple[_SimpleNodeFactory, dict[str, object]]:
    graph_config: dict[str, object] = {"edges": [], "nodes": []}
    init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )
    variable_pool = VariablePool(system_variables=SystemVariable(user_id="user", files=[]), user_inputs={})
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    factory = _SimpleNodeFactory(graph_init_params=init_params, graph_runtime_state=runtime_state)
    return factory, graph_config


def test_graph_initialization_runs_default_validators(
    graph_init_dependencies: tuple[_SimpleNodeFactory, dict[str, object]],
):
    node_factory, graph_config = graph_init_dependencies
    graph_config["nodes"] = [
        {"id": "start", "data": {"type": NodeType.START, "title": "Start", "execution_type": NodeExecutionType.ROOT}},
        {"id": "answer", "data": {"type": NodeType.ANSWER, "title": "Answer"}},
    ]
    graph_config["edges"] = [
        {"source": "start", "target": "answer", "sourceHandle": "success"},
    ]

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    assert graph.root_node.id == "start"
    assert "answer" in graph.nodes


def test_graph_validation_fails_for_unknown_edge_targets(
    graph_init_dependencies: tuple[_SimpleNodeFactory, dict[str, object]],
) -> None:
    node_factory, graph_config = graph_init_dependencies
    graph_config["nodes"] = [
        {"id": "start", "data": {"type": NodeType.START, "title": "Start", "execution_type": NodeExecutionType.ROOT}},
    ]
    graph_config["edges"] = [
        {"source": "start", "target": "missing", "sourceHandle": "success"},
    ]

    with pytest.raises(GraphValidationError) as exc:
        Graph.init(graph_config=graph_config, node_factory=node_factory)

    assert any(issue.code == "MISSING_NODE" for issue in exc.value.issues)


def test_graph_promotes_fail_branch_nodes_to_branch_execution_type(
    graph_init_dependencies: tuple[_SimpleNodeFactory, dict[str, object]],
) -> None:
    node_factory, graph_config = graph_init_dependencies
    graph_config["nodes"] = [
        {"id": "start", "data": {"type": NodeType.START, "title": "Start", "execution_type": NodeExecutionType.ROOT}},
        {
            "id": "branch",
            "data": {
                "type": NodeType.IF_ELSE,
                "title": "Branch",
                "error_strategy": ErrorStrategy.FAIL_BRANCH,
            },
        },
    ]
    graph_config["edges"] = [
        {"source": "start", "target": "branch", "sourceHandle": "success"},
    ]

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    assert graph.nodes["branch"].execution_type == NodeExecutionType.BRANCH
