class WorkflowInUseError(ValueError):
    """Raised when attempting to delete a workflow that's in use by an app"""

    pass


class DraftWorkflowDeletionError(ValueError):
    """Raised when attempting to delete a draft workflow"""

    pass


class WorkflowDraftInitializationBusyError(RuntimeError):
    """The request could not acquire the Redis lease required to create a draft."""

    def __init__(self) -> None:
        super().__init__("Workflow draft initialization is busy. Please try again.")
