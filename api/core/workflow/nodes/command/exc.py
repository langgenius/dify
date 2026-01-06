class CommandNodeError(ValueError):
    """Base class for command node errors."""

    pass


class CommandExecutionError(CommandNodeError):
    """Raised when command execution fails."""

    pass


class CommandTimeoutError(CommandNodeError):
    """Raised when command execution times out."""

    pass
