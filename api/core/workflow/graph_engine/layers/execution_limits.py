"""
Execution limits layer for GraphEngine.

This layer monitors workflow execution to enforce limits on:
- Maximum execution steps
- Maximum execution time

When limits are exceeded, the layer automatically aborts execution.
"""

import logging
import time
from enum import StrEnum
from typing import final

from typing_extensions import override

from core.workflow.graph_engine.entities.commands import AbortCommand, CommandType
from core.workflow.graph_engine.layers import GraphEngineLayer
from core.workflow.graph_events import (
    GraphEngineEvent,
    NodeRunStartedEvent,
)
from core.workflow.graph_events.node import NodeRunFailedEvent, NodeRunSucceededEvent


class LimitType(StrEnum):
    """Types of execution limits that can be exceeded."""

    STEP_LIMIT = "step_limit"
    TIME_LIMIT = "time_limit"


@final
class ExecutionLimitsLayer(GraphEngineLayer):
    """
    Layer that enforces execution limits for workflows.

    Monitors:
    - Step count: Tracks number of node executions
    - Time limit: Monitors total execution time

    Automatically aborts execution when limits are exceeded.
    """

    def __init__(self, max_steps: int, max_time: int) -> None:
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
        self.start_time: float | None = None
        self.step_count = 0
        self.logger = logging.getLogger(__name__)

        # State tracking
        self._execution_started = False
        self._execution_ended = False
        self._abort_sent = False  # Track if abort command has been sent

    @override
    def on_graph_start(self) -> None:
        """Called when graph execution starts."""
        self.start_time = time.time()
        self.step_count = 0
        self._execution_started = True
        self._execution_ended = False
        self._abort_sent = False

        self.logger.debug("Execution limits monitoring started")

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        """
        Called for every event emitted by the engine.

        Monitors execution progress and enforces limits.
        """
        if not self._execution_started or self._execution_ended or self._abort_sent:
            return

        # Track step count for node execution events
        if isinstance(event, NodeRunStartedEvent):
            self.step_count += 1
            self.logger.debug("Step %d started: %s", self.step_count, event.node_id)

        # Check step limit when node execution completes
        if isinstance(event, NodeRunSucceededEvent | NodeRunFailedEvent):
            if self._reached_step_limitation():
                self._send_abort_command(LimitType.STEP_LIMIT)

            if self._reached_time_limitation():
                self._send_abort_command(LimitType.TIME_LIMIT)

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        """Called when graph execution ends."""
        if self._execution_started and not self._execution_ended:
            self._execution_ended = True

            if self.start_time:
                total_time = time.time() - self.start_time
                self.logger.debug("Execution completed: %d steps in %.2f seconds", self.step_count, total_time)

    def _reached_step_limitation(self) -> bool:
        """Check if step count limit has been exceeded."""
        return self.step_count > self.max_steps

    def _reached_time_limitation(self) -> bool:
        """Check if time limit has been exceeded."""
        return self.start_time is not None and (time.time() - self.start_time) > self.max_time

    def _send_abort_command(self, limit_type: LimitType) -> None:
        """
        Send abort command due to limit violation.

        Args:
            limit_type: Type of limit exceeded
        """
        if not self.command_channel or not self._execution_started or self._execution_ended or self._abort_sent:
            return

        # Format detailed reason message
        if limit_type == LimitType.STEP_LIMIT:
            reason = f"Maximum execution steps exceeded: {self.step_count} > {self.max_steps}"
        elif limit_type == LimitType.TIME_LIMIT:
            elapsed_time = time.time() - self.start_time if self.start_time else 0
            reason = f"Maximum execution time exceeded: {elapsed_time:.2f}s > {self.max_time}s"

        self.logger.warning("Execution limit exceeded: %s", reason)

        try:
            # Send abort command to the engine
            abort_command = AbortCommand(command_type=CommandType.ABORT, reason=reason)
            self.command_channel.send_command(abort_command)

            # Mark that abort has been sent to prevent duplicate commands
            self._abort_sent = True

            self.logger.debug("Abort command sent to engine")

        except Exception:
            self.logger.exception("Failed to send abort command")
