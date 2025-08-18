"""
Tests for the ExecutionLimitsLayer.

This module tests the execution limits monitoring functionality.
"""

import time
import unittest
from datetime import datetime
from unittest.mock import Mock

from core.workflow.enums import NodeType
from core.workflow.graph_engine.entities.commands import AbortCommand
from core.workflow.graph_engine.layers import ExecutionLimitsLayer
from core.workflow.graph_events import (
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)


class TestExecutionLimitsLayer(unittest.TestCase):
    """Test cases for ExecutionLimitsLayer."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_runtime_state = Mock()
        self.mock_command_channel = Mock()

        # Create layer with small limits for testing
        self.layer = ExecutionLimitsLayer(max_steps=3, max_time=1)

        # Initialize the layer
        self.layer.initialize(self.mock_runtime_state, self.mock_command_channel)

    def test_initialization(self):
        """Test layer initialization."""
        assert self.layer.max_steps == 3
        assert self.layer.max_time == 1
        assert self.layer.start_time is None
        assert self.layer.step_count == 0

    def test_on_graph_start(self):
        """Test graph start event handling."""
        self.layer.on_graph_start()

        assert self.layer.start_time is not None
        assert self.layer.step_count == 0
        assert self.layer._execution_started
        assert not self.layer._execution_ended

    def test_step_counting(self):
        """Test that steps are counted correctly."""
        self.layer.on_graph_start()

        # Simulate node executions
        event1 = NodeRunStartedEvent(
            id="exec1", node_id="node1", node_type=NodeType.LLM, node_title="Test Node 1", start_at=datetime.now()
        )
        event2 = NodeRunStartedEvent(
            id="exec2", node_id="node2", node_type=NodeType.LLM, node_title="Test Node 2", start_at=datetime.now()
        )

        self.layer.on_event(event1)
        assert self.layer.step_count == 1

        self.layer.on_event(event2)
        assert self.layer.step_count == 2

    def test_step_limit_enforcement(self):
        """Test that step limit is enforced."""
        self.layer.on_graph_start()

        # Exceed step limit
        for i in range(4):
            event = NodeRunStartedEvent(
                id=f"exec{i}",
                node_id=f"node{i}",
                node_type=NodeType.LLM,
                node_title=f"Test Node {i}",
                start_at=datetime.now(),
            )
            self.layer.on_event(event)

        # Should have sent abort command
        self.mock_command_channel.send_command.assert_called_once()
        command = self.mock_command_channel.send_command.call_args[0][0]
        assert isinstance(command, AbortCommand)
        assert command.reason is not None
        assert "Maximum execution steps exceeded" in command.reason

    def test_time_limit_enforcement(self):
        """Test that time limit is enforced."""
        self.layer.on_graph_start()

        # Simulate time passing
        time.sleep(1.1)  # Exceed 1 second limit

        # Trigger an event to check limits
        event = NodeRunStartedEvent(
            id="exec1", node_id="node1", node_type=NodeType.LLM, node_title="Test Node 1", start_at=datetime.now()
        )
        self.layer.on_event(event)

        # Should have sent abort command
        self.mock_command_channel.send_command.assert_called_once()
        command = self.mock_command_channel.send_command.call_args[0][0]
        assert isinstance(command, AbortCommand)
        assert command.reason is not None
        assert "Maximum execution time exceeded" in command.reason

    def test_ignores_irrelevant_events(self):
        """Test that irrelevant events don't affect step counting."""
        self.layer.on_graph_start()

        # These events shouldn't increment step count
        event1 = NodeRunSucceededEvent(id="exec1", node_id="node1", node_type=NodeType.LLM, start_at=datetime.now())
        event2 = NodeRunFailedEvent(
            id="exec2", node_id="node1", node_type=NodeType.LLM, error="test error", start_at=datetime.now()
        )

        self.layer.on_event(event1)
        self.layer.on_event(event2)

        assert self.layer.step_count == 0

    def test_on_graph_end(self):
        """Test graph end event handling."""
        self.layer.on_graph_start()

        # Simulate some execution
        event = NodeRunStartedEvent(
            id="exec1", node_id="node1", node_type=NodeType.LLM, node_title="Test Node 1", start_at=datetime.now()
        )
        self.layer.on_event(event)

        # End execution
        self.layer.on_graph_end(None)

        assert self.layer._execution_ended
        assert self.layer.start_time is not None

    def test_no_command_channel(self):
        """Test behavior when command channel is not available."""
        self.layer.command_channel = None
        self.layer.on_graph_start()

        # Try to exceed limits
        for i in range(4):
            event = NodeRunStartedEvent(
                id=f"exec{i}",
                node_id=f"node{i}",
                node_type=NodeType.LLM,
                node_title=f"Test Node {i}",
                start_at=datetime.now(),
            )
            self.layer.on_event(event)

        # Should not crash, just log warning
        # Since command_channel is None, send_command won't be called
        # We just verify the layer doesn't crash
        assert True  # Layer should handle this gracefully

    def test_execution_not_started(self):
        """Test that limits are not checked before execution starts."""
        # Don't call on_graph_start

        # Try to trigger events
        event = NodeRunStartedEvent(
            id="exec1", node_id="node1", node_type=NodeType.LLM, node_title="Test Node 1", start_at=datetime.now()
        )
        self.layer.on_event(event)

        # Should not count steps or check limits
        assert self.layer.step_count == 0
        self.mock_command_channel.send_command.assert_not_called()

    def test_execution_ended(self):
        """Test that limits are not checked after execution ends."""
        self.layer.on_graph_start()
        self.layer.on_graph_end(None)

        # Try to trigger events after execution ended
        event = NodeRunStartedEvent(
            id="exec1", node_id="node1", node_type=NodeType.LLM, node_title="Test Node 1", start_at=datetime.now()
        )
        self.layer.on_event(event)

        # Should not count steps or check limits
        assert self.layer.step_count == 0
        self.mock_command_channel.send_command.assert_not_called()

    def test_command_channel_error_handling(self):
        """Test error handling when command channel fails."""
        self.layer.on_graph_start()

        # Make command channel raise an exception
        self.mock_command_channel.send_command.side_effect = Exception("Channel error")

        # Try to exceed step limit
        for i in range(4):
            event = NodeRunStartedEvent(
                id=f"exec{i}",
                node_id=f"node{i}",
                node_type=NodeType.LLM,
                node_title=f"Test Node {i}",
                start_at=datetime.now(),
            )
            self.layer.on_event(event)

        # Should handle error gracefully and log it
        self.mock_command_channel.send_command.assert_called_once()

    def test_multiple_abort_commands_not_sent(self):
        """Test that only one abort command is sent when limits are exceeded."""
        self.layer.on_graph_start()

        # Exceed step limit
        for i in range(5):  # More than max_steps
            event = NodeRunStartedEvent(
                id=f"exec{i}",
                node_id=f"node{i}",
                node_type=NodeType.LLM,
                node_title=f"Test Node {i}",
                start_at=datetime.now(),
            )
            self.layer.on_event(event)

        # Should have sent abort command only once
        self.mock_command_channel.send_command.assert_called_once()

    def test_time_limit_with_multiple_events(self):
        """Test time limit enforcement with multiple events."""
        self.layer.on_graph_start()

        # Send some events
        for i in range(2):
            event = NodeRunStartedEvent(
                id=f"exec{i}",
                node_id=f"node{i}",
                node_type=NodeType.LLM,
                node_title=f"Test Node {i}",
                start_at=datetime.now(),
            )
            self.layer.on_event(event)

        # Wait to exceed time limit
        time.sleep(1.1)

        # Send another event to trigger time check
        event = NodeRunStartedEvent(
            id="exec3", node_id="node3", node_type=NodeType.LLM, node_title="Test Node 3", start_at=datetime.now()
        )
        self.layer.on_event(event)

        # Should have sent abort command
        self.mock_command_channel.send_command.assert_called_once()
        command = self.mock_command_channel.send_command.call_args[0][0]
        assert "Maximum execution time exceeded" in command.reason


if __name__ == "__main__":
    unittest.main()
