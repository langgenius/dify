from __future__ import annotations

from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from dify_graph.enums import NodeType
from dify_graph.model_runtime.entities.llm_entities import LLMUsage, LLMUsageMetadata
from dify_graph.model_runtime.utils.encoders import jsonable_encoder
from dify_graph.node_events import NodeRunResult, StreamCompletedEvent
from dify_graph.nodes.agent.agent_node import AgentNode
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
from tests.workflow_test_utils import build_test_graph_init_params


@pytest.fixture
def agent_node() -> AgentNode:
    graph_config: dict[str, Any] = {
        "nodes": [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "title": "Agent",
                    "desc": "",
                    "agent_strategy_provider_name": "provider/plugin",
                    "agent_strategy_name": "test-agent",
                    "agent_strategy_label": "Test Agent",
                    "agent_parameters": {},
                },
            }
        ],
        "edges": [],
    }

    init_params = build_test_graph_init_params(
        workflow_id="workflow-id",
        graph_config=graph_config,
        tenant_id="tenant-id",
        app_id="app-id",
        user_id="user-id",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable(user_id="user-id", files=[]), user_inputs={}),
        start_at=0.0,
    )

    return AgentNode(
        id="node-instance",
        config=graph_config["nodes"][0],
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )


def _build_json_message(payload: dict[str, Any]) -> ToolInvokeMessage:
    return ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.JSON,
        message=ToolInvokeMessage.JsonMessage(json_object=payload),
    )


def _run_transform(agent_node: AgentNode, messages: list[ToolInvokeMessage]) -> NodeRunResult:
    def _identity_transform(
        messages: Generator[ToolInvokeMessage, None, None], *_args: Any, **_kwargs: Any
    ) -> Generator[ToolInvokeMessage, None, None]:
        return messages

    with patch.object(
        ToolFileMessageTransformer, "transform_tool_invoke_messages", side_effect=_identity_transform, autospec=True
    ):
        events = list(
            agent_node._transform_message(
                messages=iter(messages),
                tool_info={"agent_strategy": "test-agent"},
                parameters_for_log={},
                user_id="user-id",
                tenant_id="tenant-id",
                node_type=NodeType.AGENT,
                node_id=agent_node._node_id,
                node_execution_id=agent_node.id,
            )
        )

    completed_events = [event for event in events if isinstance(event, StreamCompletedEvent)]
    assert len(completed_events) == 1
    return completed_events[0].node_run_result


def test_transform_message_accumulates_usage_across_json_messages(agent_node: AgentNode) -> None:
    metadata_one: LLMUsageMetadata = {
        "prompt_tokens": 12,
        "completion_tokens": 8,
        "total_tokens": 20,
        "total_price": "0.15",
        "latency": 0.4,
    }
    metadata_two: LLMUsageMetadata = {
        "prompt_tokens": 5,
        "completion_tokens": 7,
        "total_tokens": 12,
        "total_price": "0.25",
        "latency": 0.6,
    }

    result = _run_transform(
        agent_node,
        [
            _build_json_message({"execution_metadata": dict(metadata_one), "step": 1}),
            _build_json_message({"execution_metadata": dict(metadata_two), "step": 2}),
        ],
    )

    expected_usage = LLMUsage.from_metadata(metadata_one) + LLMUsage.from_metadata(metadata_two)

    assert result.llm_usage == expected_usage
    assert result.outputs["usage"] == jsonable_encoder(expected_usage)


def test_transform_message_keeps_single_round_usage(agent_node: AgentNode) -> None:
    metadata: LLMUsageMetadata = {
        "prompt_tokens": 6,
        "completion_tokens": 4,
        "total_tokens": 10,
        "total_price": "0.08",
        "latency": 0.3,
    }

    result = _run_transform(
        agent_node,
        [
            _build_json_message({"execution_metadata": dict(metadata), "step": 1}),
        ],
    )

    expected_usage = LLMUsage.from_metadata(metadata)

    assert result.llm_usage == expected_usage
    assert result.outputs["usage"] == jsonable_encoder(expected_usage)


def test_transform_message_keeps_existing_usage_when_later_json_has_no_metadata(agent_node: AgentNode) -> None:
    metadata: LLMUsageMetadata = {
        "prompt_tokens": 9,
        "completion_tokens": 3,
        "total_tokens": 12,
        "total_price": "0.11",
        "latency": 0.2,
    }

    result = _run_transform(
        agent_node,
        [
            _build_json_message({"execution_metadata": dict(metadata), "step": 1}),
            _build_json_message({"step": 2}),
        ],
    )

    expected_usage = LLMUsage.from_metadata(metadata)

    assert result.llm_usage == expected_usage
    assert result.outputs["usage"] == jsonable_encoder(expected_usage)
