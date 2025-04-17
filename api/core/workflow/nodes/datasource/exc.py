class ToolNodeError(ValueError):
    """Base exception for tool node errors."""

    pass


class ToolParameterError(ToolNodeError):
    """Exception raised for errors in tool parameters."""

    pass


class ToolFileError(ToolNodeError):
    """Exception raised for errors related to tool files."""

    pass
