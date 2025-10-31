class MoreLikeThisDisabledError(Exception):
    pass


class WorkflowHashNotEqualError(Exception):
    pass


class IsDraftWorkflowError(Exception):
    pass


class WorkflowNotFoundError(Exception):
    pass


class WorkflowIdFormatError(Exception):
    pass


class InvokeDailyRateLimitError(Exception):
    """Raised when daily rate limit is exceeded for workflow invocations."""

    pass
