from collections.abc import Mapping

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom as LegacyInvokeFrom
from dify_graph.entities import GraphInitParams
from dify_graph.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from dify_graph.enums import InvokeFrom, NodeType, UserFrom
from dify_graph.nodes.base.entities import BaseNodeData
from dify_graph.nodes.base.node import Node
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable


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
    init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable(user_id="user", files=[]), user_inputs={}),
        start_at=0.0,
    )
    return init_params, runtime_state


def _build_node_config() -> NodeConfigDict:
    return NodeConfigDictAdapter.validate_python(
        {
            "id": "node-1",
            "data": {
                "type": NodeType.ANSWER.value,
                "title": "Sample",
                "foo": "bar",
            },
        }
    )


def test_node_hydrates_data_during_initialization():
    graph_config: dict[str, object] = {}
    init_params, runtime_state = _build_context(graph_config)

    node = _SampleNode(
        id="node-1",
        config=_build_node_config(),
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    assert node.node_data.foo == "bar"
    assert node.title == "Sample"
    assert node.user_from == UserFrom.ACCOUNT
    assert node.invoke_from == InvokeFrom.DEBUGGER


def test_node_normalizes_legacy_invoke_from_enum():
    graph_config: dict[str, object] = {}
    init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=LegacyInvokeFrom.DEBUGGER,
        call_depth=0,
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable(user_id="user", files=[]), user_inputs={}),
        start_at=0.0,
    )

    node = _SampleNode(
        id="node-1",
        config=_build_node_config(),
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    assert node.user_from == UserFrom.ACCOUNT
    assert node.invoke_from == InvokeFrom.DEBUGGER


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


def test_base_node_data_keeps_dict_style_access_compatibility():
    node_data = _SampleNodeData.model_validate(
        {
            "type": NodeType.ANSWER.value,
            "title": "Sample",
            "foo": "bar",
        }
    )

    assert node_data["foo"] == "bar"
    assert node_data.get("foo") == "bar"
    assert node_data.get("missing", "fallback") == "fallback"
