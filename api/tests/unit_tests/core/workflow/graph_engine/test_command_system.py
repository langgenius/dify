"""Test the command system for GraphEngine control."""

import time
from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphRuntimeState, VariablePool
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_engine.entities.commands import AbortCommand
from core.workflow.graph_events import GraphRunAbortedEvent, GraphRunStartedEvent
from models.enums import UserFrom


def test_abort_command():
    """Test that GraphEngine properly handles abort commands."""

    # Create shared GraphRuntimeState
    shared_runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

    # Create a minimal mock graph
    mock_graph = MagicMock(spec=Graph)
    mock_graph.nodes = {}
    mock_graph.edges = {}
    mock_graph.root_node = MagicMock()
    mock_graph.root_node.id = "start"

    # Create mock nodes with required attributes - using shared runtime state
    mock_start_node = MagicMock()
    mock_start_node.state = None
    mock_start_node.id = "start"
    mock_start_node.graph_runtime_state = shared_runtime_state  # Use shared instance
    mock_graph.nodes["start"] = mock_start_node

    # Mock graph methods
    mock_graph.get_outgoing_edges = MagicMock(return_value=[])
    mock_graph.get_incoming_edges = MagicMock(return_value=[])

    # Create command channel
    command_channel = InMemoryChannel()

    # Create GraphEngine with same shared runtime state
    engine = GraphEngine(
        tenant_id="test",
        app_id="test",
        workflow_id="test_workflow",
        user_id="test",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=mock_graph,
        graph_config={},
        graph_runtime_state=shared_runtime_state,  # Use shared instance
        max_execution_steps=100,
        max_execution_time=10,
        command_channel=command_channel,
    )

    # Send abort command before starting
    abort_command = AbortCommand(reason="Test abort")
    command_channel.send_command(abort_command)

    # Run engine and collect events
    events = list(engine.run())

    # Verify we get start and abort events
    assert any(isinstance(e, GraphRunStartedEvent) for e in events)
    assert any(isinstance(e, GraphRunAbortedEvent) for e in events)

    # Find the abort event and check its reason
    abort_events = [e for e in events if isinstance(e, GraphRunAbortedEvent)]
    assert len(abort_events) == 1
    assert "aborted by user command" in abort_events[0].reason.lower()


def test_redis_channel_serialization():
    """Test that Redis channel properly serializes and deserializes commands."""
    import json
    from unittest.mock import MagicMock

    # Mock redis client
    mock_redis = MagicMock()
    mock_pipeline = MagicMock()
    mock_redis.pipeline.return_value.__enter__ = MagicMock(return_value=mock_pipeline)
    mock_redis.pipeline.return_value.__exit__ = MagicMock(return_value=None)

    from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel

    # Create channel with a specific key
    channel = RedisChannel(mock_redis, channel_key="workflow:123:commands")

    # Test sending a command
    abort_command = AbortCommand(reason="Test abort")
    channel.send_command(abort_command)

    # Verify redis methods were called
    mock_pipeline.rpush.assert_called_once()
    mock_pipeline.expire.assert_called_once()

    # Verify the serialized data
    call_args = mock_pipeline.rpush.call_args
    key = call_args[0][0]
    command_json = call_args[0][1]

    assert key == "workflow:123:commands"

    # Verify JSON structure
    command_data = json.loads(command_json)
    assert command_data["command_type"] == "abort"
    assert command_data["reason"] == "Test abort"


if __name__ == "__main__":
    test_abort_command()
    test_redis_channel_serialization()
    print("All tests passed!")
