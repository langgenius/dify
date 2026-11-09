"""Main command processor for handling external commands."""

import logging
from typing import final

from graphon.entities.pause_reason import SchedulingPause
from graphon.runtime.execution import ROOT_FRAME_ID, GraphExecution

from ..frame import FrameRegistry
from .entities import (
    AbortCommand,
    Command,
    PauseCommand,
    UpdateVariablesCommand,
)
from .protocol import CommandChannel

logger = logging.getLogger(__name__)


@final
class CommandProcessor:
    """Processes external commands sent to the engine.

    This polls the command channel and applies each supported command directly.
    """

    def __init__(
        self,
        command_channel: CommandChannel,
        graph_execution: GraphExecution,
        frame_registry: FrameRegistry,
    ) -> None:
        """Initialize the command processor.

        Args:
            command_channel: Channel for receiving commands
            graph_execution: Graph execution aggregate
            frame_registry: Live execution frames updated by external commands

        """
        self._command_channel = command_channel
        self._graph_execution = graph_execution
        self._frame_registry = frame_registry

    def process_commands(self) -> None:
        """Check for and process any pending commands."""
        try:
            commands = self._command_channel.fetch_commands()
        except Exception:
            logger.exception("Error processing commands")
            return

        for command in commands:
            try:
                self._handle_command(command)
            except Exception:
                logger.exception(
                    "Error handling command %s",
                    command.__class__.__name__,
                )

    def _handle_command(self, command: Command) -> None:
        """Handle a single command.

        Args:
            command: The command to handle

        """
        match command:
            case AbortCommand():
                logger.debug(
                    "Aborting workflow %s: %s",
                    self._graph_execution.workflow_id,
                    command.reason,
                )
                self._graph_execution.abort(
                    command.reason or "User requested abort",
                )
            case PauseCommand():
                logger.debug(
                    "Pausing workflow %s: %s",
                    self._graph_execution.workflow_id,
                    command.reason,
                )
                self._graph_execution.pause(
                    SchedulingPause(message=command.reason),
                )
            case UpdateVariablesCommand():
                for variable in command.updates:
                    try:
                        for frame in self._frame_registry.frames():
                            variable_pool = frame.state.variable_pool
                            if (
                                frame.frame_id != ROOT_FRAME_ID
                                and variable_pool.get_variable(variable.selector)
                                is None
                            ):
                                continue
                            variable_pool.add(
                                variable.selector,
                                variable.model_copy(deep=True),
                            )
                        logger.debug(
                            "Updated variable %s for workflow %s",
                            variable.selector,
                            self._graph_execution.workflow_id,
                        )
                    except ValueError as exc:
                        logger.warning(
                            "Skipping invalid variable selector %s for workflow %s: %s",
                            getattr(variable, "selector", None),
                            self._graph_execution.workflow_id,
                            exc,
                        )
            case _:
                logger.warning(
                    "Unsupported command: %s",
                    command.__class__.__name__,
                )
