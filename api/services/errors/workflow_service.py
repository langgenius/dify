class WorkflowInUseError(ValueError):
    """Raised when attempting to delete a workflow that's in use by an app"""

    pass


class DraftWorkflowDeletionError(ValueError):
    """Raised when attempting to delete a draft workflow"""

    pass
