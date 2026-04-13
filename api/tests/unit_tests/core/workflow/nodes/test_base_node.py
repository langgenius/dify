from collections.abc import Mapping

import pytest
from graphon.entities import GraphInitParams
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.base.node import Node
from graphon.runtime import GraphRuntimeState, VariablePool

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.node_runtime import resolve_dify_run_context
from core.workflow.system_variables import build_system_variables
from tests.workflow_test_utils import build_test_graph_init_params


class _SampleNodeData(BaseNodeData):
    foo: str


class _SampleNode(Node[_SampleNodeData]):
    node_type = BuiltinNodeTypes.ANSWER

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
        variable_pool=VariablePool(system_variables=build_system_variables(user_id="user", files=[]), user_inputs={}),
        start_at=0.0,
    )
    return init_params, runtime_state


def _build_node_config() -> NodeConfigDict:
    return NodeConfigDictAdapter.validate_python(
        {
            "id": "node-1",
            "data": {
                "type": BuiltinNodeTypes.ANSWER,
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
    dify_ctx = resolve_dify_run_context(node.run_context)
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
        variable_pool=VariablePool(system_variables=build_system_variables(user_id="user", files=[]), user_inputs={}),
        start_at=0.0,
    )

    node = _SampleNode(
        id="node-1",
        config=_build_node_config(),
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    dify_ctx = resolve_dify_run_context(node.run_context)
    assert dify_ctx.user_from == UserFrom.ACCOUNT
    assert dify_ctx.invoke_from == InvokeFrom.DEBUGGER
    assert node.get_run_context_value("missing") is None
    with pytest.raises(ValueError):
        node.require_run_context_value("missing")


def test_missing_generic_argument_raises_type_error():
    graph_config: dict[str, object] = {}

    with pytest.raises(TypeError):

        class _InvalidNode(Node):  # type: ignore[type-abstract]
            node_type = BuiltinNodeTypes.ANSWER

            @classmethod
            def version(cls) -> str:
                return "1"

            def _run(self):
                raise NotImplementedError


def test_base_node_data_keeps_dict_style_access_compatibility():
    node_data = _SampleNodeData.model_validate(
        {
            "type": BuiltinNodeTypes.ANSWER,
            "title": "Sample",
            "foo": "bar",
        }
    )

    assert node_data["foo"] == "bar"
    assert node_data.get("foo") == "bar"
    assert node_data.get("missing", "fallback") == "fallback"


def test_node_hydration_preserves_compatibility_extra_fields():
    graph_config: dict[str, object] = {}
    init_params, runtime_state = _build_context(graph_config)
    node_config = NodeConfigDictAdapter.validate_python(
        {
            "id": "node-1",
            "data": {
                "type": BuiltinNodeTypes.ANSWER,
                "title": "Sample",
                "foo": "bar",
                "compat_flag": True,
            },
        }
    )

    node = _SampleNode(
        id="node-1",
        config=node_config,
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    assert node.node_data.foo == "bar"
    assert node.node_data.get("compat_flag") is True
