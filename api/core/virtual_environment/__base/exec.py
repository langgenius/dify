class ArchNotSupportedError(Exception):
    """Exception raised when the architecture is not supported."""

    pass


class VirtualEnvironmentLaunchFailedError(Exception):
    """Exception raised when launching the virtual environment fails."""

    pass
