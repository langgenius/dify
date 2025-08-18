"""
Execution limits layer for GraphEngine.

This layer monitors workflow execution to enforce limits on:
- Maximum execution steps
- Maximum execution time

When limits are exceeded, the layer automatically aborts execution.
"""

import logging
import time
from typing import Optional

from pydantic import PositiveInt

from core.workflow.graph_engine.entities.commands import AbortCommand
from core.workflow.graph_engine.layers import Layer
from core.workflow.graph_events import (
    GraphEngineEvent,
    NodeRunStartedEvent,
)


class ExecutionLimitsLayer(Layer):
    """
    Layer that enforces execution limits for workflows.

    Monitors:
    - Step count: Tracks number of node executions
    - Time limit: Monitors total execution time

    Automatically aborts execution when limits are exceeded.
    """

    def __init__(self, max_steps: PositiveInt, max_time: PositiveInt) -> None:
        """
        Initialize the execution limits layer.

        Args:
            max_steps: Maximum number of execution steps allowed
            max_time: Maximum execution time in seconds allowed
        """
        super().__init__()
        self.max_steps = max_steps
        self.max_time = max_time

        # Runtime tracking
        self.start_time: Optional[float] = None
        self.step_count = 0
        self.logger = logging.getLogger(__name__)

        # State tracking
        self._execution_started = False
        self._execution_ended = False
        self._abort_sent = False  # Track if abort command has been sent

    def on_graph_start(self) -> None:
        """Called when graph execution starts."""
        self.start_time = time.time()
        self.step_count = 0
        self._execution_started = True
        self._execution_ended = False
        self._abort_sent = False

        self.logger.debug("Execution limits monitoring started")

    def on_event(self, event: GraphEngineEvent) -> None:
        """
        Called for every event emitted by the engine.

        Monitors execution progress and enforces limits.
        """
        if not self._execution_started or self._execution_ended or self._abort_sent:
            return

        # Track step count for node execution events
        if isinstance(event, NodeRunStartedEvent):
            self._handle_node_execution_event(event)

        # Check limits after each event
        self._check_limits()

    def on_graph_end(self, error: Optional[Exception]) -> None:
        """Called when graph execution ends."""
        if self._execution_started and not self._execution_ended:
            self._execution_ended = True

            if self.start_time:
                total_time = time.time() - self.start_time
                self.logger.debug("Execution completed: %d steps in %.2f seconds", self.step_count, total_time)

    def _handle_node_execution_event(self, event: GraphEngineEvent) -> None:
        """Handle node execution events to track step count."""
        if isinstance(event, NodeRunStartedEvent):
            # Only count started events to avoid double-counting
            self.step_count += 1
            self.logger.debug("Step %d started: %s", self.step_count, event.node_id)

    def _check_limits(self) -> None:
        """Check if execution limits have been exceeded."""
        if not self.command_channel or not self._execution_started or self._execution_ended or self._abort_sent:
            return

        # Check step limit
        if self.step_count > self.max_steps:
            self._abort_execution(f"Maximum execution steps exceeded: {self.step_count} > {self.max_steps}")
            return

        # Check time limit
        if self.start_time:
            elapsed_time = time.time() - self.start_time
            if elapsed_time > self.max_time:
                self._abort_execution(f"Maximum execution time exceeded: {elapsed_time:.2f}s > {self.max_time}s")

    def _abort_execution(self, reason: str) -> None:
        """
        Abort execution due to limit violation.

        Args:
            reason: Description of why execution was aborted
        """
        if not self.command_channel or self._abort_sent:
            return

        self.logger.warning("Execution limit exceeded: %s", reason)

        try:
            # Send abort command to the engine
            abort_command = AbortCommand(reason=reason)
            self.command_channel.send_command(abort_command)

            # Mark that abort has been sent to prevent duplicate commands
            self._abort_sent = True

            self.logger.debug("Abort command sent to engine")

        except Exception:
            self.logger.exception("Failed to send abort command: %s")
