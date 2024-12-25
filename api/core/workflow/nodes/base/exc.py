class BaseNodeError(ValueError):
    """Base class for node errors."""

    pass


class DefaultValueTypeError(BaseNodeError):
    """Raised when the default value type is invalid."""

    pass
