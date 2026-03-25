class ToolNodeError(ValueError):
    """Base exception for tool node errors."""

    pass


class ToolRuntimeResolutionError(ToolNodeError):
    """Raised when the workflow layer cannot construct a tool runtime."""

    pass


class ToolRuntimeInvocationError(ToolNodeError):
    """Raised when the workflow layer fails while invoking a tool runtime."""

    pass


class ToolParameterError(ToolNodeError):
    """Exception raised for errors in tool parameters."""

    pass


class ToolFileError(ToolNodeError):
    """Exception raised for errors related to tool files."""

    pass
