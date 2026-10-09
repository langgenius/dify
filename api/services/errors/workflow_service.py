class WorkflowInUseError(ValueError):
    """Raised when attempting to delete a workflow that's in use by an app"""

    pass


class DraftWorkflowDeletionError(ValueError):
    """Raised when attempting to delete a draft workflow"""

    pass


class WorkflowDebugReservationExpiredError(ValueError):
    """An owned debug handoff expired before a worker could start it."""


class WorkflowDebugReservationAlreadyClaimedError(ValueError):
    """Another worker owns this invocation; redelivery must not notify its stream."""


class WorkflowConversionError(ValueError):
    """The source app or a referenced conversion resource is unavailable."""
