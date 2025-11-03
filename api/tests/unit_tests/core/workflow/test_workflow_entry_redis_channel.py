"""Tests for WorkflowEntry integration with Redis command channel."""

from unittest.mock import MagicMock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.workflow_entry import WorkflowEntry
from models.enums import UserFrom


class TestWorkflowEntryRedisChannel:
    """Test suite for WorkflowEntry with Redis command channel."""

    def test_workflow_entry_uses_provided_redis_channel(self):
        """Test that WorkflowEntry uses the provided Redis command channel."""
        # Mock dependencies
        mock_graph = MagicMock()
        mock_graph_config = {"nodes": [], "edges": []}
        mock_variable_pool = MagicMock(spec=VariablePool)
        mock_graph_runtime_state = MagicMock(spec=GraphRuntimeState)
        mock_graph_runtime_state.variable_pool = mock_variable_pool

        # Create a mock Redis channel
        mock_redis_client = MagicMock()
        redis_channel = RedisChannel(mock_redis_client, "test:channel:key")

        # Patch GraphEngine to verify it receives the Redis channel
        with patch("core.workflow.workflow_entry.GraphEngine") as MockGraphEngine:
            mock_graph_engine = MagicMock()
            MockGraphEngine.return_value = mock_graph_engine

            # Create WorkflowEntry with Redis channel
            workflow_entry = WorkflowEntry(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                graph_config=mock_graph_config,
                graph=mock_graph,
                user_id="test-user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
                variable_pool=mock_variable_pool,
                graph_runtime_state=mock_graph_runtime_state,
                command_channel=redis_channel,  # Provide Redis channel
            )

            # Verify GraphEngine was initialized with the Redis channel
            MockGraphEngine.assert_called_once()
            call_args = MockGraphEngine.call_args[1]
            assert call_args["command_channel"] == redis_channel
            assert workflow_entry.command_channel == redis_channel

    def test_workflow_entry_defaults_to_inmemory_channel(self):
        """Test that WorkflowEntry defaults to InMemoryChannel when no channel is provided."""
        # Mock dependencies
        mock_graph = MagicMock()
        mock_graph_config = {"nodes": [], "edges": []}
        mock_variable_pool = MagicMock(spec=VariablePool)
        mock_graph_runtime_state = MagicMock(spec=GraphRuntimeState)
        mock_graph_runtime_state.variable_pool = mock_variable_pool

        # Patch GraphEngine and InMemoryChannel
        with (
            patch("core.workflow.workflow_entry.GraphEngine") as MockGraphEngine,
            patch("core.workflow.workflow_entry.InMemoryChannel") as MockInMemoryChannel,
        ):
            mock_graph_engine = MagicMock()
            MockGraphEngine.return_value = mock_graph_engine
            mock_inmemory_channel = MagicMock()
            MockInMemoryChannel.return_value = mock_inmemory_channel

            # Create WorkflowEntry without providing a channel
            workflow_entry = WorkflowEntry(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                graph_config=mock_graph_config,
                graph=mock_graph,
                user_id="test-user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
                variable_pool=mock_variable_pool,
                graph_runtime_state=mock_graph_runtime_state,
                command_channel=None,  # No channel provided
            )

            # Verify InMemoryChannel was created
            MockInMemoryChannel.assert_called_once()

            # Verify GraphEngine was initialized with the InMemory channel
            MockGraphEngine.assert_called_once()
            call_args = MockGraphEngine.call_args[1]
            assert call_args["command_channel"] == mock_inmemory_channel
            assert workflow_entry.command_channel == mock_inmemory_channel

    def test_workflow_entry_run_with_redis_channel(self):
        """Test that WorkflowEntry.run() works correctly with Redis channel."""
        # Mock dependencies
        mock_graph = MagicMock()
        mock_graph_config = {"nodes": [], "edges": []}
        mock_variable_pool = MagicMock(spec=VariablePool)
        mock_graph_runtime_state = MagicMock(spec=GraphRuntimeState)
        mock_graph_runtime_state.variable_pool = mock_variable_pool

        # Create a mock Redis channel
        mock_redis_client = MagicMock()
        redis_channel = RedisChannel(mock_redis_client, "test:channel:key")

        # Mock events to be generated
        mock_event1 = MagicMock()
        mock_event2 = MagicMock()

        # Patch GraphEngine
        with patch("core.workflow.workflow_entry.GraphEngine") as MockGraphEngine:
            mock_graph_engine = MagicMock()
            mock_graph_engine.run.return_value = iter([mock_event1, mock_event2])
            MockGraphEngine.return_value = mock_graph_engine

            # Create WorkflowEntry with Redis channel
            workflow_entry = WorkflowEntry(
                tenant_id="test-tenant",
                app_id="test-app",
                workflow_id="test-workflow",
                graph_config=mock_graph_config,
                graph=mock_graph,
                user_id="test-user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
                variable_pool=mock_variable_pool,
                graph_runtime_state=mock_graph_runtime_state,
                command_channel=redis_channel,
            )

            # Run the workflow
            events = list(workflow_entry.run())

            # Verify events were generated
            assert len(events) == 2
            assert events[0] == mock_event1
            assert events[1] == mock_event2
