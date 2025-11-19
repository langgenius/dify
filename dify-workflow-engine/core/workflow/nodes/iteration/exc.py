class IterationNodeError(ValueError):
    """Base class for iteration node errors."""


class IteratorVariableNotFoundError(IterationNodeError):
    """Raised when the iterator variable is not found."""


class InvalidIteratorValueError(IterationNodeError):
    """Raised when the iterator value is invalid."""


class StartNodeIdNotFoundError(IterationNodeError):
    """Raised when the start node ID is not found."""


class IterationGraphNotFoundError(IterationNodeError):
    """Raised when the iteration graph is not found."""


class IterationIndexNotFoundError(IterationNodeError):
    """Raised when the iteration index is not found."""
