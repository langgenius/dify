from __future__ import annotations

from typing import Any

from core.model_manager import ModelInstance
from core.workflow.node_factory import DifyNodeFactory
from dify_graph.nodes.llm.entities import LLMNodeData
from dify_graph.nodes.llm.node import LLMNode
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
from tests.workflow_test_utils import build_test_graph_init_params


def _build_factory(graph_config: dict[str, Any]) -> DifyNodeFactory:
    graph_init_params = build_test_graph_init_params(
        workflow_id="workflow",
        graph_config=graph_config,
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from="account",
        invoke_from="debugger",
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


def test_create_node_uses_declared_node_data_type_for_llm_validation(monkeypatch):
    class _FactoryLLMNodeData(LLMNodeData):
        pass

    llm_node_config = {
        "id": "llm-node",
        "data": {
            "type": "llm",
            "title": "LLM",
            "model": {
                "provider": "openai",
                "name": "gpt-4o-mini",
                "mode": "chat",
                "completion_params": {},
            },
            "prompt_template": [],
            "context": {
                "enabled": False,
            },
        },
    }
    graph_config = {"nodes": [llm_node_config], "edges": []}
    factory = _build_factory(graph_config)
    captured: dict[str, object] = {}

    monkeypatch.setattr(LLMNode, "_node_data_type", _FactoryLLMNodeData)

    def _capture_model_instance(self: DifyNodeFactory, node_data: object) -> ModelInstance:
        captured["node_data"] = node_data
        return object()  # type: ignore[return-value]

    def _capture_memory(
        self: DifyNodeFactory,
        *,
        node_data: object,
        model_instance: ModelInstance,
    ) -> None:
        captured["memory_node_data"] = node_data

    monkeypatch.setattr(DifyNodeFactory, "_build_model_instance_for_llm_node", _capture_model_instance)
    monkeypatch.setattr(DifyNodeFactory, "_build_memory_for_llm_node", _capture_memory)

    node = factory.create_node(llm_node_config)

    assert isinstance(captured["node_data"], _FactoryLLMNodeData)
    assert isinstance(captured["memory_node_data"], _FactoryLLMNodeData)
    assert isinstance(node.node_data, _FactoryLLMNodeData)
