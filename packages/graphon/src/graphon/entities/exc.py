class BaseNodeError(ValueError):
    """Base class for node errors."""


class DefaultValueTypeError(BaseNodeError):
    """Raised when the default value type is invalid."""
