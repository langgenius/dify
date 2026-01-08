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
