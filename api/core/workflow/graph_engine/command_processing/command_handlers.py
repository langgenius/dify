import logging
from typing import final

from typing_extensions import override

from ..domain.graph_execution import GraphExecution
from ..entities.commands import AbortCommand, GraphEngineCommand, PauseCommand
from .command_processor import CommandHandler

logger = logging.getLogger(__name__)


@final
class AbortCommandHandler(CommandHandler):
    @override
    def handle(self, command: GraphEngineCommand, execution: GraphExecution) -> None:
        assert isinstance(command, AbortCommand)
        logger.debug("Aborting workflow %s: %s", execution.workflow_id, command.reason)
        execution.abort(command.reason or "User requested abort")


@final
class PauseCommandHandler(CommandHandler):
    @override
    def handle(self, command: GraphEngineCommand, execution: GraphExecution) -> None:
        assert isinstance(command, PauseCommand)
        logger.debug("Pausing workflow %s: %s", execution.workflow_id, command.reason)
        execution.pause(command.reason)
