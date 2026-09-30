from unittest.mock import MagicMock

from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.agent.entities import AgentNodeData
from core.workflow.nodes.agent.events import AgentLogEvent, NodeRunAgentLogEvent
from graphon.entities import GraphInitParams
from graphon.enums import BuiltinNodeTypes
from graphon.graph_events import NodeRunStreamChunkEvent
from graphon.node_events import StreamChunkEvent
from graphon.runtime import GraphRuntimeState, VariablePool


def test_dispatch_converts_agent_events_and_delegates_other_events() -> None:
    node = AgentNode(
        node_id="node-id",
        data=AgentNodeData(title="Agent"),
        graph_init_params=GraphInitParams(
            workflow_id="workflow-id",
            graph_config={},
            run_context={},
            call_depth=0,
        ),
        graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
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
