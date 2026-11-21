class ToolNodeError(ValueError):
    """Base exception for tool node errors."""


class ToolRuntimeResolutionError(ToolNodeError):
    """Raised when the workflow layer cannot construct a tool runtime."""


class ToolRuntimeInvocationError(ToolNodeError):
    """Raised when the workflow layer fails while invoking a tool runtime."""


class ToolParameterError(ToolNodeError):
    """Exception raised for errors in tool parameters."""


class ToolFileError(ToolNodeError):
    """Exception raised for errors related to tool files."""
