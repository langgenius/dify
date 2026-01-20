from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.virtual_environment.__base.entities import CommandResult


class ArchNotSupportedError(Exception):
    """Exception raised when the architecture is not supported."""

    pass


class VirtualEnvironmentLaunchFailedError(Exception):
    """Exception raised when launching the virtual environment fails."""

    pass


class NotSupportedOperationError(Exception):
    """Exception raised when an operation is not supported."""

    pass


class SandboxConfigValidationError(ValueError):
    """Exception raised when sandbox configuration validation fails."""

    pass


class CommandExecutionError(Exception):
    """Raised when a command execution fails."""

    result: CommandResult

    def __init__(self, message: str, result: CommandResult):
        super().__init__(message)
        self.result = result

    @property
    def exit_code(self) -> int | None:
        return self.result.exit_code

    @property
    def stderr(self) -> bytes:
        return self.result.stderr


class PipelineExecutionError(CommandExecutionError):
    """Raised when a pipeline command fails in strict mode."""

    index: int
    command: list[str]
    results: list[CommandResult]

    def __init__(
        self, message: str, result: CommandResult, *, index: int, command: list[str], results: list[CommandResult]
    ):
        super().__init__(message, result)
        self.index = index
        self.command = command
        self.results = results
