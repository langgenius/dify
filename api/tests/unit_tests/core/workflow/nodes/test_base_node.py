from collections.abc import Mapping

import pytest

from core.workflow.entities import GraphInitParams
from core.workflow.enums import NodeType
from core.workflow.nodes.base.entities import BaseNodeData
from core.workflow.nodes.base.node import Node
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


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
