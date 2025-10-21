class ListOperatorError(ValueError):
    """Base class for all ListOperator errors."""

    pass


class InvalidFilterValueError(ListOperatorError):
    pass


class InvalidKeyError(ListOperatorError):
    pass


class InvalidConditionError(ListOperatorError):
    pass
