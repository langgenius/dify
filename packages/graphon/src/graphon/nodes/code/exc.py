class CodeNodeError(ValueError):
    """Base class for code node errors."""


class OutputValidationError(CodeNodeError):
    """Raised when there is an output validation error."""


class DepthLimitError(CodeNodeError):
    """Raised when the depth limit is reached."""
