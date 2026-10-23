from unittest.mock import MagicMock

from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.agent.entities import AgentNodeData
from core.workflow.nodes.agent.events import AgentLogEvent, NodeRunAgentLogEvent
from graphon.engine_events import NodeRunStreamChunkEvent
from graphon.enums import BuiltinNodeTypes
from graphon.node_events import StreamChunkEvent
from graphon.runtime import InitParams, RuntimeState, VariablePool


def test_dispatch_converts_agent_events_and_delegates_other_events() -> None:
    node = AgentNode(
        node_id="node-id",
        data=AgentNodeData(title="Agent"),
        init_params=InitParams(
            workflow_id="workflow-id",
            graph_config={},
            run_context={},
            call_depth=0,
        ),
        runtime_state=RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0),
        strategy_resolver=MagicMock(),
        presentation_provider=MagicMock(),
        runtime_support=MagicMock(),
        message_transformer=MagicMock(),
    )
    node._node_execution_id = "execution-id"

    graph_event = node._dispatch(
        AgentLogEvent(
            message_id="message-id",
            label="label",
            node_execution_id="agent-execution-id",
            parent_id="parent-id",
            error=None,
            status="succeeded",
            data={"output": "done"},
            metadata={"provider": "test"},
            node_id="source-node-id",
        )
    )

    assert graph_event == NodeRunAgentLogEvent(
        id="execution-id",
        node_id="node-id",
        node_type=BuiltinNodeTypes.AGENT,
        message_id="message-id",
        label="label",
        node_execution_id="agent-execution-id",
        parent_id="parent-id",
        error=None,
        status="succeeded",
        data={"output": "done"},
        metadata={"provider": "test"},
    )
    assert isinstance(
        node._dispatch(StreamChunkEvent(selector=["node-id", "text"], chunk="hello")),
        NodeRunStreamChunkEvent,
    )


def test_extract_variable_selector_to_variable_mapping_skips_empty_selectors() -> None:
    node_data = AgentNodeData(
        agent_parameters={
            "empty_str": AgentNodeData.AgentInput(type="variable", value=""),
            "empty_list": AgentNodeData.AgentInput(type="variable", value=[]),
            "none_val": AgentNodeData.AgentInput(type="variable", value=None),
            "valid_var": AgentNodeData.AgentInput(type="variable", value=["start", "text"]),
            "template_var": AgentNodeData.AgentInput(type="mixed", value="{{#start.query#}}"),
        }
    )

    mapping = AgentNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="agent_1",
        node_data=node_data,
    )

    assert "agent_1.empty_str" not in mapping
    assert "agent_1.empty_list" not in mapping
    assert "agent_1.none_val" not in mapping
    assert mapping["agent_1.valid_var"] == ["start", "text"]
    assert mapping["agent_1.#start.query#"] == ["start", "query"]
