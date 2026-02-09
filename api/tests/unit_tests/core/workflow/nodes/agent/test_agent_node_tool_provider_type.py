from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from core.agent.plugin_entities import AgentStrategyParameter
from core.tools.entities.tool_entities import ToolParameter, ToolProviderType
from core.workflow.entities import GraphInitParams
from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


def _create_agent_node(tools: list[dict[str, Any]]) -> AgentNode:
    graph_config: dict[str, Any] = {
        "nodes": [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "title": "Agent",
                    "desc": "",
                    "agent_strategy_provider_name": "provider",
                    "agent_strategy_name": "strategy",
                    "agent_strategy_label": "Strategy",
                    "agent_parameters": {"tools": {"type": "constant", "value": tools}},
                },
            }
        ],
        "edges": [],
    }

    init_params = GraphInitParams(
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_id="workflow-id",
        graph_config=graph_config,
        user_id="user-id",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable(user_id="user-id")),
        start_at=0.0,
    )

    return AgentNode(
        id="node-instance",
        config=graph_config["nodes"][0],
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )


def _tools_strategy_parameter() -> AgentStrategyParameter:
    return AgentStrategyParameter.model_validate(
        {
            "name": "tools",
            "label": {"en_US": "Tools"},
            "type": AgentStrategyParameter.AgentStrategyParameterType.TOOLS_SELECTOR,
        }
    )


def _dummy_tool_runtime():
    runtime_parameter = SimpleNamespace(name="query", form=ToolParameter.ToolParameterForm.LLM)
    entity = SimpleNamespace(
        description=SimpleNamespace(llm=""),
        parameters=[runtime_parameter],
        model_dump=lambda mode="json": {"identity": {"name": "workflow-tool"}},
    )
    runtime = SimpleNamespace(runtime_parameters={})
    return SimpleNamespace(entity=entity, runtime=runtime)


def test_resolve_tool_provider_type_prefers_explicit_type():
    provider_type = AgentNode._resolve_tool_provider_type(
        {"type": ToolProviderType.BUILT_IN.value, "provider_name": "workflow-id"},
        {"workflow-id"},
    )
    assert provider_type == ToolProviderType.BUILT_IN


def test_resolve_tool_provider_type_falls_back_to_workflow():
    provider_type = AgentNode._resolve_tool_provider_type({"provider_name": "workflow-id"}, {"workflow-id"})
    assert provider_type == ToolProviderType.WORKFLOW


def test_resolve_tool_provider_type_defaults_to_builtin_when_not_detected():
    provider_type = AgentNode._resolve_tool_provider_type({"provider_name": "builtin-provider"}, {"workflow-id"})
    assert provider_type == ToolProviderType.BUILT_IN


def test_get_workflow_tool_provider_ids_returns_empty_when_no_missing_type():
    node = _create_agent_node(tools=[])
    assert node._get_workflow_tool_provider_ids(
        [{"type": ToolProviderType.BUILT_IN.value, "provider_name": "x"}]
    ) == set()


def test_get_workflow_tool_provider_ids_queries_existing_workflow_providers():
    node = _create_agent_node(tools=[])

    class _FakeScalars:
        def __init__(self, values: list[str]):
            self._values = values

        def all(self):
            return self._values

    class _FakeSession:
        def __init__(self, values: list[str]):
            self._values = values
            self.received_stmt = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def begin(self):
            return self

        def scalars(self, stmt):
            self.received_stmt = stmt
            return _FakeScalars(self._values)

    fake_session = _FakeSession(["wf-1"])
    with (
        patch("core.workflow.nodes.agent.agent_node.db", new=SimpleNamespace(engine=object())),
        patch("core.workflow.nodes.agent.agent_node.Session", return_value=fake_session) as session_cls,
    ):
        result = node._get_workflow_tool_provider_ids([{"provider_name": "wf-1"}])

    assert result == {"wf-1"}
    session_cls.assert_called_once()
    assert fake_session.received_stmt is not None


def test_generate_agent_parameters_uses_workflow_provider_when_type_is_missing():
    tools = [
        {
            "provider_name": "workflow-id",
            "tool_name": "workflow_tool",
            "settings": {},
            "parameters": {"query": {"auto": 1, "value": None}},
            "enabled": True,
        }
    ]
    node = _create_agent_node(tools=tools)
    strategy = SimpleNamespace(meta_version="0.0.2")
    captured_provider_types: list[ToolProviderType] = []

    def _fake_get_agent_tool_runtime(_tenant_id, _app_id, entity, *_args):
        captured_provider_types.append(entity.provider_type)
        return _dummy_tool_runtime()

    with (
        patch.object(node, "_get_workflow_tool_provider_ids", return_value={"workflow-id"}),
        patch(
            "core.workflow.nodes.agent.agent_node.ToolManager.get_agent_tool_runtime",
            side_effect=_fake_get_agent_tool_runtime,
        ),
    ):
        parameters = node._generate_agent_parameters(
            agent_parameters=[_tools_strategy_parameter()],
            variable_pool=node.graph_runtime_state.variable_pool,
            node_data=node.node_data,
            strategy=strategy,
        )

    assert captured_provider_types == [ToolProviderType.WORKFLOW]
    assert parameters["tools"][0]["provider_type"] == ToolProviderType.WORKFLOW.value
