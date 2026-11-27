"""Execution limits layer for Engine.

This layer monitors workflow execution to enforce limits on:
- Maximum execution steps
- Maximum execution time

When limits are exceeded, the layer automatically aborts execution.
"""

import logging
import time
from typing import final, override

from graphon.engine.command.entities import AbortCommand
from graphon.engine.layer.base import Layer
from graphon.engine_events.base import EngineEvent
from graphon.engine_events.node import (
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)


@final
class ExecutionLimitsLayer(Layer):
    """Layer that enforces execution limits for workflows.

    Monitors:
    - Step count: Tracks number of node executions
    - Time limit: Monitors total execution time

    Automatically aborts execution when limits are exceeded.
    """

    def __init__(self, max_steps: int, max_time: int) -> None:
        """Initialize the execution limits layer.

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
    def on_event(self, event: EngineEvent) -> None:
        """Called for every event emitted by the engine.

        Monitors execution progress and enforces limits.
        """
        if not self._execution_started or self._execution_ended or self._abort_sent:
            return

        match event:
            case NodeRunStartedEvent():
                self.step_count += 1
                self.logger.debug("Step %d started: %s", self.step_count, event.node_id)
            case NodeRunSucceededEvent() | NodeRunFailedEvent():
                if self._step_limit_exceeded():
                    reason = (
                        "Maximum execution steps exceeded: "
                        f"{self.step_count} > {self.max_steps}"
                    )
                elif (
                    start_time := self.start_time
                ) is not None and self._time_limit_exceeded():
                    elapsed_time = time.time() - start_time
                    reason = (
                        "Maximum execution time exceeded: "
                        f"{elapsed_time:.2f}s > {self.max_time}s"
                    )
                else:
                    return
                self._send_abort_command(reason)
            case _:
                pass

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        """Called when graph execution ends."""
        if self._execution_started and not self._execution_ended:
            self._execution_ended = True

            if self.start_time:
                total_time = time.time() - self.start_time
                self.logger.debug(
                    "Execution completed: %d steps in %.2f seconds",
                    self.step_count,
                    total_time,
                )

    def _step_limit_exceeded(self) -> bool:
        """Check if step count limit has been exceeded."""
        return self.step_count > self.max_steps

    def _time_limit_exceeded(self) -> bool:
        """Check if time limit has been exceeded."""
        return (
            self.start_time is not None
            and (time.time() - self.start_time) > self.max_time
        )

    def _send_abort_command(self, reason: str) -> None:
        """Send abort command due to limit violation.

        Args:
            reason: Human-readable description of the exceeded limit.

        """
        if (
            not self.command_channel
            or not self._execution_started
            or self._execution_ended
            or self._abort_sent
        ):
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
            self.logger.exception("Failed to send abort command")
