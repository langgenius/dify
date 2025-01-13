class CodeNodeError(ValueError):
    """Base class for code node errors."""

    pass


class OutputValidationError(CodeNodeError):
    """Raised when there is an output validation error."""

    pass


class DepthLimitError(CodeNodeError):
    """Raised when the depth limit is reached."""

    pass
