"""Test the command system for GraphEngine control."""

import time
from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.variables import IntegerVariable, StringVariable
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_engine.entities.commands import (
    AbortCommand,
    CommandType,
    PauseCommand,
    UpdateVariablesCommand,
    VariableUpdate,
)
from core.workflow.graph_events import GraphRunAbortedEvent, GraphRunPausedEvent, GraphRunStartedEvent
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
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
    start_node = StartNode(
        id="start",
        config={"id": "start", "data": {"title": "start", "variables": []}},
        graph_init_params=GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        ),
        graph_runtime_state=shared_runtime_state,
    )
    mock_graph.nodes["start"] = start_node

    # Mock graph methods
    mock_graph.get_outgoing_edges = MagicMock(return_value=[])
    mock_graph.get_incoming_edges = MagicMock(return_value=[])

    # Create command channel
    command_channel = InMemoryChannel()

    # Create GraphEngine with same shared runtime state
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=mock_graph,
        graph_runtime_state=shared_runtime_state,  # Use shared instance
        command_channel=command_channel,
        config=GraphEngineConfig(),
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
    assert abort_events[0].reason is not None
    assert "aborted: test abort" in abort_events[0].reason.lower()


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

    # Test pause command serialization
    pause_command = PauseCommand(reason="User requested pause")
    channel.send_command(pause_command)

    assert len(mock_pipeline.rpush.call_args_list) == 2
    second_call_args = mock_pipeline.rpush.call_args_list[1]
    pause_command_json = second_call_args[0][1]
    pause_command_data = json.loads(pause_command_json)
    assert pause_command_data["command_type"] == CommandType.PAUSE.value
    assert pause_command_data["reason"] == "User requested pause"


def test_pause_command():
    """Test that GraphEngine properly handles pause commands."""

    shared_runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

    mock_graph = MagicMock(spec=Graph)
    mock_graph.nodes = {}
    mock_graph.edges = {}
    mock_graph.root_node = MagicMock()
    mock_graph.root_node.id = "start"

    start_node = StartNode(
        id="start",
        config={"id": "start", "data": {"title": "start", "variables": []}},
        graph_init_params=GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        ),
        graph_runtime_state=shared_runtime_state,
    )
    mock_graph.nodes["start"] = start_node

    mock_graph.get_outgoing_edges = MagicMock(return_value=[])
    mock_graph.get_incoming_edges = MagicMock(return_value=[])

    command_channel = InMemoryChannel()

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=mock_graph,
        graph_runtime_state=shared_runtime_state,
        command_channel=command_channel,
        config=GraphEngineConfig(),
    )

    pause_command = PauseCommand(reason="User requested pause")
    command_channel.send_command(pause_command)

    events = list(engine.run())

    assert any(isinstance(e, GraphRunStartedEvent) for e in events)
    pause_events = [e for e in events if isinstance(e, GraphRunPausedEvent)]
    assert len(pause_events) == 1
    assert pause_events[0].reasons == [SchedulingPause(message="User requested pause")]

    graph_execution = engine.graph_runtime_state.graph_execution
    assert graph_execution.pause_reasons == [SchedulingPause(message="User requested pause")]


def test_update_variables_command_updates_pool():
    """Test that GraphEngine updates variable pool via update variables command."""

    shared_runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
    shared_runtime_state.variable_pool.add(("node1", "foo"), "old value")

    mock_graph = MagicMock(spec=Graph)
    mock_graph.nodes = {}
    mock_graph.edges = {}
    mock_graph.root_node = MagicMock()
    mock_graph.root_node.id = "start"

    start_node = StartNode(
        id="start",
        config={"id": "start", "data": {"title": "start", "variables": []}},
        graph_init_params=GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        ),
        graph_runtime_state=shared_runtime_state,
    )
    mock_graph.nodes["start"] = start_node

    mock_graph.get_outgoing_edges = MagicMock(return_value=[])
    mock_graph.get_incoming_edges = MagicMock(return_value=[])

    command_channel = InMemoryChannel()

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=mock_graph,
        graph_runtime_state=shared_runtime_state,
        command_channel=command_channel,
        config=GraphEngineConfig(),
    )

    update_command = UpdateVariablesCommand(
        updates=[
            VariableUpdate(
                value=StringVariable(name="foo", value="new value", selector=["node1", "foo"]),
            ),
            VariableUpdate(
                value=IntegerVariable(name="bar", value=123, selector=["node2", "bar"]),
            ),
        ]
    )
    command_channel.send_command(update_command)

    list(engine.run())

    updated_existing = shared_runtime_state.variable_pool.get(["node1", "foo"])
    added_new = shared_runtime_state.variable_pool.get(["node2", "bar"])

    assert updated_existing is not None
    assert updated_existing.value == "new value"
    assert added_new is not None
    assert added_new.value == 123
