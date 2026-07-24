from collections.abc import Mapping

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from dify_graph.entities import GraphInitParams
from dify_graph.enums import NodeType
from dify_graph.nodes.base.entities import BaseNodeData
from dify_graph.nodes.base.node import Node
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
from tests.workflow_test_utils import build_test_graph_init_params


class _SampleNodeData(BaseNodeData):
    foo: str


class _SampleNode(Node[_SampleNodeData]):
    node_type = NodeType.ANSWER

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self):
        raise NotImplementedError


def _build_context(graph_config: Mapping[str, object]) -> tuple[GraphInitParams, GraphRuntimeState]:
    init_params = build_test_graph_init_params(
        graph_config=graph_config,
        user_from="account",
        invoke_from="debugger",
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable(user_id="user", files=[]), user_inputs={}),
        start_at=0.0,
    )
    return init_params, runtime_state


def test_node_hydrates_data_during_initialization():
    graph_config: dict[str, object] = {}
    init_params, runtime_state = _build_context(graph_config)

    node = _SampleNode(
        id="node-1",
        config={"id": "node-1", "data": {"title": "Sample", "foo": "bar"}},
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    assert node.node_data.foo == "bar"
    assert node.title == "Sample"
    dify_ctx = node.require_dify_context()
    assert dify_ctx.user_from == "account"
    assert dify_ctx.invoke_from == "debugger"


def test_node_accepts_invoke_from_enum():
    graph_config: dict[str, object] = {}
    init_params = build_test_graph_init_params(
        graph_config=graph_config,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable(user_id="user", files=[]), user_inputs={}),
        start_at=0.0,
    )

    node = _SampleNode(
        id="node-1",
        config={"id": "node-1", "data": {"title": "Sample", "foo": "bar"}},
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    dify_ctx = node.require_dify_context()
    assert dify_ctx.user_from == UserFrom.ACCOUNT
    assert dify_ctx.invoke_from == InvokeFrom.DEBUGGER
    assert node.get_run_context_value("missing") is None
    with pytest.raises(ValueError):
        node.require_run_context_value("missing")


def test_missing_generic_argument_raises_type_error():
    graph_config: dict[str, object] = {}

    with pytest.raises(TypeError):

        class _InvalidNode(Node):  # type: ignore[type-abstract]
            node_type = NodeType.ANSWER

            @classmethod
            def version(cls) -> str:
                return "1"

            def _run(self):
                raise NotImplementedError
