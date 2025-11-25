from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType
from core.workflow.graph import Graph
from core.workflow.graph.validation import GraphValidationError
from core.workflow.nodes.base.entities import BaseNodeData
from core.workflow.nodes.base.node import Node
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


class _TestNodeData(BaseNodeData):
    type: NodeType | str | None = None
    execution_type: NodeExecutionType | str | None = None


class _TestNode(Node[_TestNodeData]):
    node_type = NodeType.ANSWER
    execution_type = NodeExecutionType.EXECUTABLE

    @classmethod
    def version(cls) -> str:
        return "1"

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

        node_type_value = self.data.get("type")
        if isinstance(node_type_value, NodeType):
            self.node_type = node_type_value
        elif isinstance(node_type_value, str):
            try:
                self.node_type = NodeType(node_type_value)
            except ValueError:
                pass

    def _run(self):
        raise NotImplementedError

    def post_init(self) -> None:
        super().post_init()
        self._maybe_override_execution_type()
        self.data = dict(self.node_data.model_dump())

    def _maybe_override_execution_type(self) -> None:
        execution_type_value = self.node_data.execution_type
        if execution_type_value is None:
            return
        if isinstance(execution_type_value, NodeExecutionType):
            self.execution_type = execution_type_value
        else:
            self.execution_type = NodeExecutionType(execution_type_value)


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


def test_graph_validation_blocks_start_and_trigger_coexistence(
    graph_init_dependencies: tuple[_SimpleNodeFactory, dict[str, object]],
) -> None:
    node_factory, graph_config = graph_init_dependencies
    graph_config["nodes"] = [
        {"id": "start", "data": {"type": NodeType.START, "title": "Start", "execution_type": NodeExecutionType.ROOT}},
        {
            "id": "trigger",
            "data": {"type": NodeType.TRIGGER_WEBHOOK, "title": "Webhook", "execution_type": NodeExecutionType.ROOT},
        },
    ]
    graph_config["edges"] = []

    with pytest.raises(GraphValidationError) as exc_info:
        Graph.init(graph_config=graph_config, node_factory=node_factory)

    assert any(issue.code == "TRIGGER_START_NODE_CONFLICT" for issue in exc_info.value.issues)
